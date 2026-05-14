/**
 * Method Comparison Framework — Statistical validation of Monte Carlo
 *
 * Why this module exists: a reviewer rightly pointed out that comparing
 * "Default vs Grid (100 iter) vs MC (500 iter)" was an unfair comparison.
 * Different budgets, single seed, no significance test. We can't claim
 * Monte Carlo "wins" without controlling for these.
 *
 * Fixes:
 *   - Budget standardization: every method gets the same `budget` evaluations
 *   - 30 runs per method with seeds [1..30] for variance estimation
 *   - Welch's t-test (not Student's) — methods use independent samples,
 *     no natural pairing, and we cannot assume equal variance
 *   - Cohen's d for effect size — p-value says "real?", d says "how big?"
 *
 * Note on naming: this module *uses* the existing parameter-optimizer's
 * monteCarloSearch and gridSearch but adds a Random Search baseline (the
 * "untargeted" version of MC) and the statistical comparison layer.
 *
 * Limitations (documented in docs/LIMITATIONS.md L9–L11):
 *   - No Bonferroni correction for multiple comparisons
 *   - No formal Shapiro–Wilk normality test (large n + CLT assumed)
 *   - No prospective power analysis
 */

import {
  monteCarloSearch,
  gridSearch,
  mulberry32,
  DEFAULT_WEIGHTS,
  type ParamSpace,
  type SimulateFn,
  type ScoringWeights,
} from "./parameter-optimizer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MethodScores {
  scores: number[]; // length = runs (30 by default)
  mean: number;
  std: number; // sample std with n-1 denominator
  min: number;
  max: number;
}

export interface ComparisonResult {
  // Two-sample comparison: A vs B
  meanA: number;
  meanB: number;
  meanDiff: number; // meanA - meanB
  tStat: number;
  dof: number; // Welch–Satterthwaite degrees of freedom
  pValue: number; // two-tailed
  cohensD: number; // pooled-std normalized effect size
  significant: boolean; // pValue < 0.05
  effectSize: "negligible" | "small" | "medium" | "large";
}

export interface MethodComparisonReport {
  budget: number; // standardized evaluations per run
  runs: number; // typically 30
  methods: {
    default: MethodScores; // budget=1 (single eval of DEFAULT_PARAMS)
    randomSearch: MethodScores;
    gridSearch: MethodScores; // deterministic — std should be ~0
    monteCarlo: MethodScores;
  };
  comparisons: {
    "MC vs Random": ComparisonResult;
    "MC vs Grid": ComparisonResult;
    "Grid vs Random": ComparisonResult;
    "Tuned vs Default": ComparisonResult; // best-of-MC vs default baseline
  };
  generatedAt: number;
  durationMs: number;
}

// ── Helper: descriptive statistics ───────────────────────────────────────────

function summarize(scores: number[]): MethodScores {
  const n = scores.length;
  if (n === 0) {
    return { scores: [], mean: 0, std: 0, min: 0, max: 0 };
  }
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const variance =
    n > 1
      ? scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)
      : 0;
  const std = Math.sqrt(variance);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return { scores, mean, std, min, max };
}

// ── Random Search — the missing baseline ─────────────────────────────────────

/**
 * Random Search — sample `budget` parameter sets uniformly from the space,
 * evaluate each on the data, return the best.
 *
 * Why this matters: without Random Search, "Monte Carlo wins" might just mean
 * "more iterations win". Random Search at the same budget tells us whether
 * MC's *structured* sampling (windowed simulation, top-percentile reporting)
 * adds value beyond raw iteration count.
 */
