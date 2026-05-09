import type Anthropic from "@anthropic-ai/sdk";
import { buildSwapTransaction, getTokenAId, getTokenBId } from "@/lib/amm-contract";

const DECIMALS = 7;

function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

export const buildSwapXdrSchema: Anthropic.Tool = {
  name: "build_swap_xdr",
  description:
    "Build an unsigned swap transaction XDR. Returns the XDR string for the frontend to sign with Freighter. Does NOT submit the transaction.",
  input_schema: {
    type: "object",
    properties: {
      tokenIn: {
        type: "string",
        enum: ["TKNA", "TKNB"],
        description: "Token to sell.",
      },
      amountIn: {
        type: "number",
        description: "Amount of tokenIn to sell (human-readable).",
      },
      minAmountOut: {
        type: "number",
        description: "Minimum acceptable output amount (human-readable). Use simulate_swap result.",
      },
    },
    required: ["tokenIn", "amountIn", "minAmountOut"],
  },
};

export async function buildSwapXdrHandler(
  input: { tokenIn: "TKNA" | "TKNB"; amountIn: number; minAmountOut: number },
  userPublicKey: string
): Promise<{ xdr: string; tokenIn: string; tokenOut: string; amountIn: number; minAmountOut: number }> {
  const tokenInAddress = input.tokenIn === "TKNA" ? getTokenAId() : getTokenBId();
  const tokenOut = input.tokenIn === "TKNA" ? "TKNB" : "TKNA";

  const xdr = await buildSwapTransaction(
    userPublicKey,
    tokenInAddress,
    toRaw(input.amountIn),
    toRaw(input.minAmountOut)
  );

  return { xdr, tokenIn: input.tokenIn, tokenOut, amountIn: input.amountIn, minAmountOut: input.minAmountOut };
}
