import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSuggestionParams,
  setSuggestionParams,
  clearSuggestionParams,
  tuneSuggestionParams,
  DEFAULT_PARAMS,
  type SuggestionParams,
} from "../lib/agent/alert-feedback-tuning";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Copied from alert-feedback.test.ts so this file is self-contained. */
function seedSwapHistory(prices: number[], tokenIn = "TKNA") {
  const key = "stellar-pay-transaction-history";
  const history = prices.map((p, i) => ({
    id: `${i}-h`,
    type: "swap" as const,
    timestamp: (i + 1) * 1000,
    details: { amountIn: 100, amountOut: 100 * p, tokenIn },
    txHash: `h${i}`,
    status: "success" as const,
  }));
  // newest first (matches transaction-history storage convention)
  localStorage.setItem(key, JSON.stringify(history.reverse()));
}

/** Generate a deterministic synthetic price series of length n. */
function makeSyntheticPrices(n: number): number[] {
  const prices: number[] = [];
  let p = 1.0;
  // Simple seeded walk: alternating up/down with a slight upward drift
  for (let i = 0; i < n; i++) {
    const direction = i % 3 === 0 ? -1 : 1;
    p = p + direction * 0.02 + 0.005;
    prices.push(Math.max(0.01, p));
  }
  return prices;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("alert-feedback-tuning", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // ── DEFAULT_PARAMS regression guard ────────────────────────────────────────

  describe("DEFAULT_PARAMS", () => {
    it("onlineWeight matches the previously hardcoded 0.6", () => {
      expect(DEFAULT_PARAMS.onlineWeight).toBe(0.6);
    });

    it("keepThreshold matches the previously hardcoded 0.75", () => {
      expect(DEFAULT_PARAMS.keepThreshold).toBe(0.75);
    });

    it("tightenThreshold matches the previously hardcoded 0.5", () => {
      expect(DEFAULT_PARAMS.tightenThreshold).toBe(0.5);
    });

    it("tightenDelta matches the previously hardcoded 0.05", () => {
      expect(DEFAULT_PARAMS.tightenDelta).toBe(0.05);
    });

    it("loosenDelta matches the previously hardcoded 0.03", () => {
      expect(DEFAULT_PARAMS.loosenDelta).toBe(0.03);
    });
  });

  // ── getSuggestionParams ─────────────────────────────────────────────────────

  describe("getSuggestionParams", () => {
    it("returns DEFAULT_PARAMS when localStorage is empty", () => {
      const p = getSuggestionParams();
      expect(p).toEqual(DEFAULT_PARAMS);
    });

    it("returns DEFAULT_PARAMS when stored JSON is malformed", () => {
      localStorage.setItem("stellar-pay-suggestion-params", "not-json{{{");
      expect(getSuggestionParams()).toEqual(DEFAULT_PARAMS);
    });

    it("returns DEFAULT_PARAMS when stored object is missing fields", () => {
      localStorage.setItem(
        "stellar-pay-suggestion-params",
        JSON.stringify({ onlineWeight: 0.5 })
      );
      expect(getSuggestionParams()).toEqual(DEFAULT_PARAMS);
    });

    it("returns DEFAULT_PARAMS when stored values fail range validation", () => {
      // tightenThreshold >= keepThreshold is invalid
      localStorage.setItem(
        "stellar-pay-suggestion-params",
        JSON.stringify({
          onlineWeight: 0.5,
          keepThreshold: 0.4,
          tightenThreshold: 0.6,
          tightenDelta: 0.05,
          loosenDelta: 0.03,
        })
      );
      expect(getSuggestionParams()).toEqual(DEFAULT_PARAMS);
    });
  });

  // ── setSuggestionParams ─────────────────────────────────────────────────────

  describe("setSuggestionParams", () => {
    it("persists params and getSuggestionParams reads them back identically", () => {
      const custom: SuggestionParams = {
        onlineWeight: 0.7,
        keepThreshold: 0.8,
        tightenThreshold: 0.4,
        tightenDelta: 0.06,
        loosenDelta: 0.04,
      };
      setSuggestionParams(custom);
      expect(getSuggestionParams()).toEqual(custom);
    });

    it("throws RangeError when onlineWeight is negative", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, onlineWeight: -0.1 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when onlineWeight exceeds 1", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, onlineWeight: 1.1 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when tightenDelta is zero", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, tightenDelta: 0 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when tightenDelta is negative", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, tightenDelta: -0.01 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when loosenDelta is zero", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, loosenDelta: 0 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when loosenDelta is negative", () => {
      expect(() =>
        setSuggestionParams({ ...DEFAULT_PARAMS, loosenDelta: -0.01 })
      ).toThrow(RangeError);
    });

    it("throws RangeError when tightenThreshold equals keepThreshold", () => {
      expect(() =>
        setSuggestionParams({
          ...DEFAULT_PARAMS,
          tightenThreshold: 0.75,
          keepThreshold: 0.75,
        })
      ).toThrow(RangeError);
    });

    it("throws RangeError when tightenThreshold exceeds keepThreshold", () => {
      expect(() =>
        setSuggestionParams({
          ...DEFAULT_PARAMS,
          tightenThreshold: 0.8,
          keepThreshold: 0.75,
        })
      ).toThrow(RangeError);
    });
  });

  // ── clearSuggestionParams ───────────────────────────────────────────────────

  describe("clearSuggestionParams", () => {
    it("removes persisted state so getSuggestionParams returns defaults", () => {
      setSuggestionParams({ ...DEFAULT_PARAMS, onlineWeight: 0.9 });
      expect(getSuggestionParams().onlineWeight).toBe(0.9);
      clearSuggestionParams();
      expect(getSuggestionParams()).toEqual(DEFAULT_PARAMS);
    });

    it("is a no-op when nothing is stored", () => {
      expect(() => clearSuggestionParams()).not.toThrow();
      expect(getSuggestionParams()).toEqual(DEFAULT_PARAMS);
    });
  });

  // ── tuneSuggestionParams ────────────────────────────────────────────────────

  describe("tuneSuggestionParams", () => {
    it("reports success=false with informative message when history is empty", () => {
      // localStorage is clear → no transaction history
      const report = tuneSuggestionParams();
      expect(report.success).toBe(false);
      expect(report.message.length).toBeGreaterThan(0);
      // Should mention empty history or insufficient data
      expect(report.message).toMatch(/空|不足|empty|insufficient/i);
    });

    it("reports success=false with informative message when history is too short", () => {
      // Only 5 prices — below the 10-point minimum
      seedSwapHistory([1.0, 1.05, 0.98, 1.02, 1.01]);
      const report = tuneSuggestionParams();
      expect(report.success).toBe(false);
      expect(report.message).toMatch(/5|不足|insufficient/i);
    });

    it("returns a report with all 5 params inside their valid bounds for synthetic history", () => {
      seedSwapHistory(makeSyntheticPrices(60));
      const report = tuneSuggestionParams();

      // Whether success or not, params must be in bounds
      const p = report.params;
      expect(p.onlineWeight).toBeGreaterThanOrEqual(0);
      expect(p.onlineWeight).toBeLessThanOrEqual(1);
      expect(p.keepThreshold).toBeGreaterThanOrEqual(0.5);
      expect(p.keepThreshold).toBeLessThanOrEqual(0.95);
      expect(p.tightenThreshold).toBeGreaterThanOrEqual(0.2);
      expect(p.tightenThreshold).toBeLessThanOrEqual(0.6);
      expect(p.tightenDelta).toBeGreaterThan(0);
      expect(p.loosenDelta).toBeGreaterThan(0);
      expect(p.tightenThreshold).toBeLessThan(p.keepThreshold);
    });

    it("is reproducible: calling twice with the same seeded history produces identical params", () => {
      const prices = makeSyntheticPrices(60);
      seedSwapHistory(prices);
      const report1 = tuneSuggestionParams();

      // Reset and re-seed with identical data
      localStorage.clear();
      seedSwapHistory(prices);
      const report2 = tuneSuggestionParams();

      expect(report1.params).toEqual(report2.params);
    });

    it("on success, persists params so getSuggestionParams returns the tuned values", () => {
      seedSwapHistory(makeSyntheticPrices(60));
      const report = tuneSuggestionParams();
      if (report.success) {
        expect(getSuggestionParams()).toEqual(report.params);
      }
      // If not success (e.g. overfit flag), params are NOT persisted — that's correct.
    });

    it("iqr is non-null when sample count > 0", () => {
      seedSwapHistory(makeSyntheticPrices(60));
      const report = tuneSuggestionParams();
      // With 60 price points we always get a Monte Carlo run → iqr must be populated
      expect(report.iqr).not.toBeNull();
      if (report.iqr) {
        expect(typeof report.iqr.p25.onlineWeight).toBe("number");
        expect(typeof report.iqr.p75.onlineWeight).toBe("number");
      }
    });

    it("TuningReport.baseline.testScore is computed even when tuning succeeds", () => {
      seedSwapHistory(makeSyntheticPrices(60));
      const report = tuneSuggestionParams();
      // baseline must always be present regardless of success/failure
      expect(report.baseline).toBeDefined();
      expect(typeof report.baseline.trainScore).toBe("number");
      expect(typeof report.baseline.validationScore).toBe("number");
      expect(typeof report.baseline.testScore).toBe("number");
      // On success the message should include the baseline delta line
      if (report.success) {
        expect(report.message).toMatch(/Baseline/i);
        expect(report.message).toMatch(/Tuned delta/i);
      }
    });

    it("TuningReport.baseline.testScore is computed even when tuning is rejected (overfitFlag/invalid)", () => {
      // Use a very short history that forces the early-return path (< 10 points)
      seedSwapHistory([1.0, 1.05, 0.98]);
      const report = tuneSuggestionParams();
      expect(report.success).toBe(false);
      // Even on the early-return path, baseline must be present and zeroed
      expect(report.baseline).toBeDefined();
      expect(report.baseline.trainScore).toBe(0);
      expect(report.baseline.validationScore).toBe(0);
      expect(report.baseline.testScore).toBe(0);
    });
  });
});
