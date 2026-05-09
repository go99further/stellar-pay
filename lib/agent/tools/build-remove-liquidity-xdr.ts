import type Anthropic from "@anthropic-ai/sdk";
import { buildRemoveLiquidityTransaction } from "@/lib/amm-contract";
import { getReserves, getLpSupply } from "@/lib/amm-contract";
import { getWithdrawAmounts, applySlippage } from "@/lib/amm-math";

const DECIMALS = 7;
const DUMMY_READER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

function formatAmount(raw: bigint): string {
  const str = raw.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, str.length - DECIMALS) || "0";
  const fracPart = str.slice(-DECIMALS).replace(/0+$/, "") || "0";
  return `${intPart}.${fracPart}`;
}

export const simulateRemoveLiquiditySchema: Anthropic.Tool = {
  name: "simulate_remove_liquidity",
  description:
    "Estimate TKNA and TKNB returned for burning a given LP token amount. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      lpAmount: {
        type: "number",
        description: "LP tokens to burn (human-readable).",
      },
      slippageBps: {
        type: "number",
        description: "Slippage tolerance in basis points (100 = 1%). Default 100.",
      },
    },
    required: ["lpAmount"],
  },
};

export async function simulateRemoveLiquidityHandler(input: {
  lpAmount: number;
  slippageBps?: number;
}): Promise<{
  lpAmount: string;
  estimatedA: string;
  estimatedB: string;
  minA: string;
  minB: string;
  slippageBps: number;
}> {
  const slippageBps = input.slippageBps ?? 100;
  const [[reserveA, reserveB], totalSupply] = await Promise.all([
    getReserves(DUMMY_READER),
    getLpSupply(DUMMY_READER),
  ]);

  const lpRaw = toRaw(input.lpAmount);
  const { amountA, amountB } = getWithdrawAmounts(lpRaw, reserveA, reserveB, totalSupply);
  const minA = applySlippage(amountA, BigInt(slippageBps));
  const minB = applySlippage(amountB, BigInt(slippageBps));

  return {
    lpAmount: formatAmount(lpRaw),
    estimatedA: formatAmount(amountA),
    estimatedB: formatAmount(amountB),
    minA: formatAmount(minA),
    minB: formatAmount(minB),
    slippageBps,
  };
}

export const buildRemoveLiquidityXdrSchema: Anthropic.Tool = {
  name: "build_remove_liquidity_xdr",
  description:
    "Build an unsigned remove_liquidity transaction XDR. Returns XDR for Freighter to sign. Does NOT submit.",
  input_schema: {
    type: "object",
    properties: {
      lpAmount: { type: "number", description: "LP tokens to burn (human-readable)." },
      minA: { type: "number", description: "Minimum TKNA to accept (human-readable). Use simulate_remove_liquidity result." },
      minB: { type: "number", description: "Minimum TKNB to accept (human-readable). Use simulate_remove_liquidity result." },
    },
    required: ["lpAmount", "minA", "minB"],
  },
};

export async function buildRemoveLiquidityXdrHandler(
  input: { lpAmount: number; minA: number; minB: number },
  userPublicKey: string
): Promise<{ xdr: string; lpAmount: number; minA: number; minB: number }> {
  const xdr = await buildRemoveLiquidityTransaction(
    userPublicKey,
    toRaw(input.lpAmount),
    toRaw(input.minA),
    toRaw(input.minB)
  );
  return { xdr, lpAmount: input.lpAmount, minA: input.minA, minB: input.minB };
}
