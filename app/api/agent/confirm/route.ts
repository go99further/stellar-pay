import { NextRequest } from "next/server";
import { submitAmmTransaction } from "@/lib/amm-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfirmRequest {
  signedXdr: string;
  operationType: "swap" | "add_liquidity" | "remove_liquidity";
}

export async function POST(req: NextRequest) {
  let body: ConfirmRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const { signedXdr, operationType } = body;

  if (!signedXdr || typeof signedXdr !== "string") {
    return new Response(JSON.stringify({ error: "signedXdr is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!["swap", "add_liquidity", "remove_liquidity"].includes(operationType)) {
    return new Response(JSON.stringify({ error: "Invalid operationType" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const result = await submitAmmTransaction(signedXdr);

    return new Response(
      JSON.stringify({
        success: true,
        txHash: result.hash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.hash}`,
        operationType,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transaction submission failed";
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}
