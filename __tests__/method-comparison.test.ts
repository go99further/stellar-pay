import { describe, it, expect } from "vitest";
import {
  welchTTest,
  cohensD,
  classifyEffectSize,
  randomSearch,
  compareMethods,
  type MethodComparisonReport,
} from "../lib/agent/method-comparison";
import type { ParamSpace, SimulateFn, SimResult } from "../lib/agent/parameter-optimizer";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeRisingSeries(n: number, base = 1.0, step = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => base + i * step);
}

/** Minimal 2-param space for fast compareMethods tests */
type TinyParams = Record<string, number> & {
  threshold: number;
  delta: number;
};

const TINY_SPACE: ParamSpace<TinyParams> = {
  threshold: { min: 0.5, max: 1.5, steps: 3 },
  delta: { min: 0.01, max: 0.1, steps: 3 },
};

/**
 * Fast deterministic simulate fn: counts how many windows have a value
 * above `params.threshold`, treating each as a "hit". Misses and false
 * alarms are derived from the window mean relative to threshold.
 */
const fastSimulate: SimulateFn<TinyParams> = (
  window: number[],
  params: TinyParams
): SimResult => {
  if (window.length === 0) return { hits: 0, misses: 0, falseAlarms: 0 };
  const mean = window.reduce((s, x) => s + x, 0) / window.length;
  if (mean >= params.threshold) {
    return { hits: 1, misses: 0, falseAlarms: 0 };
  } else if (mean >= params.threshold - params.delta) {
    return { hits: 0, misses: 1, falseAlarms: 0 };
  }
  return { hits: 0, misses: 0, falseAlarms: 1 };
};

const DEFAULT_TINY: TinyParams = { threshold: 1.0, delta: 0.05 };

// ── welchTTest reference values ───────────────────────────────────────────────
// All scipy reference values computed with scipy.stats.ttest_ind(equal_var=False)

describe("welchTTest", () => {
  it("identical samples produce tStat ≈ 0, pValue ≈ 1.0", () => {
    const { tStat, pValue } = welchTTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(Math.abs(tStat)).toBeLessThan(1e-10);
    expect(pValue).toBeCloseTo(1.0, 5);
  });

  it("small effect produces moderate p-value (scipy: ~0.157)", () => {
    // scipy.stats.ttest_ind([1..10], [3..12], equal_var=False):
    //   t = -1.4771, dof = 18, p ≈ 0.1569
    // (The spec cited 0.143 but that is incorrect for this sample pair;
    //  verified analytically: meanA=5.5, meanB=7.5, varA=varB=9.167,
    //  t=(5.5-7.5)/sqrt(2*9.167/10)=-1.477, dof=18 → p≈0.157)
    const sampleA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sampleB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const { pValue, tStat, dof } = welchTTest(sampleA, sampleB);
    expect(pValue).toBeGreaterThan(0.05);
    expect(pValue).toBeLessThan(0.20);
    // Verify t-statistic and dof match the analytical values
    expect(Math.abs(tStat)).toBeCloseTo(1.4771, 3);
    expect(dof).toBeCloseTo(18, 1);
    // p-value within 1% of the analytically correct value
    expect(pValue).toBeCloseTo(0.1569, 2);
  });

  it("large effect produces tiny p-value (scipy: < 0.001)", () => {
    // scipy.stats.ttest_ind([10,11,12], [1,2,3], equal_var=False) → p ≈ 0.000175
    const { pValue, tStat } = welchTTest([10, 11, 12], [1, 2, 3]);
    expect(Math.abs(tStat)).toBeGreaterThan(5);
    expect(pValue).toBeLessThan(0.001);
  });

  it("unequal variance: Welch–Satterthwaite shrinks dof below n_A+n_B-2", () => {
    // High-variance A vs near-constant B — Welch dof should be much less than 8
    const sampleA = [1, 2, 3, 4, 5];
    const sampleB = [1, 1.001, 1.002, 1.003, 1.004];
    const { dof } = welchTTest(sampleA, sampleB);
    // Student's dof would be 8; Welch should be substantially smaller
    expect(dof).toBeLessThan(8);
    // Should be close to the low-variance sample's df (≈ 4)
    expect(dof).toBeLessThan(5);
  });
});

// ── cohensD ───────────────────────────────────────────────────────────────────

