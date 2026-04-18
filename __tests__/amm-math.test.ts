import { describe, it, expect } from "vitest";
import {
  integerSqrt,
  getSwapOutput,
  getPriceImpact,
  getLpTokensForDeposit,
  getWithdrawAmounts,
  applySlippage,
  checkSlippage,
} from "../lib/amm-math";

describe("integerSqrt", () => {
  it("returns 0 for 0", () => {
    expect(integerSqrt(0n)).toBe(0n);
  });

  it("returns correct sqrt for perfect squares", () => {
    expect(integerSqrt(100n)).toBe(10n);
    expect(integerSqrt(10000n)).toBe(100n);
    expect(integerSqrt(1_000_000n)).toBe(1000n);
  });

  it("floors non-perfect squares", () => {
    expect(integerSqrt(2n)).toBe(1n);
    expect(integerSqrt(8n)).toBe(2n);
    expect(integerSqrt(99n)).toBe(9n);
  });
});

describe("getSwapOutput (0.3% fee, constant product)", () => {
  it("returns correct output for simple swap", () => {
    // 1000 in, pool 10000/10000 → 997*10000 / (10000*1000 + 997*1000) ≈ 906
    const out = getSwapOutput(1000n, 10000n, 10000n);
    expect(out).toBe(906n);
  });

  it("returns 0 for zero input", () => {
    expect(getSwapOutput(0n, 10000n, 10000n)).toBe(0n);
  });

  it("returns 0 for empty pool", () => {
    expect(getSwapOutput(1000n, 0n, 10000n)).toBe(0n);
    expect(getSwapOutput(1000n, 10000n, 0n)).toBe(0n);
  });

  it("larger input gives larger output (monotone)", () => {
    const out1 = getSwapOutput(100n, 10000n, 10000n);
    const out2 = getSwapOutput(1000n, 10000n, 10000n);
    expect(out2).toBeGreaterThan(out1);
  });

  it("constant product k never decreases after swap (fee increases k)", () => {
    const rIn = 10000n;
    const rOut = 10000n;
    const amtIn = 1000n;
    const amtOut = getSwapOutput(amtIn, rIn, rOut);
    const kBefore = rIn * rOut;
    const kAfter = (rIn + amtIn) * (rOut - amtOut);
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });
});

describe("getPriceImpact", () => {
  it("small trade has low impact", () => {
    // 10 units in a 1,000,000 deep pool — well under 1%
    const impact = getPriceImpact(10n, 1_000_000n, 1_000_000n);
    expect(impact).toBeLessThan(1);
  });

  it("large trade has higher impact than small trade", () => {
    const small = getPriceImpact(100n, 10000n, 10000n);
    const large = getPriceImpact(5000n, 10000n, 10000n);
    expect(large).toBeGreaterThan(small);
  });

  it("returns 0 for zero input", () => {
    expect(getPriceImpact(0n, 10000n, 10000n)).toBe(0);
  });
});

describe("getLpTokensForDeposit", () => {
  it("first deposit: returns sqrt(a * b)", () => {
    // sqrt(100 * 100) = 100
    const lp = getLpTokensForDeposit(100n, 100n, 0n, 0n, 0n);
    expect(lp).toBe(100n);
  });

  it("first deposit: unequal amounts uses sqrt(a*b)", () => {
    // sqrt(400 * 100) = sqrt(40000) = 200
    const lp = getLpTokensForDeposit(400n, 100n, 0n, 0n, 0n);
    expect(lp).toBe(200n);
  });

  it("subsequent deposit: proportional to existing reserves", () => {
    // Pool: rA=1000, rB=1000, supply=1000
    // Add 100 A + 100 B → min(100*1000/1000, 100*1000/1000) = 100
    const lp = getLpTokensForDeposit(100n, 100n, 1000n, 1000n, 1000n);
    expect(lp).toBe(100n);
  });

  it("subsequent deposit: limited by smaller ratio", () => {
    // Pool: rA=1000, rB=2000, supply=1000
    // Add 200 A + 200 B → lpA=200*1000/1000=200, lpB=200*1000/2000=100 → min=100
    const lp = getLpTokensForDeposit(200n, 200n, 1000n, 2000n, 1000n);
    expect(lp).toBe(100n);
  });
});

describe("getWithdrawAmounts", () => {
  it("proportional withdrawal", () => {
    // Supply=1000, rA=500, rB=2000, burn 100 → 50 A + 200 B
    const { amountA, amountB } = getWithdrawAmounts(100n, 500n, 2000n, 1000n);
    expect(amountA).toBe(50n);
    expect(amountB).toBe(200n);
  });

  it("returns zeros for zero lp_amount", () => {
    const { amountA, amountB } = getWithdrawAmounts(0n, 500n, 2000n, 1000n);
    expect(amountA).toBe(0n);
    expect(amountB).toBe(0n);
  });
});

describe("applySlippage", () => {
  it("50 bps = 0.5% → 995 for 1000", () => {
    expect(applySlippage(1000n, 50n)).toBe(995n);
  });

  it("zero slippage returns original amount", () => {
    expect(applySlippage(1000n, 0n)).toBe(1000n);
  });

  it("100 bps = 1% → 990 for 1000", () => {
    expect(applySlippage(1000n, 100n)).toBe(990n);
  });
});

describe("checkSlippage", () => {
  it("passes when output >= minimum", () => {
    expect(checkSlippage(995n, 990n)).toBe(true);
  });

  it("fails when output < minimum", () => {
    expect(checkSlippage(989n, 990n)).toBe(false);
  });
});
