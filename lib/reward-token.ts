import * as StellarSdk from "@stellar/stellar-sdk";

const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const REWARD_TOKEN_ID = process.env.NEXT_PUBLIC_REWARD_TOKEN_ID || "";

const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

export function getRewardTokenId() {
  return REWARD_TOKEN_ID;
}

/**
 * Read reward token balance for an address
 */
export async function readTokenBalance(sourcePublicKey: string, targetAddress: string): Promise<string> {
  if (!REWARD_TOKEN_ID) return "0";

  try {
    const account = await rpcServer.getAccount(sourcePublicKey);
    const contract = new StellarSdk.Contract(REWARD_TOKEN_ID);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call("balance", StellarSdk.nativeToScVal(targetAddress, { type: "address" }))
      )
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simResult)) return "0";

    const result = simResult.result;
    if (!result) return "0";

    const raw = StellarSdk.scValToNative(result.retval) as bigint | number;
    // Convert from 7 decimal places
    return (Number(raw) / 10_000_000).toFixed(0);
  } catch {
    return "0";
  }
}

/**
 * Read token name
 */
export async function readTokenName(sourcePublicKey: string): Promise<string> {
  if (!REWARD_TOKEN_ID) return "VOTE";

  try {
    const account = await rpcServer.getAccount(sourcePublicKey);
    const contract = new StellarSdk.Contract(REWARD_TOKEN_ID);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("symbol"))
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simResult)) return "VOTE";

    const result = simResult.result;
    if (!result) return "VOTE";
    return StellarSdk.scValToNative(result.retval) as string;
  } catch {
    return "VOTE";
  }
}
