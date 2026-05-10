import { describe, it, expect, vi, beforeEach } from "vitest";
import { vi as vitest } from "vitest";

// Mock @/lib/amm-contract before importing the handler
vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn(),
  getLpSupply: vi.fn(),
  getTokenAId: vi.fn(() => "TOKEN_A_CONTRACT"),
  getTokenBId: vi.fn(() => "TOKEN_B_CONTRACT"),
}));

import { simulateSwapHandler, getTokenAddress } from "../lib/agent/tools/simulate-swap";
import { getReserves } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("simulate-swap tool", () => {
  beforeEach(() => {
    vi.mocked(getReserves).mockResolvedValue([
      toRaw(1_000_000), // reserveA = 1,000,000 TKNA
      toRaw(2_000_000), // reserveB = 2,000,000 TKNB
    ]);
  });

  describe("simulateSwapHandler", () => {
    it("should return correct token pair for TKNA→TKNB swap", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.tokenIn).toBe("TKNA");
      expect(result.tokenOut).toBe("TKNB");
    });

    it("should return correct token pair for TKNB→TKNA swap", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNB", amountIn: 100 });
      expect(result.tokenIn).toBe("TKNB");
      expect(result.tokenOut).toBe("TKNA");
    });

    it("should return formatted amountIn string", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.amountIn).toBe("100.0");
    });

    it("should return positive estimatedOut", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      const out = parseFloat(result.estimatedOut);
      expect(out).toBeGreaterThan(0);
    });

    it("should return minAmountOut less than estimatedOut due to slippage", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100, slippageBps: 100 });
      const estimated = parseFloat(result.estimatedOut);
      const min = parseFloat(result.minAmountOut);
      expect(min).toBeLessThan(estimated);
    });

    it("should use default slippageBps of 100 when not provided", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.slippageBps).toBe(100);
    });

    it("should use provided slippageBps", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100, slippageBps: 50 });
      expect(result.slippageBps).toBe(50);
    });

    it("should return feePct of 0.3", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.feePct).toBe("0.3");
    });

    it("should return priceImpactPct as a numeric string", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(isNaN(parseFloat(result.priceImpactPct))).toBe(false);
    });

    it("should return positive recommendedSlippageBps", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.recommendedSlippageBps).toBeGreaterThan(0);
    });

    it("should return reserveIn and reserveOut as formatted strings", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      expect(result.reserveIn).toBe("1000000.0");
      expect(result.reserveOut).toBe("2000000.0");
    });

    it("should swap reserve direction for TKNB→TKNA", async () => {
      const result = await simulateSwapHandler({ tokenIn: "TKNB", amountIn: 100 });
      expect(result.reserveIn).toBe("2000000.0");
      expect(result.reserveOut).toBe("1000000.0");
    });

    it("should return higher price impact for larger trade", async () => {
      const small = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100 });
      const large = await simulateSwapHandler({ tokenIn: "TKNA", amountIn: 100_000 });
      expect(parseFloat(large.priceImpactPct)).toBeGreaterThan(parseFloat(small.priceImpactPct));
    });
  });

  describe("getTokenAddress", () => {
    it("should return TKNA contract address", () => {
      expect(getTokenAddress("TKNA")).toBe("TOKEN_A_CONTRACT");
    });

    it("should return TKNB contract address", () => {
      expect(getTokenAddress("TKNB")).toBe("TOKEN_B_CONTRACT");
    });
  });
});
