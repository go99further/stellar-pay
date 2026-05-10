import { describe, it, expect, beforeEach } from "vitest";
import {
  isOperationAllowed,
  isAmountAllowed,
  isTokenAllowed,
  DEFAULT_PERMISSION_CONTEXT,
} from "../lib/agent/permissions";

describe("permissions", () => {
  describe("isOperationAllowed", () => {
    it("should allow operation not in denyList", () => {
      expect(isOperationAllowed(DEFAULT_PERMISSION_CONTEXT, "swap")).toBe(true);
    });

    it("should deny operation in denyList", () => {
      const ctx = { ...DEFAULT_PERMISSION_CONTEXT, denyOperations: ["remove_liquidity"] };
      expect(isOperationAllowed(ctx, "remove_liquidity")).toBe(false);
    });

    it("should allow all operations when denyList is empty", () => {
      expect(isOperationAllowed(DEFAULT_PERMISSION_CONTEXT, "add_liquidity")).toBe(true);
    });
  });

  describe("isAmountAllowed", () => {
    it("should allow amount at or below maxSwapAmount", () => {
      expect(isAmountAllowed(DEFAULT_PERMISSION_CONTEXT, 100_000)).toBe(true);
      expect(isAmountAllowed(DEFAULT_PERMISSION_CONTEXT, 50_000)).toBe(true);
    });

    it("should deny amount above maxSwapAmount", () => {
      expect(isAmountAllowed(DEFAULT_PERMISSION_CONTEXT, 100_001)).toBe(false);
    });

    it("should allow zero amount", () => {
      expect(isAmountAllowed(DEFAULT_PERMISSION_CONTEXT, 0)).toBe(true);
    });
  });

  describe("isTokenAllowed", () => {
    it("should allow tokens in allowedTokens list", () => {
      expect(isTokenAllowed(DEFAULT_PERMISSION_CONTEXT, "TKNA")).toBe(true);
      expect(isTokenAllowed(DEFAULT_PERMISSION_CONTEXT, "TKNB")).toBe(true);
    });

    it("should deny tokens not in allowedTokens list", () => {
      expect(isTokenAllowed(DEFAULT_PERMISSION_CONTEXT, "XLM")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(isTokenAllowed(DEFAULT_PERMISSION_CONTEXT, "tkna")).toBe(false);
    });
  });

  describe("DEFAULT_PERMISSION_CONTEXT", () => {
    it("should have maxSwapAmount of 100_000", () => {
      expect(DEFAULT_PERMISSION_CONTEXT.maxSwapAmount).toBe(100_000);
    });

    it("should allow TKNA and TKNB", () => {
      expect(DEFAULT_PERMISSION_CONTEXT.allowedTokens).toContain("TKNA");
      expect(DEFAULT_PERMISSION_CONTEXT.allowedTokens).toContain("TKNB");
    });

    it("should have empty denyOperations", () => {
      expect(DEFAULT_PERMISSION_CONTEXT.denyOperations).toHaveLength(0);
    });
  });
});
