/**
 * Deploy both Poll and RewardToken contracts to Stellar Testnet
 * Uses raw JSON-RPC calls via node-fetch to avoid axios proxy issues
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

// ── Raw HTTP helpers (bypass axios entirely) ──

function httpsRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: opts.method || "GET",
      headers: opts.headers || {},
      agent,
      timeout: 60000,
    };
    const req = https.request(reqOpts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function retryRequest(url, opts, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await httpsRequest(url, opts);
      if (res.status >= 500 && i < retries - 1) {
        console.log(`  retry ${i + 1}/${retries} (HTTP ${res.status})`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`  retry ${i + 1}/${retries} (${err.code || err.message})`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await retryRequest(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = JSON.parse(res.body);
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function horizonGet(path) {
  const res = await retryRequest(`${HORIZON_URL}${path}`, {});
  return JSON.parse(res.body);
}

async function loadAccount(publicKey) {
  const data = await horizonGet(`/accounts/${publicKey}`);
  return new StellarSdk.Account(data.id, data.sequence);
}

async function simulateTx(txXdr) {
  return await rpcCall("simulateTransaction", { transaction: txXdr });
}

async function sendTx(txXdr) {
  return await rpcCall("sendTransaction", { transaction: txXdr });
}

async function getTx(hash) {
  return await rpcCall("getTransaction", { hash });
}

async function waitForTx(hash) {
  for (let i = 0; i < 30; i++) {
    const result = await getTx(hash);
    if (result.status !== "NOT_FOUND") return result;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`TX ${hash} not found after 90s`);
}

// ── Deploy logic ──

async function deployWasm(deployer, wasmPath, name) {
  const wasm = fs.readFileSync(wasmPath);
  console.log(`\n[${name}] WASM: ${wasm.length} bytes`);

  // Upload WASM
  console.log(`[${name}] Uploading WASM...`);
  const acct1 = await loadAccount(deployer.publicKey());
  const uploadTx = new StellarSdk.TransactionBuilder(acct1, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(StellarSdk.Operation.uploadContractWasm({ wasm })).setTimeout(300).build();

  const simUp = await simulateTx(uploadTx.toXDR());
  if (simUp.error) throw new Error(`Upload sim: ${simUp.error}`);

  const prepUp = StellarSdk.SorobanRpc
    ? StellarSdk.SorobanRpc.assembleTransaction(uploadTx, simUp).build()
    : StellarSdk.rpc.assembleTransaction(uploadTx, simUp).build();
  prepUp.sign(deployer);

  const upRes = await sendTx(prepUp.toXDR());
  console.log(`[${name}] Upload TX: ${upRes.hash}`);
  const upSt = await waitForTx(upRes.hash);
  if (upSt.status !== "SUCCESS") throw new Error(`Upload failed: ${upSt.status}`);

  // Debug: print all keys
  console.log(`[${name}] TX result keys:`, Object.keys(upSt).join(", "));

  // Get WASM hash - try different field names
  const returnVal = upSt.returnValue || upSt.resultXdr;
  if (!returnVal) {
    console.log(`[${name}] Full result:`, JSON.stringify(upSt).substring(0, 500));
  }
  const wasmHash = StellarSdk.xdr.ScVal.fromXDR(returnVal, "base64");

  // Create contract
  console.log(`[${name}] Creating contract...`);
  const acct2 = await loadAccount(deployer.publicKey());
  const createTx = new StellarSdk.TransactionBuilder(acct2, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(StellarSdk.Operation.createCustomContract({
    address: new StellarSdk.Address(deployer.publicKey()),
    wasmHash: wasmHash.value(),
  })).setTimeout(300).build();

  const simCr = await simulateTx(createTx.toXDR());
  if (simCr.error) throw new Error(`Create sim: ${simCr.error}`);

  const prepCr = StellarSdk.rpc.assembleTransaction(createTx, simCr).build();
  prepCr.sign(deployer);

  const crRes = await sendTx(prepCr.toXDR());
  console.log(`[${name}] Create TX: ${crRes.hash}`);
  const crSt = await waitForTx(crRes.hash);
  if (crSt.status !== "SUCCESS") throw new Error(`Create failed: ${crSt.status}`);

  const retVal = StellarSdk.xdr.ScVal.fromXDR(crSt.returnValue, "base64");
  const contractId = StellarSdk.StrKey.encodeContract(retVal.value().value());
  console.log(`[${name}] Contract ID: ${contractId}`);
  return { contractId, deployTx: crRes.hash };
}

async function invokeContract(deployer, contractId, method, args) {
  const acct = await loadAccount(deployer.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(contract.call(method, ...args)).setTimeout(300).build();

  const sim = await simulateTx(tx.toXDR());
  if (sim.error) throw new Error(`${method} sim: ${sim.error}`);

  const prep = StellarSdk.rpc.assembleTransaction(tx, sim).build();
  prep.sign(deployer);

  const res = await sendTx(prep.toXDR());
  const st = await waitForTx(res.hash);
  console.log(`  ${method}: ${st.status} (TX: ${res.hash})`);
  return res.hash;
}

// ── Main ──

async function main() {
  const deployer = StellarSdk.Keypair.random();
  console.log("Deployer:", deployer.publicKey());

  // Fund
  console.log("\nFunding via Friendbot...");
  await retryRequest(`https://friendbot.stellar.org/?addr=${deployer.publicKey()}`, {});
  console.log("Funded! Waiting 10s...");
  await new Promise(r => setTimeout(r, 10000));

  // Deploy RewardToken
  const rewardWasm = path.resolve(__dirname, "../contracts/reward-token/target/wasm32-unknown-unknown/release/reward_token.wasm");
  const reward = await deployWasm(deployer, rewardWasm, "RewardToken");

  // Deploy Poll
  const pollWasm = path.resolve(__dirname, "../contracts/poll/target/wasm32-unknown-unknown/release/poll_contract.wasm");
  const poll = await deployWasm(deployer, pollWasm, "Poll");

  // Initialize RewardToken
  console.log("\nInitializing RewardToken...");
  await invokeContract(deployer, reward.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal("VoteReward", { type: "string" }),
    StellarSdk.nativeToScVal("VOTE", { type: "string" }),
  ]);

  // Initialize Poll
  console.log("Initializing Poll...");
  await invokeContract(deployer, poll.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
  ]);

  // Create poll
  console.log("Creating poll...");
  const pollTxHash = await invokeContract(deployer, poll.contractId, "create_poll", [
    StellarSdk.nativeToScVal("What is the best Stellar wallet?", { type: "string" }),
    StellarSdk.xdr.ScVal.scvVec(
      ["Freighter", "xBull", "Albedo", "LOBSTR"].map(s => StellarSdk.nativeToScVal(s, { type: "string" }))
    ),
  ]);

  console.log("\n========================================");
  console.log("ALL CONTRACTS DEPLOYED!");
  console.log(`Poll Contract:         ${poll.contractId}`);
  console.log(`RewardToken Contract:  ${reward.contractId}`);
  console.log(`Poll Deploy TX:        ${poll.deployTx}`);
  console.log(`RewardToken Deploy TX: ${reward.deployTx}`);
  console.log(`Poll Creation TX:      ${pollTxHash}`);
  console.log("========================================");
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_CONTRACT_ID=${poll.contractId}`);
  console.log(`NEXT_PUBLIC_REWARD_TOKEN_ID=${reward.contractId}`);
  console.log("\nDeployer Secret:", deployer.secret());
}

main().catch(console.error);