export function randomSearch<P extends Record<string, number>>(
  data: number[],
  space: ParamSpace<P>,
  simulate: SimulateFn<P>,
  config: {
    budget?: number; // default 500 — number of param samples to try
    windowsPerEvaluation?: number; // default 50 — how many data windows per eval
    windowSize?: number; // default 50
    weights?: ScoringWeights;
    seed?: number; // default 1
  } = {}
): { bestScore: number; bestParams: P } {
  const {
    budget = 500,
    windowsPerEvaluation = 50,
    windowSize = 50,
    weights = DEFAULT_WEIGHTS,
    seed = 1,
  } = config;

  const rng = mulberry32(seed);
  const keys = Object.keys(space) as (keyof P)[];

  // Sample a single window set for consistent evaluation across all candidates.
  // We use the same rng so the window selection is part of the seeded sequence.
  const effectiveWindowSize = data.length <= windowSize ? data.length : windowSize;
  const maxStart = data.length > effectiveWindowSize ? data.length - effectiveWindowSize : 0;

  let bestScore = -Infinity;
  let bestParams: P = {} as P;

  for (let i = 0; i < budget; i++) {
    // Sample params uniformly from space
    const params = {} as P;
    for (const key of keys) {
      const spec = space[key];
      params[key] = (spec.min + rng() * (spec.max - spec.min)) as P[typeof key];
    }

    // Sample windowsPerEvaluation windows and average the score
    let totalScore = 0;
    let windowCount = 0;

    if (data.length === 0) {
      // No data — score is 0
    } else if (data.length <= effectiveWindowSize) {
      // Single window fallback
      const result = simulate(data.slice(), params, rng);
      totalScore = result.hits * weights.hit + result.misses * weights.miss + result.falseAlarms * weights.falseAlarm;
      windowCount = 1;
    } else {
      for (let w = 0; w < windowsPerEvaluation; w++) {
        const start = Math.floor(rng() * (maxStart + 1));
        const window = data.slice(start, start + effectiveWindowSize);
        const result = simulate(window, params, rng);
        totalScore += result.hits * weights.hit + result.misses * weights.miss + result.falseAlarms * weights.falseAlarm;
        windowCount++;
      }
    }

    const avgScore = windowCount > 0 ? totalScore / windowCount : 0;

    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestParams = { ...params };
    }
  }

  return { bestScore, bestParams };
}

// ── Regularized Incomplete Beta — numerical core for t-distribution CDF ──────

/**
 * Regularized incomplete beta function I_x(a, b) via Lentz's continued-fraction
 * method (Numerical Recipes, §6.4). Converges in ~30 iterations for typical
 * t-test inputs.
 *
 * Used by welchTTest to compute the two-tailed p-value from the t-distribution.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x < 0 || x > 1) return NaN;
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use the symmetry relation when x > (a+1)/(a+b+2) for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  // Log of the beta function prefactor: x^a * (1-x)^b / (a * B(a,b))
  const lbeta =
    Math.log(x) * a +
    Math.log(1 - x) * b -
    Math.log(a) -
    logBeta(a, b);

  // Lentz's continued fraction for the incomplete beta
  const cf = continuedFractionBeta(x, a, b);
  return Math.exp(lbeta) * cf;
}

/** log B(a, b) = log Γ(a) + log Γ(b) − log Γ(a+b) via Lanczos approximation */
function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Lanczos approximation for log Γ(z), accurate to ~15 significant figures */
function logGamma(z: number): number {
  // Coefficients from Numerical Recipes (g=7, n=9)
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    // Reflection formula: Γ(z)Γ(1-z) = π/sin(πz)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  const zz = z - 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (zz + i);
  }
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Continued fraction expansion for the incomplete beta function (Lentz's method).
 * Returns the CF value (without the prefactor).
 */
function continuedFractionBeta(x: number, a: number, b: number): number {
  const maxIter = 200;
  const eps = 3e-7;
  const fpMin = 1e-30;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1.0;
  let d = 1.0 - qab * x / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1.0 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;

    // Even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1.0 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1.0 / d;
    h *= d * c;

    // Odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1.0 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1.0 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1.0 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1.0) < eps) break;
  }

  return h;
}

// ── Welch's t-test ────────────────────────────────────────────────────────────

/**
 * Welch's t-test for two independent samples with potentially unequal variance.
 *
 * Why Welch (not Student's): we cannot assume equal variance across methods —
 * Grid Search has near-zero variance (deterministic), Random Search has high.
 * Student's t-test assumes σ_A = σ_B and would give wrong p-values.
 *
 * Why two-tailed: we don't have a directional hypothesis a priori.
 *
 * Returns:
 *   tStat — Welch t-statistic
 *   dof   — Welch–Satterthwaite approximation of degrees of freedom
 *   pValue — two-tailed
 *
 * Reference: Welch, B. L. (1947). The generalization of "Student's"
 * problem when several different population variances are involved.
 */
