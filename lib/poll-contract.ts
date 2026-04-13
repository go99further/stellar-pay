import * as StellarSdk from "@stellar/stellar-sdk";

// Contract configuration
const SOROBAN_RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "";

const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

/**
 * Get the Soroban RPC server instance
 */
export function getRpcServer() {
  return rpcServer;
}

/**
 * Get the contract ID
 */
export function getContractId() {
  return CONTRACT_ID;
}

/**
 * Read poll question from the contract (simulation only, no signing)
 */
export async function readPollQuestion(sourcePublicKey: string): Promise<string> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_question"))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error("Failed to read poll question");
  }

  const result = simResult.result;
  if (!result) return "No poll active";
  return StellarSdk.scValToNative(result.retval) as string;
}

/**
 * Read poll options from the contract
 */
export async function readPollOptions(sourcePublicKey: string): Promise<string[]> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_options"))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    return [];
  }

  const result = simResult.result;
  if (!result) return [];
  return StellarSdk.scValToNative(result.retval) as string[];
}

/**
 * Read vote counts from the contract
 */
export async function readPollVotes(sourcePublicKey: string): Promise<Map<number, number>> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_votes"))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    return new Map();
  }

  const result = simResult.result;
  if (!result) return new Map();
  const native = StellarSdk.scValToNative(result.retval);
  return native instanceof Map ? native : new Map(Object.entries(native).map(([k, v]) => [Number(k), Number(v)]));
}

/**
 * Read total votes
 */
export async function readTotalVotes(sourcePublicKey: string): Promise<number> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_total_votes"))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    return 0;
  }

  const result = simResult.result;
  if (!result) return 0;
  return StellarSdk.scValToNative(result.retval) as number;
}

/**
 * Check if an address has voted
 */
export async function checkHasVoted(sourcePublicKey: string, voterAddress: string): Promise<boolean> {
  const account = await rpcServer.getAccount(sourcePublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call("has_voted", StellarSdk.nativeToScVal(voterAddress, { type: "address" }))
    )
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    return false;
  }

  const result = simResult.result;
  if (!result) return false;
  return StellarSdk.scValToNative(result.retval) as boolean;
}

/**
 * Build a vote transaction (returns XDR for signing)
 */
export async function buildVoteTransaction(
  voterPublicKey: string,
  optionIndex: number
): Promise<string> {
  const account = await rpcServer.getAccount(voterPublicKey);
  const contract = new StellarSdk.Contract(CONTRACT_ID);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "vote",
        StellarSdk.nativeToScVal(voterPublicKey, { type: "address" }),
        StellarSdk.nativeToScVal(optionIndex, { type: "u32" })
      )
    )
    .setTimeout(60)
    .build();

  // Simulate to get the prepared transaction
  const simResult = await rpcServer.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = StellarSdk.rpc.assembleTransaction(tx, simResult).build();
  return preparedTx.toXDR();
}

/**
 * Submit a signed transaction
 */
export async function submitTransaction(signedXdr: string): Promise<{
  hash: string;
  status: string;
}> {
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await rpcServer.sendTransaction(tx);

  if (sendResult.status === "ERROR") {
    throw new Error("Transaction submission failed");
  }

  // Poll for result
  let getResult = await rpcServer.getTransaction(sendResult.hash);
  while (getResult.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await rpcServer.getTransaction(sendResult.hash);
  }

  if (getResult.status === "FAILED") {
    throw new Error("Transaction failed on-chain");
  }

  return {
    hash: sendResult.hash,
    status: getResult.status,
  };
}

/**
 * Fetch recent contract events
 */
export async function fetchContractEvents(startLedger?: number) {
  try {
    const latestLedger = await rpcServer.getLatestLedger();
    const start = startLedger || Math.max(1, latestLedger.sequence - 1000);

    const events = await rpcServer.getEvents({
      startLedger: start,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_ID],
        },
      ],
      limit: 20,
    });

    return {
      events: events.events || [],
      latestLedger: latestLedger.sequence,
    };
  } catch {
    return { events: [], latestLedger: 0 };
  }
}
