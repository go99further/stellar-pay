import type Anthropic from "@anthropic-ai/sdk";
import {
  getReserves,
  getLpSupply,
  getAmmContractId,
  getTokenAId,
  getTokenBId,
  getLpTokenId,
} from "@/lib/amm-contract";

const DUMMY_READER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const DECIMALS = 7;

function formatAmount(raw: bigint): string {
  const str = raw.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, str.length - DECIMALS) || "0";
  const fracPart = str.slice(-DECIMALS).replace(/0+$/, "") || "0";
  return `${intPart}.${fracPart}`;
}

export const getPoolStatsSchema: Anthropic.Tool = {
  name: "get_pool_stats",
  description:
    "Fetch current AMM pool state: reserve balances for Token A and Token B, LP token total supply, and configured contract IDs. Read-only.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export async function getPoolStatsHandler(): Promise<{
  tokenA: { contractId: string; reserve: string };
  tokenB: { contractId: string; reserve: string };
  lpToken: { contractId: string; totalSupply: string };
  ammContractId: string;
}> {
  const [reserves, supply] = await Promise.all([
    getReserves(DUMMY_READER),
    getLpSupply(DUMMY_READER),
  ]);
  return {
    tokenA: { contractId: getTokenAId(), reserve: formatAmount(reserves[0]) },
    tokenB: { contractId: getTokenBId(), reserve: formatAmount(reserves[1]) },
    lpToken: { contractId: getLpTokenId(), totalSupply: formatAmount(supply) },
    ammContractId: getAmmContractId(),
  };
}
