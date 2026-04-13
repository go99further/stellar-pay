/**
 * Deploy the poll contract to Stellar Testnet (proxy-aware)
 * Usage: node scripts/deploy-contract.js
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const StellarSdk = require("@stellar/stellar-sdk");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PROXY_URL = "http://127.0.0.1:7897";
const agent = new HttpsProxyAgent(PROXY_URL);

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// Reliable fetch via proxy with retries
function proxyGet(url, retries = 5) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const req = https.get(url, { agent, timeout: 60000 }, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      });
      req.on("error", (err) => {
        if (n > 0) {
          console.log(`  Retry (${retries - n + 1}/${retries})...`);
          setTimeout(() => attempt(n - 1), 2000);
        } else reject(err);
      });
      req.on("timeout", () => {
        req.destroy();
        if (n > 0) {
          console.log(`  Timeout retry (${retries - n + 1}/${retries})...`);
          setTimeout(() => attempt(n - 1), 2000);
        } else reject(new Error("timeout after retries"));
      });
    }
    attempt(retries);
  });
}

async function main() {
  // Patch global fetch for stellar-sdk
  const origFetch = globalThis.fetch;
  // Patch global fetch for stellar-sdk with retry
  globalThis.fetch = async (url, opts = {}) => {
    const { default: nodeFetch } = await import("node-fetch");
    for (let i = 0; i < 5; i++) {
      try {
        return await nodeFetch(url.toString(), { ...opts, agent, timeout: 60000 });
      } catch (err) {
        if (i === 4) throw err;
        console.log(`  fetch retry ${i + 1}/5...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  const rpc = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
  const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

  // 1. Generate deployer keypair
  const deployer = StellarSdk.Keypair.random();
  console.log("Deployer:", deployer.publicKey());

  // 2. Fund via Friendbot
  console.log("\nFunding via Friendbot...");
  const fund = await proxyGet(`https://friendbot.stellar.org/?addr=${deployer.publicKey()}`);
  console.log("Friendbot response:", fund.status, fund.body.substring(0, 100));
  console.log("Waiting 6s for ledger...");
  await new Promise((r) => setTimeout(r, 6000));

  // 3. Read WASM
  const wasmPath = path.resolve(__dirname, "../contracts/poll/target/wasm32-unknown-unknown/release/poll_contract.wasm");
  const wasm = fs.readFileSync(wasmPath);
  console.log(`\nWASM: ${wasm.length} bytes`);

  // 4. Upload WASM
  console.log("\nUploading WASM...");
  const acct1 = await horizon.loadAccount(deployer.publicKey());
  const uploadTx = new StellarSdk.TransactionBuilder(acct1, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.uploadContractWasm({ wasm }))
    .setTimeout(300).build();

  const simUp = await rpc.simulateTransaction(uploadTx);
  if (StellarSdk.rpc.Api.isSimulationError(simUp)) {
    console.error("Upload sim failed:", simUp.error); process.exit(1);
  }
  const prepUp = StellarSdk.rpc.assembleTransaction(uploadTx, simUp).build();
  prepUp.sign(deployer);
  const upRes = await rpc.sendTransaction(prepUp);
  console.log("Upload tx:", upRes.hash);

  let upSt = await rpc.getTransaction(upRes.hash);
  while (upSt.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 3000));
    upSt = await rpc.getTransaction(upRes.hash);
  }
  if (upSt.status !== "SUCCESS") { console.error("Upload failed:", upSt.status); process.exit(1); }
  console.log("WASM uploaded!");

  const wasmHash = upSt.returnValue;

  // 5. Create contract
  console.log("\nCreating contract...");
  const acct2 = await horizon.loadAccount(deployer.publicKey());
  const createTx = new StellarSdk.TransactionBuilder(acct2, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(StellarSdk.Operation.createCustomContract({
      address: new StellarSdk.Address(deployer.publicKey()),
      wasmHash: wasmHash.value(),
    }))
    .setTimeout(300).build();

  const simCr = await rpc.simulateTransaction(createTx);
  if (StellarSdk.rpc.Api.isSimulationError(simCr)) {
    console.error("Create sim failed:", simCr.error); process.exit(1);
  }
  const prepCr = StellarSdk.rpc.assembleTransaction(createTx, simCr).build();
  prepCr.sign(deployer);
  const crRes = await rpc.sendTransaction(prepCr);
  console.log("Create tx:", crRes.hash);

  let crSt = await rpc.getTransaction(crRes.hash);
  while (crSt.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 3000));
    crSt = await rpc.getTransaction(crRes.hash);
  }
  if (crSt.status !== "SUCCESS") { console.error("Create failed:", crSt.status); process.exit(1); }

  const contractId = StellarSdk.StrKey.encodeContract(crSt.returnValue.value().value());
  console.log("\n=== CONTRACT DEPLOYED ===");
  console.log("Contract ID:", contractId);
  console.log("Deploy TX:", crRes.hash);

  // 6. Initialize
  console.log("\nInitializing...");
  const acct3 = await horizon.loadAccount(deployer.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const initTx = new StellarSdk.TransactionBuilder(acct3, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(contract.call("initialize",
      StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" })))
    .setTimeout(300).build();

  const simIn = await rpc.simulateTransaction(initTx);
  if (StellarSdk.rpc.Api.isSimulationError(simIn)) {
    console.error("Init sim failed:", simIn.error); process.exit(1);
  }
  const prepIn = StellarSdk.rpc.assembleTransaction(initTx, simIn).build();
  prepIn.sign(deployer);
  const inRes = await rpc.sendTransaction(prepIn);
  let inSt = await rpc.getTransaction(inRes.hash);
  while (inSt.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 3000));
    inSt = await rpc.getTransaction(inRes.hash);
  }
  console.log("Initialized:", inSt.status);

  // 7. Create poll
  console.log("\nCreating poll...");
  const acct4 = await horizon.loadAccount(deployer.publicKey());
  const pollTx = new StellarSdk.TransactionBuilder(acct4, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  })
    .addOperation(contract.call("create_poll",
      StellarSdk.nativeToScVal("What is the best Stellar wallet?", { type: "string" }),
      StellarSdk.xdr.ScVal.scvVec(
        ["Freighter", "xBull", "Albedo", "LOBSTR"].map(s => StellarSdk.nativeToScVal(s, { type: "string" }))
      )))
    .setTimeout(300).build();

  const simPo = await rpc.simulateTransaction(pollTx);
  if (StellarSdk.rpc.Api.isSimulationError(simPo)) {
    console.error("Poll sim failed:", simPo.error); process.exit(1);
  }
  const prepPo = StellarSdk.rpc.assembleTransaction(pollTx, simPo).build();
  prepPo.sign(deployer);
  const poRes = await rpc.sendTransaction(prepPo);
  let poSt = await rpc.getTransaction(poRes.hash);
  while (poSt.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 3000));
    poSt = await rpc.getTransaction(poRes.hash);
  }
  console.log("Poll created:", poSt.status);
  console.log("Poll TX:", poRes.hash);

  console.log("\n========================================");
  console.log("ALL DONE! Add to .env.local:");
  console.log(`NEXT_PUBLIC_CONTRACT_ID=${contractId}`);
  console.log("========================================");
  console.log("\nDeployer Secret (save!):", deployer.secret());
}

main().catch(console.error);