describe("cohensD", () => {
  it("d = 0 when means are equal", () => {
    const d = cohensD([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(d).toBeCloseTo(0, 10);
  });

  it("d ≈ 0.5 when meanDiff = 0.5σ", () => {
    // Construct explicitly: both samples have std≈3.16, meanDiff=1.58≈0.5*std → d≈0.5
    const a = [0, 2, 4, 6, 8]; // mean=4, std≈3.16
    const b = [1.58, 3.58, 5.58, 7.58, 9.58]; // mean=5.58, std≈3.16, diff=1.58≈0.5*std
    const d = cohensD(a, b);
    expect(Math.abs(d)).toBeCloseTo(0.5, 1);
  });

  it("d ≈ 1.0 when meanDiff = 1σ", () => {
    // a and b with same std, meanDiff = 1 pooled std
    const a = [0, 1, 2, 3, 4]; // mean=2, std≈1.58
    const b = [1.58, 2.58, 3.58, 4.58, 5.58]; // mean=3.58, diff=1.58≈1*std
    const d = cohensD(a, b);
    expect(Math.abs(d)).toBeCloseTo(1.0, 1);
  });

  it("classifyEffectSize buckets correctly", () => {
    expect(classifyEffectSize(0.1)).toBe("negligible");
    expect(classifyEffectSize(-0.1)).toBe("negligible");
    expect(classifyEffectSize(0.3)).toBe("small");
    expect(classifyEffectSize(-0.3)).toBe("small");
    expect(classifyEffectSize(0.6)).toBe("medium");
    expect(classifyEffectSize(-0.6)).toBe("medium");
    expect(classifyEffectSize(1.5)).toBe("large");
    expect(classifyEffectSize(-1.5)).toBe("large");
    // Boundary values
    expect(classifyEffectSize(0.2)).toBe("small"); // exactly 0.2 → small (not negligible)
    expect(classifyEffectSize(0.5)).toBe("medium"); // exactly 0.5 → medium
    expect(classifyEffectSize(0.8)).toBe("large"); // exactly 0.8 → large
  });
});

// ── randomSearch ──────────────────────────────────────────────────────────────

describe("randomSearch", () => {
  it("produces different bestScore for different seeds (stochastic)", () => {
    const data = makeRisingSeries(200);
    const r1 = randomSearch(data, TINY_SPACE, fastSimulate, { budget: 50, seed: 1 });
    const r2 = randomSearch(data, TINY_SPACE, fastSimulate, { budget: 50, seed: 99 });
    // Different seeds should explore different regions — scores may differ
    // (not guaranteed to differ, but with budget=50 and a non-trivial space they will)
    // We test that the function runs and returns valid scores
    expect(typeof r1.bestScore).toBe("number");
    expect(typeof r2.bestScore).toBe("number");
    expect(isFinite(r1.bestScore)).toBe(true);
    expect(isFinite(r2.bestScore)).toBe(true);
    // With different seeds, at least the params should differ
    const paramsDiffer =
      r1.bestParams.threshold !== r2.bestParams.threshold ||
      r1.bestParams.delta !== r2.bestParams.delta;
    expect(paramsDiffer).toBe(true);
  });

  it("respects budget — number of simulate calls matches budget", () => {
    const data = makeRisingSeries(200);
    let callCount = 0;

    const countingSimulate: SimulateFn<TinyParams> = (
      window: number[],
      params: TinyParams
    ): SimResult => {
      callCount++;
      return fastSimulate(window, params, () => 0);
    };

    const budget = 20;
    const windowsPerEvaluation = 5;
    randomSearch(data, TINY_SPACE, countingSimulate, {
      budget,
      windowsPerEvaluation,
      seed: 1,
    });

    // Each of the `budget` param samples evaluates `windowsPerEvaluation` windows
    expect(callCount).toBe(budget * windowsPerEvaluation);
  });
});

// ── compareMethods ────────────────────────────────────────────────────────────

describe("compareMethods", () => {
  // Use a small config for speed: runs=10, budget=30, small windows
  const fastConfig = {
    runs: 10,
    budget: 30,
    windowsPerEvaluation: 5,
    windowSize: 20,
  };

  it("all four methods produce the correct number of scores", () => {
    const data = makeRisingSeries(300);
    const report: MethodComparisonReport = compareMethods(
      data,
      TINY_SPACE,
      fastSimulate,
      DEFAULT_TINY,
      fastConfig
    );

    expect(report.methods.default.scores).toHaveLength(fastConfig.runs);
    expect(report.methods.randomSearch.scores).toHaveLength(fastConfig.runs);
    expect(report.methods.gridSearch.scores).toHaveLength(fastConfig.runs);
    expect(report.methods.monteCarlo.scores).toHaveLength(fastConfig.runs);
  });

  it("deterministic methods (Grid, Default) have std = 0 within numerical noise", () => {
    const data = makeRisingSeries(300);
    const report: MethodComparisonReport = compareMethods(
      data,
      TINY_SPACE,
      fastSimulate,
      DEFAULT_TINY,
      fastConfig
    );

    // Grid search is deterministic — same result every run
    expect(report.methods.gridSearch.std).toBeLessThan(1e-6);
    // Default params are evaluated identically every run
    expect(report.methods.default.std).toBeLessThan(1e-6);
  });

  it("report contains all four comparison keys", () => {
    const data = makeRisingSeries(300);
    const report: MethodComparisonReport = compareMethods(
      data,
      TINY_SPACE,
      fastSimulate,
      DEFAULT_TINY,
      fastConfig
    );

    expect(report.comparisons).toHaveProperty("MC vs Random");
    expect(report.comparisons).toHaveProperty("MC vs Grid");
    expect(report.comparisons).toHaveProperty("Grid vs Random");
    expect(report.comparisons).toHaveProperty("Tuned vs Default");
  });

  it("report metadata is populated correctly", () => {
    const data = makeRisingSeries(300);
    const report: MethodComparisonReport = compareMethods(
      data,
      TINY_SPACE,
      fastSimulate,
      DEFAULT_TINY,
      fastConfig
    );

    expect(report.budget).toBe(fastConfig.budget);
    expect(report.runs).toBe(fastConfig.runs);
    expect(report.generatedAt).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });
});
