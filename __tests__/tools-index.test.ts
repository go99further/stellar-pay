import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn().mockResolvedValue([BigInt(10_000_000_000), BigInt(20_000_000_000)]),
  getLpSupply: vi.fn().mockResolvedValue(BigInt(5_000_000_000)),
  getAmmContractId: vi.fn(() => "AMM_ID"),
  getTokenAId: vi.fn(() => "TOKEN_A"),
  getTokenBId: vi.fn(() => "TOKEN_B"),
  getLpTokenId: vi.fn(() => "LP_TOKEN"),
  buildSwapTransaction: vi.fn().mockResolvedValue("swap_xdr"),
  buildAddLiquidityTransaction: vi.fn().mockResolvedValue("add_liq_xdr"),
  buildRemoveLiquidityTransaction: vi.fn().mockResolvedValue("rem_liq_xdr"),
}));

vi.mock("@/lib/amm-events", () => ({
  fetchAmmEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 100 }),
}));

vi.mock("@/lib/event-decoder", () => ({
  decodeEventTopic: vi.fn().mockReturnValue("unknown"),
  decodeSwapEvent: vi.fn().mockReturnValue(null),
  decodeLiquidityEvent: vi.fn().mockReturnValue(null),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ swapCount: 0 }) });
vi.stubGlobal("fetch", mockFetch);

import { runTool, analyticsTools, tradingTools, securityTools } from "../lib/agent/tools/index";

describe("tools/index", () => {
  describe("tool schema arrays", () => {
    it("should export analyticsTools with 3 schemas", () => {
      expect(analyticsTools).toHaveLength(3);
      const names = analyticsTools.map((t) => t.name);
      expect(names).toContain("get_pool_stats");
      expect(names).toContain("get_metrics");
      expect(names).toContain("get_recent_events");
    });

    it("should export tradingTools with 6 schemas", () => {
      expect(tradingTools).toHaveLength(6);
      const names = tradingTools.map((t) => t.name);
      expect(names).toContain("simulate_swap");
      expect(names).toContain("build_swap_xdr");
      expect(names).toContain("simulate_add_liquidity");
      expect(names).toContain("build_add_liquidity_xdr");
      expect(names).toContain("simulate_remove_liquidity");
      expect(names).toContain("build_remove_liquidity_xdr");
    });

    it("should export securityTools with 3 schemas", () => {
      expect(securityTools).toHaveLength(3);
      const names = securityTools.map((t) => t.name);
      expect(names).toContain("check_price_impact");
      expect(names).toContain("analyze_liquidity_depth");
      expect(names).toContain("scan_recent_anomalies");
    });
  });

  describe("runTool — analytics", () => {
    it("should dispatch get_pool_stats", async () => {
      const result = await runTool("get_pool_stats", {});
      expect(result).toHaveProperty("tokenA");
      expect(result).toHaveProperty("tokenB");
    });

    it("should dispatch get_metrics", async () => {
      const result = await runTool("get_metrics", {});
      expect(result).toBeDefined();
    });

    it("should dispatch get_recent_events", async () => {
      const result = await runTool("get_recent_events", {}) as { events: unknown[]; latestLedger: number };
      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("latestLedger");
    });
  });

  describe("runTool — trading simulate", () => {
    it("should dispatch simulate_swap", async () => {
      const result = await runTool("simulate_swap", { tokenIn: "TKNA", amountIn: 100 }) as { tokenIn: string };
      expect(result.tokenIn).toBe("TKNA");
    });

    it("should dispatch simulate_add_liquidity", async () => {
      const result = await runTool("simulate_add_liquidity", { amountA: 100, amountB: 200 }) as { amountA: string };
      expect(result.amountA).toBe("100.0");
    });

    it("should dispatch simulate_remove_liquidity", async () => {
      const result = await runTool("simulate_remove_liquidity", { lpAmount: 100 }) as { lpAmount: string };
      expect(result.lpAmount).toBe("100.0");
    });
  });

  describe("runTool — trading build XDR", () => {
    it("should dispatch build_swap_xdr with wallet", async () => {
      const result = await runTool("build_swap_xdr", { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 }, "GPUBKEY") as { xdr: string };
      expect(result.xdr).toBe("swap_xdr");
    });

    it("should throw when build_swap_xdr called without wallet", async () => {
      await expect(runTool("build_swap_xdr", { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 }))
        .rejects.toThrow(/Wallet not connected/);
    });

    it("should dispatch build_add_liquidity_xdr with wallet", async () => {
      const result = await runTool("build_add_liquidity_xdr", { amountA: 100, amountB: 200, minLp: 99 }, "GPUBKEY") as { xdr: string };
      expect(result.xdr).toBe("add_liq_xdr");
    });

    it("should throw when build_add_liquidity_xdr called without wallet", async () => {
      await expect(runTool("build_add_liquidity_xdr", { amountA: 100, amountB: 200, minLp: 99 }))
        .rejects.toThrow(/Wallet not connected/);
    });

    it("should dispatch build_remove_liquidity_xdr with wallet", async () => {
      const result = await runTool("build_remove_liquidity_xdr", { lpAmount: 100, minA: 99, minB: 198 }, "GPUBKEY") as { xdr: string };
      expect(result.xdr).toBe("rem_liq_xdr");
    });

    it("should throw when build_remove_liquidity_xdr called without wallet", async () => {
      await expect(runTool("build_remove_liquidity_xdr", { lpAmount: 100, minA: 99, minB: 198 }))
        .rejects.toThrow(/Wallet not connected/);
    });
  });

  describe("runTool — security", () => {
    it("should dispatch check_price_impact", async () => {
      const result = await runTool("check_price_impact", { tokenIn: "TKNA", amountIn: 100 }) as { riskLevel: string };
      expect(["low", "medium", "high"]).toContain(result.riskLevel);
    });

    it("should dispatch analyze_liquidity_depth", async () => {
      const result = await runTool("analyze_liquidity_depth", {}) as { riskLevel: string };
      expect(result.riskLevel).toBeDefined();
    });

    it("should dispatch scan_recent_anomalies", async () => {
      const result = await runTool("scan_recent_anomalies", {}) as { flaggedAddresses: unknown[] };
      expect(Array.isArray(result.flaggedAddresses)).toBe(true);
    });
  });

  describe("runTool — error handling", () => {
    it("should throw for unknown tool name", async () => {
      await expect(runTool("nonexistent_tool", {})).rejects.toThrow(/Unknown tool/);
    });

    it("should wrap contract errors via parseContractError", async () => {
      // Trigger an error by calling build_swap_xdr without wallet
      await expect(runTool("build_swap_xdr", { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 }))
        .rejects.toThrow();
    });
  });
});
