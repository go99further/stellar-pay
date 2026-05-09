import type Anthropic from "@anthropic-ai/sdk";
import { parseContractError } from "../utils";
import { getPoolStatsSchema, getPoolStatsHandler } from "./get-pool-stats";
import { getMetricsSchema, getMetricsHandler } from "./get-metrics";
import { getRecentEventsSchema, getRecentEventsHandler } from "./get-recent-events";
import { simulateSwapSchema, simulateSwapHandler } from "./simulate-swap";
import { buildSwapXdrSchema, buildSwapXdrHandler } from "./build-swap-xdr";
import { simulateAddLiquiditySchema, simulateAddLiquidityHandler } from "./simulate-add-liquidity";
import { buildAddLiquidityXdrSchema, buildAddLiquidityXdrHandler } from "./build-add-liquidity-xdr";
import {
  simulateRemoveLiquiditySchema,
  simulateRemoveLiquidityHandler,
  buildRemoveLiquidityXdrSchema,
  buildRemoveLiquidityXdrHandler,
} from "./build-remove-liquidity-xdr";
import {
  checkPriceImpactSchema,
  checkPriceImpactHandler,
  analyzeLiquidityDepthSchema,
  analyzeLiquidityDepthHandler,
  scanRecentAnomaliesSchema,
  scanRecentAnomaliesHandler,
} from "./security-tools";

export const analyticsTools: Anthropic.Tool[] = [
  getPoolStatsSchema,
  getMetricsSchema,
  getRecentEventsSchema,
];

export const tradingTools: Anthropic.Tool[] = [
  simulateSwapSchema,
  buildSwapXdrSchema,
  simulateAddLiquiditySchema,
  buildAddLiquidityXdrSchema,
  simulateRemoveLiquiditySchema,
  buildRemoveLiquidityXdrSchema,
];

export const securityTools: Anthropic.Tool[] = [
  checkPriceImpactSchema,
  analyzeLiquidityDepthSchema,
  scanRecentAnomaliesSchema,
];

async function dispatchTool(
  name: string,
  input: unknown,
  userPublicKey?: string
): Promise<unknown> {
  switch (name) {
    // analytics
    case "get_pool_stats":
      return getPoolStatsHandler();
    case "get_metrics":
      return getMetricsHandler();
    case "get_recent_events":
      return getRecentEventsHandler((input ?? {}) as { limit?: number });

    // trading — simulate (no wallet needed)
    case "simulate_swap":
      return simulateSwapHandler(input as { tokenIn: "TKNA" | "TKNB"; amountIn: number; slippageBps?: number });
    case "simulate_add_liquidity":
      return simulateAddLiquidityHandler(input as { amountA: number; amountB: number; slippageBps?: number });
    case "simulate_remove_liquidity":
      return simulateRemoveLiquidityHandler(input as { lpAmount: number; slippageBps?: number });

    // trading — build XDR (wallet required)
    case "build_swap_xdr": {
      if (!userPublicKey) throw new Error("Wallet not connected. Please connect Freighter first.");
      return buildSwapXdrHandler(
        input as { tokenIn: "TKNA" | "TKNB"; amountIn: number; minAmountOut: number },
        userPublicKey
      );
    }
    case "build_add_liquidity_xdr": {
      if (!userPublicKey) throw new Error("Wallet not connected. Please connect Freighter first.");
      return buildAddLiquidityXdrHandler(
        input as { amountA: number; amountB: number; minLp: number },
        userPublicKey
      );
    }
    case "build_remove_liquidity_xdr": {
      if (!userPublicKey) throw new Error("Wallet not connected. Please connect Freighter first.");
      return buildRemoveLiquidityXdrHandler(
        input as { lpAmount: number; minA: number; minB: number },
        userPublicKey
      );
    }

    // security
    case "check_price_impact":
      return checkPriceImpactHandler(input as { tokenIn: "TKNA" | "TKNB"; amountIn: number });
    case "analyze_liquidity_depth":
      return analyzeLiquidityDepthHandler();
    case "scan_recent_anomalies":
      return scanRecentAnomaliesHandler();

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function runTool(
  name: string,
  input: unknown,
  userPublicKey?: string
): Promise<unknown> {
  try {
    return await dispatchTool(name, input, userPublicKey);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "tool failed";
    const message = parseContractError(raw);
    throw new Error(message);
  }
}
