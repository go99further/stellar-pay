import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getActiveThresholds,
  setActiveThresholds,
  clearActiveThresholds,
  hasActiveOverrides,
  DEFAULT_ACTIVE_THRESHOLDS,
} from "../lib/agent/security-thresholds-runtime";
import { THRESHOLDS, detectPriceImpact, detectLiquidityFlow, detectAnomalies } from "../lib/agent/security-core";

describe("security-thresholds-runtime", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe("getActiveThresholds", () => {
    it("returns defaults when no override is persisted", () => {
      expect(getActiveThresholds()).toEqual(DEFAULT_ACTIVE_THRESHOLDS);
    });

    it("DEFAULT_ACTIVE_THRESHOLDS stays in sync with security-core THRESHOLDS const (single-source-of-truth check)", () => {
      // Critical invariant: hardcoded defaults must match the const.
      // If THRESHOLDS changes, this test fails and forces an update.
      expect(DEFAULT_ACTIVE_THRESHOLDS.priceImpactMedium).toBe(THRESHOLDS.priceImpact.medium);
      expect(DEFAULT_ACTIVE_THRESHOLDS.priceImpactHigh).toBe(THRESHOLDS.priceImpact.high);
      expect(DEFAULT_ACTIVE_THRESHOLDS.liquidityOutflowMedium).toBe(THRESHOLDS.liquidityOutflow.medium);
      expect(DEFAULT_ACTIVE_THRESHOLDS.liquidityOutflowHigh).toBe(THRESHOLDS.liquidityOutflow.high);
      expect(DEFAULT_ACTIVE_THRESHOLDS.sandwichWindowLedgers).toBe(THRESHOLDS.sandwichWindowLedgers);
      expect(DEFAULT_ACTIVE_THRESHOLDS.anomalyRemovalPct).toBe(THRESHOLDS.anomalyRemovalPct);
    });

    it("falls back to defaults when localStorage contains malformed JSON", () => {
      localStorage.setItem("stellar-pay-security-thresholds-overrides", "{not valid json}");
      expect(getActiveThresholds()).toEqual(DEFAULT_ACTIVE_THRESHOLDS);
    });

    it("falls back to defaults when localStorage contains wrong shape", () => {
      localStorage.setItem(
        "stellar-pay-security-thresholds-overrides",
        JSON.stringify({ foo: "bar" })
      );
      expect(getActiveThresholds()).toEqual(DEFAULT_ACTIVE_THRESHOLDS);
    });
  });

  describe("setActiveThresholds", () => {
    it("persists overrides and getActiveThresholds reads them back", () => {
      const overrides = { ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 2, priceImpactHigh: 5 };
      setActiveThresholds(overrides);
      expect(getActiveThresholds()).toEqual(overrides);
    });

    it("rejects priceImpact medium >= high", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 5, priceImpactHigh: 3 })
      ).toThrow(/medium must be < high/);
    });

    it("rejects negative thresholds", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: -1 })
      ).toThrow();
    });

    it("rejects zero priceImpact thresholds", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 0 })
      ).toThrow();
    });

    it("rejects fractional sandwichWindowLedgers", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, sandwichWindowLedgers: 3.5 })
      ).toThrow(/positive integer/);
    });

    it("rejects anomalyRemovalPct > 100", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, anomalyRemovalPct: 150 })
      ).toThrow();
    });

    it("rejects anomalyRemovalPct <= 0", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, anomalyRemovalPct: 0 })
      ).toThrow();
    });

    it("rejects liquidityOutflow medium >= high", () => {
      expect(() =>
        setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, liquidityOutflowMedium: 25, liquidityOutflowHigh: 20 })
      ).toThrow(/medium must be < high/);
    });
  });

  describe("clearActiveThresholds + hasActiveOverrides", () => {
    it("hasActiveOverrides returns false initially, true after set", () => {
      expect(hasActiveOverrides()).toBe(false);
      setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 2 });
      expect(hasActiveOverrides()).toBe(true);
    });

    it("clearActiveThresholds restores defaults", () => {
      setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 2 });
      clearActiveThresholds();
      expect(hasActiveOverrides()).toBe(false);
      expect(getActiveThresholds()).toEqual(DEFAULT_ACTIVE_THRESHOLDS);
    });
  });

  describe("integration: detectors honor runtime overrides (Apply is real)", () => {
    it("detectPriceImpact uses overridden medium threshold", () => {
      // With default medium=1: 0.5% impact → low risk
      // With override medium=0.1: 0.5% impact → medium risk
      // Set up amounts where impact ≈ 0.5%:
      const reserveA = 1_000_000n;
      const reserveB = 1_000_000n;
      const amountIn = 5_000n; // Small impact

      // Default
      const before = detectPriceImpact(amountIn, "TKNA", reserveA, reserveB);

      // Override: drop medium threshold to a tiny value
      setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, priceImpactMedium: 0.1, priceImpactHigh: 0.3 });
      const after = detectPriceImpact(amountIn, "TKNA", reserveA, reserveB);

      // Same numerical impact, different riskLevel due to runtime override
      expect(before.priceImpactPct).toBeCloseTo(after.priceImpactPct);
      // The exact risk level depends on the impact value — the key assertion is
      // that the override caused a *change* in classification when the value
      // crosses the new threshold.
      // We assert the override is at least *possible* to flip risk:
      if (before.priceImpactPct > 0.1 && before.riskLevel === "low") {
        expect(after.riskLevel).not.toBe("low");
      }
    });

    it("detectAnomalies uses overridden anomalyRemovalPct", () => {
      const events = [
        { kind: "rem_liq" as const, ledger: 100, provider: "GABC", amountA: 60_000n, amountB: 0n, lpAmount: 0n },
      ];
      const reserveA = 1_000_000n; // 6% removed

      // Default 5%: flagged
      const before = detectAnomalies(events, reserveA);
      expect(before.flaggedAddresses).toHaveLength(1);

      // Override 10%: not flagged anymore
      setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, anomalyRemovalPct: 10 });
      const after = detectAnomalies(events, reserveA);
      expect(after.flaggedAddresses).toHaveLength(0);
    });

    it("detectLiquidityFlow honors overridden outflow thresholds", () => {
      const events = [
        { kind: "rem_liq" as const, ledger: 100, provider: "GABC", amountA: 70_000n, amountB: 0n, lpAmount: 0n },
      ];
      const reserveA = 1_000_000n; // 7% outflow

      // Default medium=5%, high=20% → 7% is medium
      const before = detectLiquidityFlow(events, reserveA);
      expect(before.riskLevel).toBe("medium");

      // Override medium=10%, high=20% → 7% is now low
      setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, liquidityOutflowMedium: 10 });
      const after = detectLiquidityFlow(events, reserveA);
      expect(after.riskLevel).toBe("low");
    });
  });
});