export function welchTTest(
  sampleA: number[],
  sampleB: number[]
): { tStat: number; dof: number; pValue: number } {
  const nA = sampleA.length;
  const nB = sampleB.length;

  if (nA < 2 || nB < 2) {
    return { tStat: 0, dof: 0, pValue: 1 };
  }

  const meanA = sampleA.reduce((s, x) => s + x, 0) / nA;
  const meanB = sampleB.reduce((s, x) => s + x, 0) / nB;

  const varA = sampleA.reduce((s, x) => s + (x - meanA) ** 2, 0) / (nA - 1);
  const varB = sampleB.reduce((s, x) => s + (x - meanB) ** 2, 0) / (nB - 1);

  const seA = varA / nA;
  const seB = varB / nB;
  const se = Math.sqrt(seA + seB);

  if (se === 0) {
    // Both samples are constant and equal — t = 0, p = 1
    return { tStat: 0, dof: nA + nB - 2, pValue: 1 };
  }

  const tStat = (meanA - meanB) / se;

  // Welch–Satterthwaite degrees of freedom
  const dof = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));

  // Two-tailed p-value via t-distribution CDF using regularized incomplete beta:
  // P(T > |t|) = I_x(dof/2, 1/2)  where x = dof / (dof + t²)
  const tSq = tStat * tStat;
  const x = dof / (dof + tSq);
  const ibeta = regularizedIncompleteBeta(x, dof / 2, 0.5);
  const pValue = Math.min(1, Math.max(0, ibeta));

  return { tStat, dof, pValue };
}

// ── Cohen's d ─────────────────────────────────────────────────────────────────

/**
 * Cohen's d — standardized difference between two means.
 *
 * Convention: small = 0.2, medium = 0.5, large = 0.8+.
 *
 * Why alongside p-value: p-value tells if effect exists (statistical
 * significance), Cohen's d tells how large (practical significance).
 * A large sample with tiny effect can have p < 0.001 but d = 0.05 — that's
 * statistically real but practically meaningless.
 *
 * Formula: (mean_A - mean_B) / pooled_std
 * pooled_std = sqrt(((n_A - 1)*var_A + (n_B - 1)*var_B) / (n_A + n_B - 2))
 */
