import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  buildAddLiquidityTransaction: vi.fn(),
}));

import { buildAddLiquidityXdrHandler } from "../lib/agent/tools/build-add-liquidity-xdr";
import { buildAddLiquidityTransaction } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("build-add-liquidity-xdr tool", () => {
  beforeEach(() => {
    vi.mocked(buildAddLiquidityTransaction).mockResolvedValue("add_liq_xdr_string");
  });

  describe("buildAddLiquidityXdrHandler", () => {
    it("should return xdr string from contract", async () => {
      const result = await buildAddLiquidityXdrHandler(
        { amountA: 100, amountB: 200, minLp: 99 },
        "GPUBKEY"
      );
      expect(result.xdr).toBe("add_liq_xdr_string");
    });

    it("should echo back input amounts", async () => {
      const result = await buildAddLiquidityXdrHandler(
        { amountA: 100, amountB: 200, minLp: 99 },
        "GPUBKEY"
      );
      expect(result.amountA).toBe(100);
      expect(result.amountB).toBe(200);
      expect(result.minLp).toBe(99);
    });

    it("should call buildAddLiquidityTransaction with correct raw amounts", async () => {
      await buildAddLiquidityXdrHandler(
        { amountA: 50, amountB: 100, minLp: 49 },
        "GPUBKEY123"
      );
      expect(buildAddLiquidityTransaction).toHaveBeenCalledWith(
        "GPUBKEY123",
        toRaw(50),
        toRaw(100),
        toRaw(49)
      );
    });

    it("should handle fractional amounts correctly", async () => {
      await buildAddLiquidityXdrHandler(
        { amountA: 1.5, amountB: 3.0, minLp: 1.4 },
        "GPUBKEY"
      );
      expect(buildAddLiquidityTransaction).toHaveBeenCalledWith(
        "GPUBKEY",
        toRaw(1.5),
        toRaw(3.0),
        toRaw(1.4)
      );
    });
  });
});
