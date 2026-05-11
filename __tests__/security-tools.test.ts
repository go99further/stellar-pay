import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn(),
}));

vi.mock("@/lib/amm-events", () => ({
  fetchAmmEvents: vi.fn(),
}));

vi.mock("@/lib/event-decoder", () => ({
  decodeEventTopic: vi.fn(),
  decodeSwapEvent: vi.fn(),
  decodeLiquidityEvent: vi.fn(),
}));

import {
  checkPriceImpactHandler,
  analyzeLiquidityDepthHandler,
  scanRecentAnomaliesHandler,
  checkPriceImpactSchema,
  analyzeLiquidityDepthSchema,
  scanRecentAnomaliesSchema,
} from "../lib/agent/tools/security-tools";
import { getReserves } from "@/lib/amm-contract";
import { fetchAmmEvents } from "@/lib/amm-events";
import { decodeEventTopic, decodeSwapEvent, decodeLiquidityEvent } from "@/lib/event-decoder";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("security-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReserves).mockResolvedValue([toRaw(1_000_000), toRaw(2_000_000)]);
    vi.mocked(fetchAmmEvents).mockResolvedValue({ events: [], latestLedger: 100 });
    vi.mocked(decodeEventTopic).mockReturnValue("unknown");
    vi.mocked(decodeSwapEvent).mockReturnValue(null);
    vi.mocked(decodeLiquidityEvent).mockReturnValue(null);
  });

  describe("checkPriceImpactHandler", () => {
    it("should return priceImpactPct as numeric string", async () => {
      const result = await checkPriceImpactHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(isNaN(parseFloat(result.priceImpactPct))).toBe(false);
    });

    it("should return low risk for small trade", async () => {
      const result = await checkPriceImpactHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.riskLevel).toBe("low");
    });

    it("should return high risk for very large trade", async () => {
      // 500,000 TKNA into 1,000,000 reserve = ~50% price impact
      const result = await checkPriceImpactHandler({ tokenIn: "TKNA", amountIn: 500_000 });
      expect(result.riskLevel).toBe("high");
    });

    it("should return a recommendation string", async () => {
      const result = await checkPriceImpactHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(typeof result.recommendation).toBe("string");
      expect(result.recommendation.length).toBeGreaterThan(0);
    });

    it("should handle TKNB→TKNA direction", async () => {
      const result = await checkPriceImpactHandler({ tokenIn: "TKNB", amountIn: 100 });
      expect(result.riskLevel).toBeDefined();
    });
  });

  describe("analyzeLiquidityDepthHandler", () => {
    it("should return reserveA and reserveB as formatted strings", async () => {
      const result = await analyzeLiquidityDepthHandler();
      expect(result.reserveA).toBe("1000000.0");
      expect(result.reserveB).toBe("2000000.0");
    });

    it("should return low risk when no liquidity removed", async () => {
      const result = await analyzeLiquidityDepthHandler();
      expect(result.riskLevel).toBe("low");
      expect(result.outflowPct).toBe("0.00");
    });

    it("should detect high risk when large rem_liq events present", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "rem_liq_topic"], value: "val", ledger: 1 }],
        latestLedger: 1,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("rem_liq");
      vi.mocked(decodeLiquidityEvent).mockReturnValue({
        provider: "GPROVIDER",
        amountA: toRaw(300_000), // 30% of 1,000,000 reserve
        amountB: toRaw(600_000),
        lpAmount: toRaw(200_000),
      });
      const result = await analyzeLiquidityDepthHandler();
      expect(result.riskLevel).toBe("high");
    });

    it("should return netRemoveA and netRemoveB as formatted strings", async () => {
      const result = await analyzeLiquidityDepthHandler();
      expect(result.netRemoveA).toBe("0.0");
      expect(result.netRemoveB).toBe("0.0");
    });

    it("should return a recommendation string", async () => {
      const result = await analyzeLiquidityDepthHandler();
      expect(typeof result.recommendation).toBe("string");
    });
  });

  describe("scanRecentAnomaliesHandler", () => {
    it("should return totalEvents count", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [
          { id: "1", topic: ["", "t"], value: "v", ledger: 1 },
          { id: "2", topic: ["", "t"], value: "v", ledger: 2 },
        ],
        latestLedger: 2,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("unknown");
      const result = await scanRecentAnomaliesHandler();
      expect(result.totalEvents).toBe(0); // no decoded events
    });

    it("should return empty flaggedAddresses when no anomalies", async () => {
      const result = await scanRecentAnomaliesHandler();
      expect(result.flaggedAddresses).toHaveLength(0);
      expect(result.riskLevel).toBe("low");
    });

    it("should flag address that removes large portion of reserves", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "rem_liq_topic"], value: "val", ledger: 1 }],
        latestLedger: 1,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("rem_liq");
      vi.mocked(decodeLiquidityEvent).mockReturnValue({
        provider: "GBIGWHALE",
        amountA: toRaw(100_000), // 10% of 1,000,000 reserve → above 5% threshold
        amountB: toRaw(200_000),
        lpAmount: toRaw(70_000),
      });
      const result = await scanRecentAnomaliesHandler();
      expect(result.flaggedAddresses.length).toBeGreaterThan(0);
      expect(result.flaggedAddresses[0].address).toBe("GBIGWHALE");
    });

    it("should return a summary string", async () => {
      const result = await scanRecentAnomaliesHandler();
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });
});

describe("security-tools — schema exports", () => {
  it("checkPriceImpactSchema should have correct name and input_schema", () => {
    expect(checkPriceImpactSchema.name).toBe("check_price_impact");
    expect(checkPriceImpactSchema.input_schema).toBeDefined();
    expect(checkPriceImpactSchema.input_schema.type).toBe("object");
  });

  it("analyzeLiquidityDepthSchema should have correct name and input_schema", () => {
    expect(analyzeLiquidityDepthSchema.name).toBe("analyze_liquidity_depth");
    expect(analyzeLiquidityDepthSchema.input_schema).toBeDefined();
    expect(analyzeLiquidityDepthSchema.input_schema.type).toBe("object");
  });

  it("scanRecentAnomaliesSchema should have correct name and input_schema", () => {
    expect(scanRecentAnomaliesSchema.name).toBe("scan_recent_anomalies");
    expect(scanRecentAnomaliesSchema.input_schema).toBeDefined();
    expect(scanRecentAnomaliesSchema.input_schema.type).toBe("object");
  });

  it("all schemas should have description fields", () => {
    for (const schema of [checkPriceImpactSchema, analyzeLiquidityDepthSchema, scanRecentAnomaliesSchema]) {
      expect(typeof schema.description).toBe("string");
      expect(schema.description!.length).toBeGreaterThan(0);
    }
  });
});
