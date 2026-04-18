/**
 * Deploy AMM DEX contracts to Stellar Testnet
 * Deploys: TokenA, TokenB, LP Token, AMM Contract
 * Uses raw JSON-RPC calls via node https to avoid axios proxy issues
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const StellarSdk = require("@stellar/stellar-sdk");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PROXY_URL = "http://127.0.0.1:7897";
const agent = new HttpsProxyAgent(PROXY_URL);

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// ── Raw HTTP helpers ──

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

async function horizonGet(p) {
  const res = await retryRequest(`${HORIZON_URL}${p}`, {});
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

// ── Invoke a contract method (with restore-preamble handling) ──

async function invokeContract(deployer, contractId, method, args) {
  const acct = await loadAccount(deployer.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(contract.call(method, ...args)).setTimeout(300).build();

  const sim = await simulateTx(tx.toXDR());

  // Handle restore preamble (archived state)
  if (sim.restorePreamble) {
    console.log(`  Archived state detected for ${method}, restoring...`);
    const restoreAcct = await loadAccount(deployer.publicKey());
    const restoreTx = new StellarSdk.TransactionBuilder(restoreAcct, {
      fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
    }).setSorobanData(
      StellarSdk.xdr.SorobanTransactionData.fromXDR(sim.restorePreamble.transactionData, "base64")
    ).addOperation(StellarSdk.Operation.restoreFootprint({})).setTimeout(300).build();

    const restoreSim = await simulateTx(restoreTx.toXDR());
    const prepRestore = StellarSdk.rpc.assembleTransaction(restoreTx, restoreSim).build();
    prepRestore.sign(deployer);
    const restoreRes = await sendTx(prepRestore.toXDR());
    const restoreSt = await waitForTx(restoreRes.hash);
    console.log(`  Restore TX: ${restoreSt.status} (${restoreRes.hash})`);

    const acct2 = await loadAccount(deployer.publicKey());
    const tx2 = new StellarSdk.TransactionBuilder(acct2, {
      fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
    }).addOperation(contract.call(method, ...args)).setTimeout(300).build();
    const sim2 = await simulateTx(tx2.toXDR());
    if (sim2.error) throw new Error(`${method} sim after restore: ${sim2.error}`);
    const prep2 = StellarSdk.rpc.assembleTransaction(tx2, sim2).build();
    prep2.sign(deployer);
    const res2 = await sendTx(prep2.toXDR());
    const st2 = await waitForTx(res2.hash);
    console.log(`  ${method}: ${st2.status} (TX: ${res2.hash})`);
    return res2.hash;
  }

  if (sim.error) throw new Error(`${method} sim: ${sim.error}`);

  const prep = StellarSdk.rpc.assembleTransaction(tx, sim).build();
  prep.sign(deployer);

  const res = await sendTx(prep.toXDR());
  const st = await waitForTx(res.hash);
  console.log(`  ${method}: ${st.status} (TX: ${res.hash})`);
  return res.hash;
}

// ── WASM upload ──

async function uploadWasm(deployer, wasmPath, name) {
  const wasm = fs.readFileSync(wasmPath);
  console.log(`\n[${name}] WASM: ${wasm.length} bytes`);

  const hashBytes = crypto.createHash("sha256").update(wasm).digest();
  const wasmHashHex = hashBytes.toString("hex");
  console.log(`[${name}] WASM SHA-256: ${wasmHashHex}`);

  console.log(`[${name}] Uploading WASM...`);
  const acct1 = await loadAccount(deployer.publicKey());
  const uploadTx = new StellarSdk.TransactionBuilder(acct1, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(StellarSdk.Operation.uploadContractWasm({ wasm })).setTimeout(300).build();

  const simUp = await simulateTx(uploadTx.toXDR());
  if (simUp.error) throw new Error(`[${name}] Upload sim: ${simUp.error}`);

  const prepUp = StellarSdk.rpc.assembleTransaction(uploadTx, simUp).build();
  prepUp.sign(deployer);

  const upRes = await sendTx(prepUp.toXDR());
  console.log(`[${name}] Upload TX: ${upRes.hash}`);
  const upSt = await waitForTx(upRes.hash);
  if (upSt.status !== "SUCCESS") throw new Error(`[${name}] Upload failed: ${upSt.status}`);

  console.log(`[${name}] WASM uploaded successfully.`);
  return { wasm, hashBytes };
}

// ── Contract creation ──

async function createContract(deployer, hashBytes, name) {
  console.log(`[${name}] Creating contract...`);
  const acct = await loadAccount(deployer.publicKey());
  const salt = crypto.randomBytes(32);
  const createTx = new StellarSdk.TransactionBuilder(acct, {
    fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
  }).addOperation(StellarSdk.Operation.createCustomContract({
    address: new StellarSdk.Address(deployer.publicKey()),
    wasmHash: hashBytes,
    salt,
  })).setTimeout(300).build();

  const simCr = await simulateTx(createTx.toXDR());
  if (simCr.error) throw new Error(`[${name}] Create sim: ${simCr.error}`);

  const prepCr = StellarSdk.rpc.assembleTransaction(createTx, simCr).build();
  prepCr.sign(deployer);

  const crRes = await sendTx(prepCr.toXDR());
  console.log(`[${name}] Create TX: ${crRes.hash}`);
  const crSt = await waitForTx(crRes.hash);
  if (crSt.status !== "SUCCESS") throw new Error(`[${name}] Create failed: ${crSt.status}`);

  let contractId;
  {
    const meta = StellarSdk.xdr.TransactionMeta.fromXDR(crSt.resultMetaXdr, "base64");
    const val = meta.value();
    outer: for (const op of val.operations()) {
      for (const ch of op.changes()) {
        if (ch.switch().name === "ledgerEntryCreated") {
          const data = ch.created().data();
          if (data.switch().name === "contractData") {
            const cd = data.contractData();
            if (cd.key().switch().name === "scvLedgerKeyContractInstance") {
              const contractAddrXdr = cd.contract();
              const rawId = contractAddrXdr.contractId
                ? contractAddrXdr.contractId()
                : contractAddrXdr.value();
              contractId = StellarSdk.StrKey.encodeContract(rawId);
              break outer;
            }
          }
        }
      }
    }
  }
  if (!contractId) throw new Error(`[${name}] Could not extract contract ID from meta`);
  console.log(`[${name}] Contract ID: ${contractId}`);
  return { contractId, deployTx: crRes.hash };
}

// ── TTL extension ──

async function extendTtl(deployer, contractId, hashBytes, name) {
  console.log(`[${name}] Extending TTL...`);
  try {
    const acct = await loadAccount(deployer.publicKey());
    const contractAddress = new StellarSdk.Address(contractId);
    const instanceKey = StellarSdk.xdr.LedgerKey.contractData(
      new StellarSdk.xdr.LedgerKeyContractData({
        contract: contractAddress.toScAddress(),
        key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: StellarSdk.xdr.ContractDataDurability.persistent(),
      })
    );
    const wasmKey = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash: Buffer.from(hashBytes) })
    );

    const extendTx = new StellarSdk.TransactionBuilder(acct, {
      fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE
    }).addOperation(StellarSdk.Operation.extendFootprintTtl({
      extendTo: 100000,
    })).setSorobanData(
      new StellarSdk.SorobanDataBuilder()
        .setReadOnly([instanceKey, wasmKey])
        .build()
    ).setTimeout(300).build();

    const simExt = await simulateTx(extendTx.toXDR());
    if (!simExt.error) {
      const prepExt = StellarSdk.rpc.assembleTransaction(extendTx, simExt).build();
      prepExt.sign(deployer);
      const extRes = await sendTx(prepExt.toXDR());
      const extSt = await waitForTx(extRes.hash);
      console.log(`[${name}] Extend TTL: ${extSt.status}`);
    } else {
      console.log(`[${name}] Extend TTL sim warning (ignored): ${simExt.error}`);
    }
  } catch (e) {
    console.log(`[${name}] Extend TTL failed (ignored): ${e.message}`);
  }
}

// ── Main ──

async function main() {
  const deployer = StellarSdk.Keypair.random();
  console.log("Deployer:", deployer.publicKey());

  // Fund
  console.log("\nFunding via Friendbot...");
  await retryRequest(`https://friendbot.stellar.org/?addr=${deployer.publicKey()}`, {});
  console.log("Funded! Waiting 8s for ledger...");
  await new Promise(r => setTimeout(r, 8000));

  // WASM paths
  const rewardTokenWasmPath = path.resolve(
    __dirname, "../contracts/reward-token/target/wasm32-unknown-unknown/release/reward_token.wasm"
  );
  const lpTokenWasmPath = path.resolve(
    __dirname, "../contracts/lp-token/target/wasm32-unknown-unknown/release/lp_token.wasm"
  );
  const ammWasmPath = path.resolve(
    __dirname, "../contracts/amm/target/wasm32-unknown-unknown/release/amm_contract.wasm"
  );

  // ── Step 1: Upload WASMs (reward-token WASM reused for TokenA and TokenB) ──
  console.log("\n=== Uploading WASMs ===");
  const { hashBytes: tokenWasmHash } = await uploadWasm(deployer, rewardTokenWasmPath, "Token(A/B)");
  const { hashBytes: lpWasmHash } = await uploadWasm(deployer, lpTokenWasmPath, "LPToken");
  const { hashBytes: ammWasmHash } = await uploadWasm(deployer, ammWasmPath, "AMM");

  // ── Step 2: Create TokenA ──
  console.log("\n=== Deploying TokenA ===");
  const tokenA = await createContract(deployer, tokenWasmHash, "TokenA");

  // ── Step 3: Initialize TokenA ──
  console.log("\nInitializing TokenA...");
  await invokeContract(deployer, tokenA.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal("Token A", { type: "string" }),
    StellarSdk.nativeToScVal("TKNA", { type: "string" }),
  ]);
  await extendTtl(deployer, tokenA.contractId, tokenWasmHash, "TokenA");

  // ── Step 4: Create TokenB ──
  console.log("\n=== Deploying TokenB ===");
  const tokenB = await createContract(deployer, tokenWasmHash, "TokenB");

  // ── Step 5: Initialize TokenB ──
  console.log("\nInitializing TokenB...");
  await invokeContract(deployer, tokenB.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal("Token B", { type: "string" }),
    StellarSdk.nativeToScVal("TKNB", { type: "string" }),
  ]);
  await extendTtl(deployer, tokenB.contractId, tokenWasmHash, "TokenB");

  // ── Step 6: Create LP Token ──
  console.log("\n=== Deploying LP Token ===");
  const lpToken = await createContract(deployer, lpWasmHash, "LPToken");

  // ── Step 7: Initialize LP Token ──
  console.log("\nInitializing LP Token...");
  await invokeContract(deployer, lpToken.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal("AMM LP Token", { type: "string" }),
    StellarSdk.nativeToScVal("AMMLP", { type: "string" }),
  ]);
  await extendTtl(deployer, lpToken.contractId, lpWasmHash, "LPToken");

  // ── Step 8: Create AMM ──
  console.log("\n=== Deploying AMM Contract ===");
  const amm = await createContract(deployer, ammWasmHash, "AMM");

  // ── Step 9: Initialize AMM ──
  console.log("\nInitializing AMM...");
  await invokeContract(deployer, amm.contractId, "initialize", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal(tokenA.contractId, { type: "address" }),
    StellarSdk.nativeToScVal(tokenB.contractId, { type: "address" }),
    StellarSdk.nativeToScVal(lpToken.contractId, { type: "address" }),
  ]);
  await extendTtl(deployer, amm.contractId, ammWasmHash, "AMM");

  // ── Step 10: Set AMM as LP Token minter ──
  console.log("\nSetting AMM as LP Token minter...");
  await invokeContract(deployer, lpToken.contractId, "set_minter", [
    StellarSdk.nativeToScVal(amm.contractId, { type: "address" }),
  ]);

  // ── Step 11: Mint initial tokens to deployer for testing ──
  console.log("\nMinting initial tokens to deployer...");
  const INITIAL_SUPPLY = StellarSdk.nativeToScVal(1_000_000_0000000n, { type: "i128" }); // 1,000,000 tokens (7 decimals)
  await invokeContract(deployer, tokenA.contractId, "set_minter", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
  ]);
  await invokeContract(deployer, tokenB.contractId, "set_minter", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
  ]);
  await invokeContract(deployer, tokenA.contractId, "mint", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    INITIAL_SUPPLY,
  ]);
  await invokeContract(deployer, tokenB.contractId, "mint", [
    StellarSdk.nativeToScVal(deployer.publicKey(), { type: "address" }),
    INITIAL_SUPPLY,
  ]);

  console.log("\n========================================");
  console.log("AMM DEX DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log(`TokenA Contract:   ${tokenA.contractId}`);
  console.log(`TokenB Contract:   ${tokenB.contractId}`);
  console.log(`LP Token Contract: ${lpToken.contractId}`);
  console.log(`AMM Contract:      ${amm.contractId}`);
  console.log("========================================");
  console.log("\nAdd to .env.local:");
  console.log(`NEXT_PUBLIC_AMM_CONTRACT_ID=${amm.contractId}`);
  console.log(`NEXT_PUBLIC_LP_TOKEN_ID=${lpToken.contractId}`);
  console.log(`NEXT_PUBLIC_TOKEN_A_ID=${tokenA.contractId}`);
  console.log(`NEXT_PUBLIC_TOKEN_B_ID=${tokenB.contractId}`);
  console.log("\nDeployer secret (save to fund test wallets):", deployer.secret());
  console.log("\nNext steps:");
  console.log("  1. Copy the 4 env vars above into .env.local");
  console.log("  2. npm run dev");
  console.log("  3. Connect wallet → Token Swap tab");
  console.log("  4. Add liquidity first, then try swapping");
}

main().catch(console.error);
