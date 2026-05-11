import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  buildSwapTransaction: vi.fn(),
  getTokenAId: vi.fn(() => "TOKEN_A_CONTRACT"),
  getTokenBId: vi.fn(() => "TOKEN_B_CONTRACT"),
}));

import { buildSwapXdrHandler, buildSwapXdrSchema } from "../lib/agent/tools/build-swap-xdr";
import { buildSwapTransaction } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("build-swap-xdr tool", () => {
  beforeEach(() => {
    vi.mocked(buildSwapTransaction).mockResolvedValue("swap_xdr_string");
  });

  describe("buildSwapXdrHandler", () => {
    it("should return xdr string from contract", async () => {
      const result = await buildSwapXdrHandler(
        { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 },
        "GPUBKEY"
      );
      expect(result.xdr).toBe("swap_xdr_string");
    });

    it("should echo back tokenIn, tokenOut, amountIn, minAmountOut", async () => {
      const result = await buildSwapXdrHandler(
        { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 },
        "GPUBKEY"
      );
      expect(result.tokenIn).toBe("TKNA");
      expect(result.tokenOut).toBe("TKNB");
      expect(result.amountIn).toBe(100);
      expect(result.minAmountOut).toBe(195);
    });

    it("should set tokenOut=TKNA when tokenIn=TKNB", async () => {
      const result = await buildSwapXdrHandler(
        { tokenIn: "TKNB", amountIn: 100, minAmountOut: 49 },
        "GPUBKEY"
      );
      expect(result.tokenOut).toBe("TKNA");
    });

    it("should call buildSwapTransaction with TOKEN_A_CONTRACT for TKNA", async () => {
      await buildSwapXdrHandler(
        { tokenIn: "TKNA", amountIn: 100, minAmountOut: 195 },
        "GPUBKEY"
      );
      expect(buildSwapTransaction).toHaveBeenCalledWith(
        "GPUBKEY",
        "TOKEN_A_CONTRACT",
        toRaw(100),
        toRaw(195)
      );
    });

    it("should call buildSwapTransaction with TOKEN_B_CONTRACT for TKNB", async () => {
      await buildSwapXdrHandler(
        { tokenIn: "TKNB", amountIn: 50, minAmountOut: 24 },
        "GPUBKEY"
      );
      expect(buildSwapTransaction).toHaveBeenCalledWith(
        "GPUBKEY",
        "TOKEN_B_CONTRACT",
        toRaw(50),
        toRaw(24)
      );
    });

    it("should handle fractional amounts", async () => {
      await buildSwapXdrHandler(
        { tokenIn: "TKNA", amountIn: 1.5, minAmountOut: 2.9 },
        "GPUBKEY"
      );
      expect(buildSwapTransaction).toHaveBeenCalledWith(
        "GPUBKEY",
        "TOKEN_A_CONTRACT",
        toRaw(1.5),
        toRaw(2.9)
      );
    });
  });
});

describe("buildSwapXdrSchema", () => {
  it("should have name build_swap_xdr", () => {
    expect(buildSwapXdrSchema.name).toBe("build_swap_xdr");
  });

  it("should have a description", () => {
    expect(typeof buildSwapXdrSchema.description).toBe("string");
    expect(buildSwapXdrSchema.description!.length).toBeGreaterThan(0);
  });

  it("should have an object input_schema with required properties", () => {
    expect(buildSwapXdrSchema.input_schema.type).toBe("object");
    expect(buildSwapXdrSchema.input_schema.required).toBeDefined();
  });
});
