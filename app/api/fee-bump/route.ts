import { NextRequest, NextResponse } from "next/server";
import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const SPONSOR_SECRET = process.env.FEE_BUMP_SPONSOR_SECRET || "";
const SPONSOR_PUBLIC = process.env.FEE_BUMP_SPONSOR_PUBLIC || "";

export async function POST(req: NextRequest) {
  if (!SPONSOR_SECRET || !SPONSOR_PUBLIC) {
    return NextResponse.json(
      { error: "Fee bump sponsor not configured" },
      { status: 503 }
    );
  }

  let signedXdr: string;
  try {
    const body = await req.json();
    signedXdr = body.signedXdr;
    if (!signedXdr || typeof signedXdr !== "string") {
      return NextResponse.json({ error: "signedXdr is required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const innerTx = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      NETWORK_PASSPHRASE
    ) as StellarSdk.Transaction;

    const sponsorKeypair = StellarSdk.Keypair.fromSecret(SPONSOR_SECRET);

    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      sponsorKeypair.publicKey(),
      "10000000",
      innerTx,
      NETWORK_PASSPHRASE
    );
    feeBumpTx.sign(sponsorKeypair);

    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const result = await server.submitTransaction(feeBumpTx);

    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fee bump failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
