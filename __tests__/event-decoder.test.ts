import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@stellar/stellar-sdk", () => {
  const mockScValToNative = vi.fn();
  const mockFromXDR = vi.fn();
  return {
    xdr: {
      ScVal: {
        fromXDR: mockFromXDR,
      },
    },
    scValToNative: mockScValToNative,
  };
});

import { decodeEventTopic, decodeSwapEvent, decodeLiquidityEvent } from "../lib/event-decoder";
import * as StellarSdk from "@stellar/stellar-sdk";

describe("event-decoder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("decodeEventTopic", () => {
    it("should decode a valid topic XDR to string", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue("swap");

      expect(decodeEventTopic("base64xdr")).toBe("swap");
    });

    it("should decode add_liq topic", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue("add_liq");

      expect(decodeEventTopic("base64xdr")).toBe("add_liq");
    });

    it("should decode rem_liq topic", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue("rem_liq");

      expect(decodeEventTopic("base64xdr")).toBe("rem_liq");
    });

    it("should return raw XDR string when decoding fails", () => {
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockImplementation(() => {
        throw new Error("invalid XDR");
      });

      expect(decodeEventTopic("invalid_xdr")).toBe("invalid_xdr");
    });
  });

  describe("decodeSwapEvent", () => {
    it("should decode a valid swap event", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue([
        "GUSER123",
        "TOKEN_A",
        "1000000000",
        "2000000000",
      ]);

      const result = decodeSwapEvent("base64xdr");
      expect(result).not.toBeNull();
      expect(result!.user).toBe("GUSER123");
      expect(result!.tokenIn).toBe("TOKEN_A");
      expect(result!.amountIn).toBe(1000000000n);
      expect(result!.amountOut).toBe(2000000000n);
    });

    it("should return null when XDR parsing fails", () => {
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockImplementation(() => {
        throw new Error("bad XDR");
      });

      expect(decodeSwapEvent("bad_xdr")).toBeNull();
    });

    it("should return null when native value is not an array", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue("not_an_array");

      expect(decodeSwapEvent("base64xdr")).toBeNull();
    });

    it("should return null when array has fewer than 4 elements", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue(["GUSER", "TOKEN_A", "100"]);

      expect(decodeSwapEvent("base64xdr")).toBeNull();
    });
  });

  describe("decodeLiquidityEvent", () => {
    it("should decode a valid add_liq event", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue([
        "GPROVIDER",
        "500000000",
        "1000000000",
        "700000000",
      ]);

      const result = decodeLiquidityEvent("base64xdr");
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("GPROVIDER");
      expect(result!.amountA).toBe(500000000n);
      expect(result!.amountB).toBe(1000000000n);
      expect(result!.lpAmount).toBe(700000000n);
    });

    it("should return null when XDR parsing fails", () => {
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockImplementation(() => {
        throw new Error("bad XDR");
      });

      expect(decodeLiquidityEvent("bad_xdr")).toBeNull();
    });

    it("should return null when native value is not an array", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue(42);

      expect(decodeLiquidityEvent("base64xdr")).toBeNull();
    });

    it("should return null when array has fewer than 4 elements", () => {
      const mockScVal = {};
      vi.mocked(StellarSdk.xdr.ScVal.fromXDR).mockReturnValue(mockScVal as never);
      vi.mocked(StellarSdk.scValToNative).mockReturnValue(["GPROVIDER", "100", "200"]);

      expect(decodeLiquidityEvent("base64xdr")).toBeNull();
    });
  });
});
