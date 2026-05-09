import type Anthropic from "@anthropic-ai/sdk";
import { getReserves, getLpSupply } from "@/lib/amm-contract";
import { getLpTokensForDeposit, applySlippage } from "@/lib/amm-math";

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

export const simulateAddLiquiditySchema: Anthropic.Tool = {
  name: "simulate_add_liquidity",
  description:
    "Estimate LP tokens minted for a given TKNA + TKNB deposit. Returns estimated LP tokens and minimum LP with slippage. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      amountA: {
        type: "number",
        description: "Amount of TKNA to deposit (human-readable).",
      },
      amountB: {
        type: "number",
        description: "Amount of TKNB to deposit (human-readable).",
      },
      slippageBps: {
        type: "number",
        description: "Slippage tolerance in basis points (100 = 1%). Default 100.",
      },
    },
    required: ["amountA", "amountB"],
  },
};

export async function simulateAddLiquidityHandler(input: {
  amountA: number;
  amountB: number;
  slippageBps?: number;
}): Promise<{
  amountA: string;
  amountB: string;
  estimatedLp: string;
  minLp: string;
  slippageBps: number;
  reserveA: string;
  reserveB: string;
  totalSupply: string;
}> {
  const slippageBps = input.slippageBps ?? 100;
  const [[reserveA, reserveB], totalSupply] = await Promise.all([
    getReserves(DUMMY_READER),
    getLpSupply(DUMMY_READER),
  ]);

  const amountARaw = toRaw(input.amountA);
  const amountBRaw = toRaw(input.amountB);
  const estimatedLpRaw = getLpTokensForDeposit(amountARaw, amountBRaw, reserveA, reserveB, totalSupply);
  const minLpRaw = applySlippage(estimatedLpRaw, BigInt(slippageBps));

  return {
    amountA: formatAmount(amountARaw),
    amountB: formatAmount(amountBRaw),
    estimatedLp: formatAmount(estimatedLpRaw),
    minLp: formatAmount(minLpRaw),
    slippageBps,
    reserveA: formatAmount(reserveA),
    reserveB: formatAmount(reserveB),
    totalSupply: formatAmount(totalSupply),
  };
}
