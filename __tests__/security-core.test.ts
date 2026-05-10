import { describe, it, expect } from "vitest";
import {
  detectPriceImpact,
  detectLiquidityFlow,
  detectAnomalies,
  detectSandwich,
} from "@/lib/agent/security-core";

const U = 10_000_000n;

describe("detectPriceImpact", () => {
  it("low risk for small swap vs deep pool", () => {
    const r = detectPriceImpact(100n * U, "TKNA", 100_000n * U, 100_000n * U);
    expect(r.riskLevel).toBe("low");
    expect(r.priceImpactPct).toBeLessThan(1);
  });

  it("high risk for 20% of reserves", () => {
    const r = detectPriceImpact(20_000n * U, "TKNA", 100_000n * U, 100_000n * U);
    expect(r.riskLevel).toBe("high");
  });

  it("zero input returns zero impact", () => {
    const r = detectPriceImpact(0n, "TKNA", 100_000n * U, 100_000n * U);
    expect(r.priceImpactPct).toBe(0);
    expect(r.riskLevel).toBe("low");
  });
});

describe("detectLiquidityFlow", () => {
  it("low outflow when no removals", () => {
    const r = detectLiquidityFlow([], 100_000n * U);
    expect(r.riskLevel).toBe("low");
    expect(r.outflowPct).toBe(0);
  });

  it("high outflow when >20% removed", () => {
    const r = detectLiquidityFlow(
      [
        {
          kind: "rem_liq",
          ledger: 1,
          provider: "GX",
          amountA: 25_000n * U,
          amountB: 25_000n * U,
          lpAmount: 25_000n * U,
        },
      ],
      100_000n * U
    );
    expect(r.riskLevel).toBe("high");
    expect(r.outflowPct).toBeGreaterThan(20);
  });

  it("ignores swaps and add_liq", () => {
    const r = detectLiquidityFlow(
      [
        { kind: "swap", ledger: 1, user: "GA", tokenIn: "TKNA", amountIn: 10n * U, amountOut: 9n * U },
        { kind: "add_liq", ledger: 2, provider: "GB", amountA: 50_000n * U, amountB: 50_000n * U, lpAmount: 50_000n * U },
      ],
      100_000n * U
    );
    expect(r.riskLevel).toBe("low");
  });
});

describe("detectAnomalies", () => {
  it("flags single address with >5% removal", () => {
    const r = detectAnomalies(
      [
        {
          kind: "rem_liq",
          ledger: 1,
          provider: "GWHALE",
          amountA: 10_000n * U,
          amountB: 10_000n * U,
          lpAmount: 10_000n * U,
        },
      ],
      100_000n * U
    );
    expect(r.flaggedAddresses.map((f) => f.address)).toContain("GWHALE");
  });

  it("does not flag if all removals are <5% each", () => {
    const r = detectAnomalies(
      [
        { kind: "rem_liq", ledger: 1, provider: "GA", amountA: 2_000n * U, amountB: 2_000n * U, lpAmount: 2_000n * U },
        { kind: "rem_liq", ledger: 2, provider: "GB", amountA: 3_000n * U, amountB: 3_000n * U, lpAmount: 3_000n * U },
      ],
      100_000n * U
    );
    expect(r.flaggedAddresses).toEqual([]);
    expect(r.riskLevel).toBe("low");
  });
});

describe("detectSandwich", () => {
  it("detects classic front-run + back-run pattern", () => {
    const r = detectSandwich([
      { kind: "swap", ledger: 100, user: "GATTACKER", tokenIn: "TKNB", amountIn: 100n * U, amountOut: 90n * U },
      { kind: "swap", ledger: 101, user: "GVICTIM", tokenIn: "TKNB", amountIn: 10n * U, amountOut: 9n * U },
      { kind: "swap", ledger: 102, user: "GATTACKER", tokenIn: "TKNA", amountIn: 90n * U, amountOut: 105n * U },
    ]);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].attacker).toBe("GATTACKER");
  });

  it("does NOT flag when same user trades same direction twice", () => {
    const r = detectSandwich([
      { kind: "swap", ledger: 100, user: "GA", tokenIn: "TKNB", amountIn: 10n * U, amountOut: 9n * U },
      { kind: "swap", ledger: 101, user: "GB", tokenIn: "TKNB", amountIn: 5n * U, amountOut: 4n * U },
      { kind: "swap", ledger: 102, user: "GA", tokenIn: "TKNB", amountIn: 10n * U, amountOut: 9n * U },
    ]);
    expect(r.hits.length).toBe(0);
  });

  it("does NOT flag when window is too wide", () => {
    const r = detectSandwich([
      { kind: "swap", ledger: 100, user: "GA", tokenIn: "TKNB", amountIn: 10n * U, amountOut: 9n * U },
      { kind: "swap", ledger: 101, user: "GB", tokenIn: "TKNB", amountIn: 5n * U, amountOut: 4n * U },
      { kind: "swap", ledger: 999, user: "GA", tokenIn: "TKNA", amountIn: 9n * U, amountOut: 10n * U },
    ]);
    expect(r.hits.length).toBe(0);
  });
});
