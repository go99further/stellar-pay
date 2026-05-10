import { describe, it, expect, beforeEach } from "vitest";
import { SwapValidator } from "../lib/agent/validators/swap-validator";

// SwapValidator requires a Contract instance; we mock it minimally
const mockContract = {} as import("@stellar/stellar-sdk").Contract;

// 56-char Stellar-style addresses
const ADDR_A = "A".repeat(56);
const ADDR_B = "B".repeat(56);
const USER  = "G".repeat(56);

describe("SwapValidator", () => {
  let validator: SwapValidator;

  beforeEach(() => {
    validator = new SwapValidator(mockContract);
  });

  describe("validate – basic param checks (no network calls)", () => {
    it("should reject zero amountIn", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 0n,
        minAmountOut: 0n,
        deadline: Date.now() + 60000,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "amountIn")).toBe(true);
    });

    it("should reject same-token swap", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_A,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Date.now() + 60000,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject short tokenIn address", async () => {
      const result = await validator.validate({
        tokenIn: "SHORT",
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Date.now() + 60000,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "tokenIn")).toBe(true);
    });

    it("should reject empty userAddress", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Date.now() + 60000,
        userAddress: "",
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "userAddress")).toBe(true);
    });
  });
});
