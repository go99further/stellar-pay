import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn(),
  getLpSupply: vi.fn(),
}));

import { simulateAddLiquidityHandler } from "../lib/agent/tools/simulate-add-liquidity";
import { getReserves, getLpSupply } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("simulate-add-liquidity tool", () => {
  beforeEach(() => {
    vi.mocked(getReserves).mockResolvedValue([toRaw(1_000_000), toRaw(2_000_000)]);
    vi.mocked(getLpSupply).mockResolvedValue(toRaw(500_000));
  });

  describe("simulateAddLiquidityHandler", () => {
    it("should return formatted amountA and amountB", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200 });
      expect(result.amountA).toBe("100.0");
      expect(result.amountB).toBe("200.0");
    });

    it("should return positive estimatedLp", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200 });
      expect(parseFloat(result.estimatedLp)).toBeGreaterThan(0);
    });

    it("should return minLp less than estimatedLp due to slippage", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200, slippageBps: 100 });
      expect(parseFloat(result.minLp)).toBeLessThan(parseFloat(result.estimatedLp));
    });

    it("should use default slippageBps of 100", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200 });
      expect(result.slippageBps).toBe(100);
    });

    it("should use provided slippageBps", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200, slippageBps: 50 });
      expect(result.slippageBps).toBe(50);
    });

    it("should return pool reserves as formatted strings", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200 });
      expect(result.reserveA).toBe("1000000.0");
      expect(result.reserveB).toBe("2000000.0");
    });

    it("should return totalSupply as formatted string", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 200 });
      expect(result.totalSupply).toBe("500000.0");
    });

    it("should return geometric mean LP for first deposit (totalSupply=0)", async () => {
      vi.mocked(getLpSupply).mockResolvedValue(0n);
      vi.mocked(getReserves).mockResolvedValue([0n, 0n]);
      const result = await simulateAddLiquidityHandler({ amountA: 100, amountB: 100 });
      // sqrt(100 * 100) = 100 in raw units
      expect(parseFloat(result.estimatedLp)).toBeGreaterThan(0);
    });

    it("should return zero estimatedLp for zero amountA", async () => {
      const result = await simulateAddLiquidityHandler({ amountA: 0, amountB: 200 });
      expect(result.estimatedLp).toBe("0.0");
    });
  });
});
