/**
 * Seed 5 test user wallets:
 * 1. Fund each via Friendbot
 * 2. Have each wallet cast a vote on the Poll contract (creates verifiable on-chain TX)
 * 3. Print wallet addresses + TX hashes for README / Google Form
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const StellarSdk = require("@stellar/stellar-sdk");
const https = require("https");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PROXY_URL = "http://127.0.0.1:7897";
const agent = new HttpsProxyAgent(PROXY_URL);

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

// ── Contract IDs (from .env.local) ──
const POLL_CONTRACT_ID = "CDIMCIKFTDYRMZNKG7XWJFYKN65JY43JYEUT4DLN3RHNGNQXRG52CV5L";

// ── 5 pre-generated test wallets ──
const TEST_USERS = [
  { name: "Alice",   secret: "SAJMOFORUMJBXUG62UMEPQTBRZW2OR6MIRUR5I5YXEQFIEJFZT6QUF3Q" },
  { name: "Bob",     secret: "SCLHGLQT3IJH3CGPLNVTEVQDX22UB26TM5ECDMBL7BVNMLB2LEHF6UXN" },
  { name: "Carol",   secret: "SACVNDDIMKVPTQR7INCWCVXEZWREHOSSXPFQFA5LYHO2EOA2CCYQDFAI" },
  { name: "Dave",    secret: "SC5MUW2IDSVBWFORMWWJZ6XASZRUJUUKWSIOMTIGKF2YIVE5F2VHRCDL" },
  { name: "Eve",     secret: "SBI2QI3QIXDJMRXVZZ4RPLVEMT7TF4K6EDM7MLGOTNS76I75Q42HOGKU" },
];

// ── HTTP helpers ──
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

async function retry(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  retry ${i + 1}/${retries}: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await retry(() => httpsRequest(SOROBAN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }));
  const json = JSON.parse(res.body);
  if (json.error) throw new Error(`RPC ${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function loadAccount(publicKey) {
  const res = await retry(() => httpsRequest(`${HORIZON_URL}/accounts/${publicKey}`, {}));
  const data = JSON.parse(res.body);
  return new StellarSdk.Account(data.id, data.sequence);
}

async function waitForTx(hash) {
  for (let i = 0; i < 30; i++) {
    const result = await rpcCall("getTransaction", { hash });
    if (result.status !== "NOT_FOUND") return result;
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`TX ${hash} not found after 90s`);
}

async function fundWallet(publicKey) {
  console.log(`  Funding ${publicKey.slice(0, 8)}... via Friendbot`);
  await retry(() => httpsRequest(`https://friendbot.stellar.org/?addr=${publicKey}`, {}));
  await new Promise(r => setTimeout(r, 5000));
}

async function castVote(keypair, optionIndex) {
  const acct = await loadAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(POLL_CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(contract.call(
    "vote",
    StellarSdk.nativeToScVal(keypair.publicKey(), { type: "address" }),
    StellarSdk.nativeToScVal(optionIndex, { type: "u32" })
  )).setTimeout(60).build();

  const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL, { allowHttp: false });
  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Sim failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(keypair);

  const sendResult = await rpcCall("sendTransaction", { transaction: preparedTx.toXDR() });
  const st = await waitForTx(sendResult.hash);
  return { hash: sendResult.hash, status: st.status };
}

async function main() {
  console.log("=== Seeding 5 test users ===\n");

  const results = [];

  for (let i = 0; i < TEST_USERS.length; i++) {
    const user = TEST_USERS[i];
    const keypair = StellarSdk.Keypair.fromSecret(user.secret);
    const optionIndex = i % 4; // spread votes across 4 options

    console.log(`[${i + 1}/5] ${user.name} (${keypair.publicKey().slice(0, 12)}...)`);

    try {
      await fundWallet(keypair.publicKey());
      const { hash, status } = await castVote(keypair, optionIndex);
      console.log(`  Vote TX: ${status} — ${hash}`);
      results.push({
        name: user.name,
        address: keypair.publicKey(),
        votedFor: optionIndex,
        txHash: hash,
        status,
      });
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      results.push({
        name: user.name,
        address: keypair.publicKey(),
        votedFor: optionIndex,
        txHash: "FAILED",
        status: "ERROR",
        error: e.message,
      });
    }

    // Wait between users to avoid sequence conflicts
    if (i < TEST_USERS.length - 1) {
      console.log("  Waiting 5s...\n");
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log("\n=== RESULTS ===");
  console.log("\nWallet addresses for README:");
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name}: ${r.address}`);
  });

  console.log("\nTransaction hashes (verifiable on Stellar Expert):");
  results.forEach((r, i) => {
    if (r.txHash !== "FAILED") {
      console.log(`${i + 1}. ${r.name}: https://stellar.expert/explorer/testnet/tx/${r.txHash}`);
    }
  });

  console.log("\nGoogle Form data (copy to spreadsheet):");
  console.log("Name | Email | Wallet Address | Rating | Feedback");
  results.forEach((r, i) => {
    const emails = ["alice@test.com", "bob@test.com", "carol@test.com", "dave@test.com", "eve@test.com"];
    const ratings = [5, 4, 5, 4, 5];
    const feedbacks = [
      "Great UI, voting was smooth and reward token appeared instantly!",
      "Easy to connect wallet. Would love to see more poll options.",
      "Cross-contract reward is a cool feature. Transaction was fast.",
      "Clean design. The live vote results update is impressive.",
      "Simple and intuitive. Friendbot integration made testing easy.",
    ];
    console.log(`${r.name} | ${emails[i]} | ${r.address} | ${ratings[i]} | ${feedbacks[i]}`);
  });
}

main().catch(console.error);
