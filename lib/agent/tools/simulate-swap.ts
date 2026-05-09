import type Anthropic from "@anthropic-ai/sdk";
import { getReserves, getTokenAId, getTokenBId } from "@/lib/amm-contract";
import { getSwapOutput, getPriceImpact, applySlippage } from "@/lib/amm-math";

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

export const simulateSwapSchema: Anthropic.Tool = {
  name: "simulate_swap",
  description:
    "Estimate swap output, price impact, fee, and minimum received for a given input amount and slippage tolerance. Read-only — does not submit any transaction.",
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
        description: "Amount of tokenIn to sell (human-readable, e.g. 100.5).",
      },
      slippageBps: {
        type: "number",
        description: "Slippage tolerance in basis points (100 = 1%). Default 100.",
      },
    },
    required: ["tokenIn", "amountIn"],
  },
};

export interface SimulateSwapResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  estimatedOut: string;
  minAmountOut: string;
  priceImpactPct: string;
  feePct: string;
  slippageBps: number;
  reserveIn: string;
  reserveOut: string;
}

export async function simulateSwapHandler(input: {
  tokenIn: "TKNA" | "TKNB";
  amountIn: number;
  slippageBps?: number;
}): Promise<SimulateSwapResult> {
  const slippageBps = input.slippageBps ?? 100;
  const [reserveA, reserveB] = await getReserves(DUMMY_READER);

  const isAtoB = input.tokenIn === "TKNA";
  const reserveIn = isAtoB ? reserveA : reserveB;
  const reserveOut = isAtoB ? reserveB : reserveA;
  const tokenOut = isAtoB ? "TKNB" : "TKNA";

  const amountInRaw = toRaw(input.amountIn);
  const estimatedOutRaw = getSwapOutput(amountInRaw, reserveIn, reserveOut);
  const minAmountOutRaw = applySlippage(estimatedOutRaw, BigInt(slippageBps));
  const priceImpact = getPriceImpact(amountInRaw, reserveIn, reserveOut);

  return {
    tokenIn: input.tokenIn,
    tokenOut,
    amountIn: formatAmount(amountInRaw),
    estimatedOut: formatAmount(estimatedOutRaw),
    minAmountOut: formatAmount(minAmountOutRaw),
    priceImpactPct: priceImpact.toFixed(4),
    feePct: "0.3",
    slippageBps,
    reserveIn: formatAmount(reserveIn),
    reserveOut: formatAmount(reserveOut),
  };
}

export function getTokenAddress(symbol: "TKNA" | "TKNB"): string {
  return symbol === "TKNA" ? getTokenAId() : getTokenBId();
}