export function cohensD(sampleA: number[], sampleB: number[]): number {
  const nA = sampleA.length;
  const nB = sampleB.length;

  if (nA < 2 || nB < 2) return 0;

  const meanA = sampleA.reduce((s, x) => s + x, 0) / nA;
  const meanB = sampleB.reduce((s, x) => s + x, 0) / nB;

  const varA = sampleA.reduce((s, x) => s + (x - meanA) ** 2, 0) / (nA - 1);
  const varB = sampleB.reduce((s, x) => s + (x - meanB) ** 2, 0) / (nB - 1);

  const pooledVar = ((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2);
  const pooledStd = Math.sqrt(pooledVar);

  if (pooledStd === 0) return 0;

  return (meanA - meanB) / pooledStd;
}

export function classifyEffectSize(
  d: number
): "negligible" | "small" | "medium" | "large" {
  const abs = Math.abs(d);
  if (abs < 0.2) return "negligible";
  if (abs < 0.5) return "small";
  if (abs < 0.8) return "medium";
  return "large";
}

// ── buildComparison — internal helper ────────────────────────────────────────

function buildComparison(
  scoresA: number[],
  scoresB: number[]
): ComparisonResult {
  const nA = scoresA.length;
  const nB = scoresB.length;

  const meanA = nA > 0 ? scoresA.reduce((s, x) => s + x, 0) / nA : 0;
  const meanB = nB > 0 ? scoresB.reduce((s, x) => s + x, 0) / nB : 0;

  const { tStat, dof, pValue } = welchTTest(scoresA, scoresB);
  const d = cohensD(scoresA, scoresB);

  return {
    meanA,
    meanB,
    meanDiff: meanA - meanB,
    tStat,
    dof,
    pValue,
    cohensD: d,
    significant: pValue < 0.05,
    effectSize: classifyEffectSize(d),
  };
}

// ── compareMethods — the orchestrator ────────────────────────────────────────

/**
 * Run all four methods for `runs` independent trials at standardized
 * `budget`, return scores + pairwise Welch t-tests.
 *
 * Seed strategy: seeds [1..runs]. Simple, explainable, explicit. We
 * deliberately do NOT use derived seeds — a reviewer asking "where do
 * your seeds come from" should get "I used 1 through 30, that's it."
 *
 * Budget standardization:
 *   - default: 1 evaluation (deterministic — std = 0 by definition)
 *   - randomSearch: budget evaluations
 *   - gridSearch: takes the first `budget` grid points (or all if grid <= budget)
 *   - monteCarlo: budget iterations
 *
 * For Grid Search, std across runs is ~0 because the grid is deterministic.
 * We still report it for completeness — std=0 is informative ("this method
 * has no run-to-run variance").
 */
export function compareMethods<P extends Record<string, number>>(
  data: number[],
  space: ParamSpace<P>,
  simulate: SimulateFn<P>,
  defaultParams: P,
  config: {
    runs?: number; // default 30
    budget?: number; // default 500 evaluations per run
    windowsPerEvaluation?: number;
    windowSize?: number;
    weights?: ScoringWeights;
  } = {}
): MethodComparisonReport {
  const startTime = Date.now();
  const {
    runs = 30,
    budget = 500,
    windowsPerEvaluation = 50,
    windowSize = 50,
    weights = DEFAULT_WEIGHTS,
  } = config;

  const defaultScores: number[] = [];
  const randomScores: number[] = [];
  const gridScores: number[] = [];
  const mcScores: number[] = [];

  // Evaluate default params once (deterministic — same score every run)
  const evalRng = mulberry32(1);
  const effectiveWindowSize = data.length <= windowSize ? data.length : windowSize;
  const maxStart = data.length > effectiveWindowSize ? data.length - effectiveWindowSize : 0;

  let defaultScore = 0;
  if (data.length > 0) {
    let totalDefault = 0;
    let windowCount = 0;
    if (data.length <= effectiveWindowSize) {
      const result = simulate(data.slice(), defaultParams, evalRng);
      totalDefault = result.hits * weights.hit + result.misses * weights.miss + result.falseAlarms * weights.falseAlarm;
      windowCount = 1;
    } else {
      const rngForDefault = mulberry32(1);
      for (let w = 0; w < windowsPerEvaluation; w++) {
        const start = Math.floor(rngForDefault() * (maxStart + 1));
        const win = data.slice(start, start + effectiveWindowSize);
        const result = simulate(win, defaultParams, rngForDefault);
        totalDefault += result.hits * weights.hit + result.misses * weights.miss + result.falseAlarms * weights.falseAlarm;
        windowCount++;
      }
    }
    defaultScore = windowCount > 0 ? totalDefault / windowCount : 0;
  }

  // Grid search is deterministic — run once, replicate for all runs
  const gridResult = gridSearch(data, space, simulate, {
    windowsPerIteration: windowsPerEvaluation,
    windowSize,
    weights,
    seed: 1,
  });
  const gridBestScore = gridResult.topCandidates.length > 0
    ? gridResult.topCandidates[0].score
    : 0;

  for (let run = 1; run <= runs; run++) {
    // Default: same score every run (deterministic)
    defaultScores.push(defaultScore);

    // Grid: deterministic — same score every run
    gridScores.push(gridBestScore);

    // Random Search: seeded with run index
    const rsResult = randomSearch(data, space, simulate, {
      budget,
      windowsPerEvaluation,
      windowSize,
      weights,
      seed: run,
    });
    randomScores.push(rsResult.bestScore);

    // Monte Carlo: seeded with run index
    const mcResult = monteCarloSearch(data, space, simulate, {
      iterations: budget,
      windowsPerIteration: windowsPerEvaluation,
      windowSize,
      weights,
      seed: run,
    });
    const mcBestScore = mcResult.topCandidates.length > 0
      ? mcResult.topCandidates[0].score
      : 0;
    mcScores.push(mcBestScore);
  }

  const durationMs = Date.now() - startTime;

  return {
    budget,
    runs,
    methods: {
      default: summarize(defaultScores),
      randomSearch: summarize(randomScores),
      gridSearch: summarize(gridScores),
      monteCarlo: summarize(mcScores),
    },
    comparisons: {
      "MC vs Random": buildComparison(mcScores, randomScores),
      "MC vs Grid": buildComparison(mcScores, gridScores),
      "Grid vs Random": buildComparison(gridScores, randomScores),
      "Tuned vs Default": buildComparison(mcScores, defaultScores),
    },
    generatedAt: Date.now(),
    durationMs,
  };
}
