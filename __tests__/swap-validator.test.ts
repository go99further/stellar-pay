import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/amm-contract", () => ({
  getReserves: vi.fn(),
  getPrice: vi.fn(),
  getTokenAId: vi.fn(() => "A".repeat(56)),
  getTokenBId: vi.fn(() => "B".repeat(56)),
  getTokenBalance: vi.fn(),
}));

vi.mock("../lib/amm-math", () => ({
  getSwapOutput: vi.fn(),
}));

import { SwapValidator } from "../lib/agent/validators/swap-validator";
import { getReserves, getPrice, getTokenBalance } from "../lib/amm-contract";
import { getSwapOutput } from "../lib/amm-math";

const mockContract = {} as import("@stellar/stellar-sdk").Contract;

const ADDR_A = "A".repeat(56);
const ADDR_B = "B".repeat(56);
const USER  = "G".repeat(56);

const RESERVE = 10_000_000n * 10_000_000n; // 10M tokens in raw units

describe("SwapValidator", () => {
  let validator: SwapValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReserves).mockResolvedValue([RESERVE, RESERVE]);
    vi.mocked(getTokenBalance).mockResolvedValue(RESERVE);
    vi.mocked(getPrice).mockResolvedValue(99_000_000n);
    vi.mocked(getSwapOutput).mockReturnValue(99_000_000n);
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

  describe("validate – deadline checks", () => {
    it("should reject expired deadline", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) - 10,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "DEADLINE_PASSED")).toBe(true);
    });

    it("should warn on tight deadline (< 60s)", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 30,
        userAddress: USER,
      });

      expect(result.warnings.some((w) => w.code === "SHORT_DEADLINE")).toBe(true);
    });
  });

  describe("validate – network-dependent paths (mocked)", () => {
    it("returns valid=true when all checks pass", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.estimatedCost).toBeDefined();
    });

    it("returns INSUFFICIENT_BALANCE when user balance is too low", async () => {
      vi.mocked(getTokenBalance).mockResolvedValue(50n); // less than amountIn=100n

      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INSUFFICIENT_BALANCE")).toBe(true);
    });

    it("returns INSUFFICIENT_LIQUIDITY when pool reserves are too low", async () => {
      vi.mocked(getReserves).mockResolvedValue([RESERVE, 50n]); // reserveOut < minAmountOut

      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "INSUFFICIENT_LIQUIDITY")).toBe(true);
    });

    it("warns HIGH_TRADE_RATIO when trade is >10% of pool", async () => {
      vi.mocked(getReserves).mockResolvedValue([100n, 100n]); // tiny pool
      vi.mocked(getTokenBalance).mockResolvedValue(1000n);

      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 20n, // 20% of reserveIn=100
        minAmountOut: 1n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(result.warnings.some((w) => w.code === "HIGH_TRADE_RATIO")).toBe(true);
    });

    it("uses getSwapOutput fallback when getPrice returns 0", async () => {
      vi.mocked(getPrice).mockResolvedValue(0n);
      vi.mocked(getSwapOutput).mockReturnValue(95n);

      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(getSwapOutput).toHaveBeenCalled();
      expect(result.valid).toBe(true);
    });

    it("includes estimatedCost with gasFee and priceImpact", async () => {
      const result = await validator.validate({
        tokenIn: ADDR_A,
        tokenOut: ADDR_B,
        amountIn: 100n,
        minAmountOut: 90n,
        deadline: Math.floor(Date.now() / 1000) + 600,
        userAddress: USER,
      });

      expect(result.estimatedCost?.gasFee).toBe("0.0001 XLM");
      expect(typeof result.estimatedCost?.priceImpact).toBe("number");
    });
  });
});
