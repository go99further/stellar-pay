import * as StellarSdk from "@stellar/stellar-sdk";
import { cache, CACHE_KEYS, CACHE_TTL } from "./cache";

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const AMM_CONTRACT_ID = process.env.NEXT_PUBLIC_AMM_CONTRACT_ID || "";
const LP_TOKEN_ID = process.env.NEXT_PUBLIC_LP_TOKEN_ID || "";
const TOKEN_A_ID = process.env.NEXT_PUBLIC_TOKEN_A_ID || "";
const TOKEN_B_ID = process.env.NEXT_PUBLIC_TOKEN_B_ID || "";

const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

export function getAmmContractId() {
  return AMM_CONTRACT_ID;
}

export function getTokenAId() {
  return TOKEN_A_ID;
}

export function getTokenBId() {
  return TOKEN_B_ID;
}

export function getLpTokenId() {
  return LP_TOKEN_ID;
}

// ── Read helpers ──────────────────────────────────────────────────────────────

async function simulateRead(
  callerPublicKey: string,
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[] = []
): Promise<StellarSdk.xdr.ScVal | null> {
  const account = await rpcServer.getAccount(callerPublicKey);
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "1000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) return null;
  return simResult.result?.retval ?? null;
}

/**
 * Fetch pool reserves. Returns [reserveA, reserveB] as bigint.
 */
export async function getReserves(
  callerPublicKey: string
): Promise<[bigint, bigint]> {
  const cached = cache.get<[bigint, bigint]>(CACHE_KEYS.AMM_RESERVES);
  if (cached) return cached;

  const retval = await simulateRead(callerPublicKey, AMM_CONTRACT_ID, "get_reserves");
  if (!retval) return [0n, 0n];

  const native = StellarSdk.scValToNative(retval) as [unknown, unknown];
  const result: [bigint, bigint] = [BigInt(String(native[0])), BigInt(String(native[1]))];
  cache.set(CACHE_KEYS.AMM_RESERVES, result, CACHE_TTL.AMM_RESERVES);
  return result;
}

/**
 * Get expected swap output from the contract (preview).
 */
export async function getPrice(
  callerPublicKey: string,
  tokenIn: string,
  amountIn: bigint
): Promise<bigint> {
  const cacheKey = CACHE_KEYS.AMM_PRICE(tokenIn, amountIn.toString());
  const cached = cache.get<bigint>(cacheKey);
  if (cached !== undefined) return cached;

  const retval = await simulateRead(
    callerPublicKey,
    AMM_CONTRACT_ID,
    "get_price",
    [
      StellarSdk.nativeToScVal(tokenIn, { type: "address" }),
      StellarSdk.nativeToScVal(Number(amountIn), { type: "i128" }),
    ]
  );
  if (!retval) return 0n;

  const result = BigInt(String(StellarSdk.scValToNative(retval)));
  cache.set(cacheKey, result, CACHE_TTL.AMM_PRICE);
  return result;
}

/**
 * Get LP token balance for an address.
 */
export async function getLpBalance(
  callerPublicKey: string,
  address: string
): Promise<bigint> {
  const cacheKey = CACHE_KEYS.LP_BALANCE(address);
  const cached = cache.get<bigint>(cacheKey);
  if (cached !== undefined) return cached;

  const retval = await simulateRead(
    callerPublicKey,
    LP_TOKEN_ID,
    "balance",
    [StellarSdk.nativeToScVal(address, { type: "address" })]
  );
  if (!retval) return 0n;

  const result = BigInt(String(StellarSdk.scValToNative(retval)));
  cache.set(cacheKey, result, CACHE_TTL.LP_BALANCE);
  return result;
}

/**
 * Get LP token total supply.
 */
export async function getLpSupply(callerPublicKey: string): Promise<bigint> {
  const cached = cache.get<bigint>(CACHE_KEYS.LP_SUPPLY);
  if (cached !== undefined) return cached;

  const retval = await simulateRead(
    callerPublicKey,
    LP_TOKEN_ID,
    "total_supply"
  );
  if (!retval) return 0n;

  const result = BigInt(String(StellarSdk.scValToNative(retval)));
  cache.set(CACHE_KEYS.LP_SUPPLY, result, CACHE_TTL.LP_SUPPLY);
  return result;
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Build and simulate a swap transaction. Returns XDR for signing.
 */
export async function buildSwapTransaction(
  userPublicKey: string,
  tokenIn: string,
  amountIn: bigint,
  minAmountOut: bigint
): Promise<string> {
  const account = await rpcServer.getAccount(userPublicKey);
  const contract = new StellarSdk.Contract(AMM_CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "swap",
        StellarSdk.nativeToScVal(userPublicKey, { type: "address" }),
        StellarSdk.nativeToScVal(tokenIn, { type: "address" }),
        StellarSdk.nativeToScVal(Number(amountIn), { type: "i128" }),
        StellarSdk.nativeToScVal(Number(minAmountOut), { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
  return preparedTx.toXDR();
}

/**
 * Build and simulate an add_liquidity transaction. Returns XDR for signing.
 */
export async function buildAddLiquidityTransaction(
  providerPublicKey: string,
  amountA: bigint,
  amountB: bigint,
  minLp: bigint
): Promise<string> {
  const account = await rpcServer.getAccount(providerPublicKey);
  const contract = new StellarSdk.Contract(AMM_CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "add_liquidity",
        StellarSdk.nativeToScVal(providerPublicKey, { type: "address" }),
        StellarSdk.nativeToScVal(Number(amountA), { type: "i128" }),
        StellarSdk.nativeToScVal(Number(amountB), { type: "i128" }),
        StellarSdk.nativeToScVal(Number(minLp), { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
  return preparedTx.toXDR();
}

/**
 * Build and simulate a remove_liquidity transaction. Returns XDR for signing.
 */
export async function buildRemoveLiquidityTransaction(
  providerPublicKey: string,
  lpAmount: bigint,
  minA: bigint,
  minB: bigint
): Promise<string> {
  const account = await rpcServer.getAccount(providerPublicKey);
  const contract = new StellarSdk.Contract(AMM_CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "remove_liquidity",
        StellarSdk.nativeToScVal(providerPublicKey, { type: "address" }),
        StellarSdk.nativeToScVal(Number(lpAmount), { type: "i128" }),
        StellarSdk.nativeToScVal(Number(minA), { type: "i128" }),
        StellarSdk.nativeToScVal(Number(minB), { type: "i128" })
      )
    )
    .setTimeout(60)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
  return preparedTx.toXDR();
}

/**
 * Submit a signed transaction and poll for result.
 */
export async function submitAmmTransaction(signedXdr: string): Promise<{
  hash: string;
  status: string;
}> {
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await rpcServer.sendTransaction(tx);

  if (sendResult.status === "ERROR") {
    const detail = sendResult.errorResult
      ? JSON.stringify(sendResult.errorResult)
      : "unknown error";
    throw new Error(`Transaction submission failed: ${detail}`);
  }

  let getResult = await rpcServer.getTransaction(sendResult.hash);
  while (getResult.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await rpcServer.getTransaction(sendResult.hash);
  }

  if (getResult.status === "FAILED") {
    throw new Error("Transaction failed on-chain");
  }

  // Invalidate reserves and LP caches after any state-changing operation
  cache.invalidate(CACHE_KEYS.AMM_RESERVES);
  cache.invalidate(CACHE_KEYS.LP_SUPPLY);

  return { hash: sendResult.hash, status: getResult.status };
}
