import type Anthropic from "@anthropic-ai/sdk";
import { buildAddLiquidityTransaction } from "@/lib/amm-contract";

const DECIMALS = 7;

function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

export const buildAddLiquidityXdrSchema: Anthropic.Tool = {
  name: "build_add_liquidity_xdr",
  description:
    "Build an unsigned add_liquidity transaction XDR. Returns XDR for Freighter to sign. Does NOT submit.",
  input_schema: {
    type: "object",
    properties: {
      amountA: { type: "number", description: "TKNA amount to deposit (human-readable)." },
      amountB: { type: "number", description: "TKNB amount to deposit (human-readable)." },
      minLp: { type: "number", description: "Minimum LP tokens to accept (human-readable). Use simulate_add_liquidity result." },
    },
    required: ["amountA", "amountB", "minLp"],
  },
};

export async function buildAddLiquidityXdrHandler(
  input: { amountA: number; amountB: number; minLp: number },
  userPublicKey: string
): Promise<{ xdr: string; amountA: number; amountB: number; minLp: number }> {
  const xdr = await buildAddLiquidityTransaction(
    userPublicKey,
    toRaw(input.amountA),
    toRaw(input.amountB),
    toRaw(input.minLp)
  );
  return { xdr, amountA: input.amountA, amountB: input.amountB, minLp: input.minLp };
}
