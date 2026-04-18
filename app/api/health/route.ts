import { NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";

export async function GET() {
  try {
    const rpcServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
    const latest = await rpcServer.getLatestLedger();
    return NextResponse.json({
      status: "ok",
      rpc: true,
      latestLedger: latest.sequence,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", rpc: false, latestLedger: 0, timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
