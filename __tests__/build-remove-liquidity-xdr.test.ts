import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn(),
  getLpSupply: vi.fn(),
  buildRemoveLiquidityTransaction: vi.fn(),
}));

import {
  simulateRemoveLiquidityHandler,
  buildRemoveLiquidityXdrHandler,
  simulateRemoveLiquiditySchema,
  buildRemoveLiquidityXdrSchema,
} from "../lib/agent/tools/build-remove-liquidity-xdr";
import { getReserves, getLpSupply, buildRemoveLiquidityTransaction } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("build-remove-liquidity-xdr tool", () => {
  beforeEach(() => {
    vi.mocked(getReserves).mockResolvedValue([toRaw(1_000_000), toRaw(2_000_000)]);
    vi.mocked(getLpSupply).mockResolvedValue(toRaw(500_000));
    vi.mocked(buildRemoveLiquidityTransaction).mockResolvedValue("xdr_base64_string");
  });

  describe("simulateRemoveLiquidityHandler", () => {
    it("should return formatted lpAmount", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000 });
      expect(result.lpAmount).toBe("1000.0");
    });

    it("should return positive estimatedA and estimatedB", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000 });
      expect(parseFloat(result.estimatedA)).toBeGreaterThan(0);
      expect(parseFloat(result.estimatedB)).toBeGreaterThan(0);
    });

    it("should return minA and minB less than estimated due to slippage", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000, slippageBps: 100 });
      expect(parseFloat(result.minA)).toBeLessThan(parseFloat(result.estimatedA));
      expect(parseFloat(result.minB)).toBeLessThan(parseFloat(result.estimatedB));
    });

    it("should use default slippageBps of 100", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000 });
      expect(result.slippageBps).toBe(100);
    });

    it("should use provided slippageBps", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000, slippageBps: 200 });
      expect(result.slippageBps).toBe(200);
    });

    it("should return zero amounts for zero lpAmount", async () => {
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 0 });
      expect(result.estimatedA).toBe("0.0");
      expect(result.estimatedB).toBe("0.0");
    });

    it("should return proportional amounts based on pool share", async () => {
      // 1000 LP out of 500,000 total = 0.2% of pool
      // reserveA = 1,000,000 → expect ~2000 TKNA
      const result = await simulateRemoveLiquidityHandler({ lpAmount: 1000 });
      const estimatedA = parseFloat(result.estimatedA);
      expect(estimatedA).toBeCloseTo(2000, 0);
    });
  });

  describe("buildRemoveLiquidityXdrHandler", () => {
    it("should return xdr string from contract", async () => {
      const result = await buildRemoveLiquidityXdrHandler(
        { lpAmount: 1000, minA: 1990, minB: 3980 },
        "GABC123"
      );
      expect(result.xdr).toBe("xdr_base64_string");
    });

    it("should echo back input amounts", async () => {
      const result = await buildRemoveLiquidityXdrHandler(
        { lpAmount: 1000, minA: 1990, minB: 3980 },
        "GABC123"
      );
      expect(result.lpAmount).toBe(1000);
      expect(result.minA).toBe(1990);
      expect(result.minB).toBe(3980);
    });

    it("should call buildRemoveLiquidityTransaction with correct raw amounts", async () => {
      await buildRemoveLiquidityXdrHandler(
        { lpAmount: 100, minA: 199, minB: 398 },
        "GPUBKEY"
      );
      expect(buildRemoveLiquidityTransaction).toHaveBeenCalledWith(
        "GPUBKEY",
        toRaw(100),
        toRaw(199),
        toRaw(398)
      );
    });
  });
});

describe("simulateRemoveLiquiditySchema", () => {
  it("should have name simulate_remove_liquidity", () => {
    expect(simulateRemoveLiquiditySchema.name).toBe("simulate_remove_liquidity");
  });

  it("should have a description", () => {
    expect(typeof simulateRemoveLiquiditySchema.description).toBe("string");
    expect(simulateRemoveLiquiditySchema.description!.length).toBeGreaterThan(0);
  });

  it("should have an object input_schema with required properties", () => {
    expect(simulateRemoveLiquiditySchema.input_schema.type).toBe("object");
    expect(simulateRemoveLiquiditySchema.input_schema.required).toBeDefined();
  });
});

describe("buildRemoveLiquidityXdrSchema", () => {
  it("should have name build_remove_liquidity_xdr", () => {
    expect(buildRemoveLiquidityXdrSchema.name).toBe("build_remove_liquidity_xdr");
  });

  it("should have a description", () => {
    expect(typeof buildRemoveLiquidityXdrSchema.description).toBe("string");
    expect(buildRemoveLiquidityXdrSchema.description!.length).toBeGreaterThan(0);
  });

  it("should have an object input_schema with required properties", () => {
    expect(buildRemoveLiquidityXdrSchema.input_schema.type).toBe("object");
    expect(buildRemoveLiquidityXdrSchema.input_schema.required).toBeDefined();
  });
});
