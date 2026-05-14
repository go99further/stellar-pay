import * as StellarSdk from "@stellar/stellar-sdk";
import { withRetry } from "./agent/tools/utils";

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const AMM_CONTRACT_ID = process.env.NEXT_PUBLIC_AMM_CONTRACT_ID || "";

const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

export interface RawAmmEvent {
  id: string;
  topic: string[];
  value: string;
  ledger: number;
}

/**
 * Fetch AMM contract events from Soroban RPC.
 * Defaults to last 1000 ledgers (~1 hour on testnet).
 */
export async function fetchAmmEvents(startLedger?: number): Promise<{
  events: RawAmmEvent[];
  latestLedger: number;
}> {
  if (!AMM_CONTRACT_ID) return { events: [], latestLedger: 0 };

  return withRetry(async () => {
    const latest = await rpcServer.getLatestLedger();
    const start = startLedger ?? Math.max(1, latest.sequence - 1000);

    const result = await rpcServer.getEvents({
      startLedger: start,
      filters: [
        {
          type: "contract" as const,
          contractIds: [AMM_CONTRACT_ID],
        },
      ],
      limit: 100,
    });

    const events: RawAmmEvent[] = (result.events || []).map((evt) => ({
      id: evt.id,
      topic: evt.topic.map((t) => t.toXDR("base64")),
      value: evt.value.toXDR("base64"),
      ledger: evt.ledger,
    }));

    return { events, latestLedger: latest.sequence };
  });
}
