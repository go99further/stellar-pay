import { NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

export async function GET() {
  try {
    const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
    const latest = await rpcServer.getLatestLedger();
    return NextResponse.json({ status: "ok", ledger: latest.sequence, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: "degraded", error: err instanceof Error ? err.message : "rpc error", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
