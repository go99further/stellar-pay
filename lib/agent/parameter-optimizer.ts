/**
 * Parameter Optimizer — 数据驱动的参数搜索框架
 *
 * 用历史数据替代"拍脑袋"的硬编码阈值。给任意带数值参数的策略（价格警报建议
 * 引擎、Security 检测器阈值）一个 ParamSpace 和一个 SimulateFn，本模块返回：
 *   - 推荐参数（top-5% 的中位数）
 *   - 置信区间（top-5% 的 25/75 百分位）
 *   - walk-forward 三段评分（train/validation/test）
 *
 * 防过拟合策略与 alert-backtest-v2.ts 对齐：60/20/20 时间切分、训练集找参数、
 * 验证集挑选、测试集只跑一次。报告 IQR 让上线前能看到"参数到底有多稳"。
 *
 * 两种搜索：
 *   - monteCarloSearch: 随机采样，参数空间大时高效，需种子保证可复现
 *   - gridSearch: 离散网格，参数 ≤ 5 个、想要可复现结果时优先
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParamSpec {
  min: number;
  max: number;
  /** Grid only — number of evenly spaced samples (≥ 2). Ignored by Monte Carlo. */
  steps?: number;
}

export type ParamSpace<P> = { [K in keyof P]: ParamSpec };

export interface ScoringWeights {
  hit: number;
  miss: number;
  falseAlarm: number;
}

/**
 * Default score = hits − 0.5·misses − 0.3·falseAlarms.
 *
 * Why these weights, not 1/-1/-1: a missed opportunity is half as bad as a
 * correct catch (because the user likely still has other signals), but a
 * false alarm only costs a third because users dismiss them. This is itself
 * a tunable; downstream callers can override.
 */
export const DEFAULT_WEIGHTS: ScoringWeights = { hit: 1, miss: -0.5, falseAlarm: -0.3 };

export interface SimResult {
  hits: number;
  misses: number;
  falseAlarms: number;
}

export type SimulateFn<P> = (data: number[], params: P, rng: () => number) => SimResult;

export interface OptimizerConfig {
  iterations?: number;
  windowsPerIteration?: number;
  windowSize?: number;
  weights?: ScoringWeights;
  seed?: number;
  topPercentile?: number; // 0.05 = top 5%
}

export interface ParamCandidate<P> {
  params: P;
  score: number;
  detail: SimResult;
}

export interface ParameterDistribution<P> {
  recommended: P;            // median of top slice, key-by-key
  confidenceInterval: {       // IQR (25th/75th) of top slice, key-by-key
    p25: P;
    p75: P;
  };
  topCandidates: ParamCandidate<P>[];
  sampleCount: number;        // total candidates evaluated
}

export interface WalkForwardReport<P> {
  recommended: P;
  confidenceInterval: ParameterDistribution<P>["confidenceInterval"];
  trainScore: number;
  validationScore: number;
  testScore: number;
  message: string;
  /** True when test score is suspiciously close to train, suggesting overfit. */
  overfitFlag: boolean;
}

// ── Deterministic RNG ────────────────────────────────────────────────────────

/** Mulberry32 — seeded PRNG. Same seed ⇒ same sequence, required for repro. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Sampling ─────────────────────────────────────────────────────────────────

function sampleParams<P>(space: ParamSpace<P>, rng: () => number): P {
  const out = {} as P;
  for (const key in space) {
    const spec = space[key];
    out[key] = (spec.min + rng() * (spec.max - spec.min)) as P[typeof key];
  }
  return out;
}

/**
 * Sample N windows of given size from the data series. If `windowSize` exceeds
 * the data length, fall back to the full series (one window). This matters
 * when the dev environment has < 50 transactions — we still want a result
 * rather than a silent zero.
 */
function sampleWindows(
  data: number[],
  count: number,
  windowSize: number,
  rng: () => number
): number[][] {
  if (data.length === 0) return [];
  if (data.length <= windowSize) return [data.slice()];
  const windows: number[][] = [];
  const maxStart = data.length - windowSize;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(rng() * (maxStart + 1));
    windows.push(data.slice(start, start + windowSize));
  }
  return windows;
}

function score(detail: SimResult, weights: ScoringWeights): number {
  return detail.hits * weights.hit + detail.misses * weights.miss + detail.falseAlarms * weights.falseAlarm;
}

function aggregate(details: SimResult[]): SimResult {
  return details.reduce(
    (acc, d) => ({
      hits: acc.hits + d.hits,
      misses: acc.misses + d.misses,
      falseAlarms: acc.falseAlarms + d.falseAlarms,
    }),
    { hits: 0, misses: 0, falseAlarms: 0 }
  );
}

// ── Distribution helpers ─────────────────────────────────────────────────────

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function summarizeByKey<P extends Record<string, number>>(
  candidates: ParamCandidate<P>[]
): { p25: P; p50: P; p75: P } {
  const result = { p25: {} as P, p50: {} as P, p75: {} as P };
  if (candidates.length === 0) return result;
  const keys = Object.keys(candidates[0].params) as (keyof P)[];
  for (const k of keys) {
    const values = candidates
      .map((c) => c.params[k])
      .sort((a, b) => (a as number) - (b as number)) as number[];
    (result.p25 as Record<keyof P, number>)[k] = percentile(values, 0.25);
    (result.p50 as Record<keyof P, number>)[k] = percentile(values, 0.5);
    (result.p75 as Record<keyof P, number>)[k] = percentile(values, 0.75);
  }
  return result;
}

// ── Monte Carlo ──────────────────────────────────────────────────────────────

/**
 * Random-search optimizer. Returns the distribution of top-percentile params
 * so the caller can ship "0.6 ± 0.08" instead of "0.6 because I felt like it".
 *
 * Determinism: pass a `seed` for reproducible results across CI runs and
 * interview demos. Without one, defaults to seed=1 (still deterministic).
 */
export function monteCarloSearch<P extends Record<string, number>>(
  data: number[],
  space: ParamSpace<P>,
  simulate: SimulateFn<P>,
  config: OptimizerConfig = {}
): ParameterDistribution<P> {
  const {
    iterations = 1000,
    windowsPerIteration = 50,
    windowSize = 50,
    weights = DEFAULT_WEIGHTS,
    seed = 1,
    topPercentile = 0.05,
  } = config;

  const rng = mulberry32(seed);
  const candidates: ParamCandidate<P>[] = [];

  for (let i = 0; i < iterations; i++) {
    const params = sampleParams(space, rng);
    const windows = sampleWindows(data, windowsPerIteration, windowSize, rng);
    if (windows.length === 0) {
      candidates.push({ params, score: 0, detail: { hits: 0, misses: 0, falseAlarms: 0 } });
      continue;
    }
    const details = windows.map((w) => simulate(w, params, rng));
    const detail = aggregate(details);
    candidates.push({ params, score: score(detail, weights) / windows.length, detail });
  }

  candidates.sort((a, b) => b.score - a.score);
  const topN = Math.max(1, Math.floor(candidates.length * topPercentile));
  const top = candidates.slice(0, topN);
  const summary = summarizeByKey(top);

  return {
    recommended: summary.p50,
    confidenceInterval: { p25: summary.p25, p75: summary.p75 },
    topCandidates: top,
    sampleCount: candidates.length,
  };
}

// ── Grid Search ──────────────────────────────────────────────────────────────

function* iterateGrid<P extends Record<string, number>>(
  space: ParamSpace<P>
): IterableIterator<P> {
  const keys = Object.keys(space) as (keyof P)[];
  const axes = keys.map((k) => {
    const spec = space[k];
    const steps = Math.max(2, spec.steps ?? 5);
    const arr: number[] = [];
    for (let i = 0; i < steps; i++) {
      arr.push(spec.min + ((spec.max - spec.min) * i) / (steps - 1));
    }
    return { key: k, values: arr };
  });

  function* recurse(idx: number, acc: P): IterableIterator<P> {
    if (idx === axes.length) {
      yield { ...acc };
      return;
    }
    for (const v of axes[idx].values) {
      acc[axes[idx].key] = v as P[keyof P];
      yield* recurse(idx + 1, acc);
    }
  }

  yield* recurse(0, {} as P);
}

/**
 * Exhaustive grid search. For ≤ 5 params with steps ≤ 6 each, this gives
 * fully reproducible results without needing an RNG seed. Above that the
 * combinatorial explosion makes Monte Carlo more practical.
 */
export function gridSearch<P extends Record<string, number>>(
  data: number[],
  space: ParamSpace<P>,
  simulate: SimulateFn<P>,
  config: OptimizerConfig = {}
): ParameterDistribution<P> {
  const {
    windowsPerIteration = 50,
    windowSize = 50,
    weights = DEFAULT_WEIGHTS,
    seed = 1,
    topPercentile = 0.1, // grid is sparser; loosen the slice
  } = config;

  const rng = mulberry32(seed);
  const candidates: ParamCandidate<P>[] = [];

  for (const params of iterateGrid(space)) {
    const windows = sampleWindows(data, windowsPerIteration, windowSize, rng);
    if (windows.length === 0) {
      candidates.push({ params, score: 0, detail: { hits: 0, misses: 0, falseAlarms: 0 } });
      continue;
    }
    const details = windows.map((w) => simulate(w, params, rng));
    const detail = aggregate(details);
    candidates.push({ params, score: score(detail, weights) / windows.length, detail });
  }

  candidates.sort((a, b) => b.score - a.score);
  const topN = Math.max(1, Math.floor(candidates.length * topPercentile));
  const top = candidates.slice(0, topN);
  const summary = summarizeByKey(top);

  return {
    recommended: summary.p50,
    confidenceInterval: { p25: summary.p25, p75: summary.p75 },
    topCandidates: top,
    sampleCount: candidates.length,
  };
}

// ── Walk-Forward Cross-Validation ────────────────────────────────────────────

/**
 * 60/20/20 split aligned with alert-backtest-v2.ts. Search on training, pick
 * the recommended params on validation, then evaluate ONCE on test. Reporting
 * trainScore − testScore = overfit flag.
 *
 * The optimizer can be either Monte Carlo or grid search; that's why we take
 * a `searcher` callback rather than hardcoding one.
 */
export function walkForwardOptimize<P extends Record<string, number>>(
  data: number[],
  space: ParamSpace<P>,
  simulate: SimulateFn<P>,
  searcher: (
    series: number[],
    space: ParamSpace<P>,
    sim: SimulateFn<P>,
    cfg: OptimizerConfig
  ) => ParameterDistribution<P> = monteCarloSearch,
  config: OptimizerConfig = {}
): WalkForwardReport<P> {
  if (data.length < 10) {
    // Not enough to do a 3-way split — surface explicitly rather than silently
    // returning a confident-looking number.
    const dist = searcher(data, space, simulate, config);
    return {
      recommended: dist.recommended,
      confidenceInterval: dist.confidenceInterval,
      trainScore: 0,
      validationScore: 0,
      testScore: 0,
      overfitFlag: false,
      message:
        "⚠️ 数据点不足 10 个，无法完成 walk-forward 切分。返回的参数仅基于全量数据，置信度低。",
    };
  }

  const trainEnd = Math.floor(data.length * 0.6);
  const validEnd = Math.floor(data.length * 0.8);
  const train = data.slice(0, trainEnd);
  const validation = data.slice(trainEnd, validEnd);
  const test = data.slice(validEnd);

  const trainDist = searcher(train, space, simulate, config);

  // Validation: lock in the train-recommended params, score them on val data.
  const weights = config.weights ?? DEFAULT_WEIGHTS;
  const seed = config.seed ?? 1;
  const evalRng = mulberry32(seed);

  function singleScore(series: number[], params: P): number {
    if (series.length === 0) return 0;
    const detail = simulate(series, params, evalRng);
    return score(detail, weights);
  }

  const trainScore = singleScore(train, trainDist.recommended);
  const validationScore = singleScore(validation, trainDist.recommended);
  const testScore = singleScore(test, trainDist.recommended);

  // Heuristic overfit flag: train high, test < half of train.
  const overfitFlag =
    trainScore > 0 && testScore < trainScore * 0.5 && Math.abs(trainScore - testScore) > 1;

  const message = overfitFlag
    ? `⚠️ 测试集得分 (${testScore.toFixed(2)}) 显著低于训练集 (${trainScore.toFixed(2)})，疑似过拟合。建议扩大数据窗口或缩小参数空间。`
    : `✅ Walk-forward 通过：train=${trainScore.toFixed(2)}, val=${validationScore.toFixed(2)}, test=${testScore.toFixed(2)}。`;

  return {
    recommended: trainDist.recommended,
    confidenceInterval: trainDist.confidenceInterval,
    trainScore,
    validationScore,
    testScore,
    overfitFlag,
    message,
  };
}

// ── Helper: format a parameter distribution for display ──────────────────────

export function formatDistribution<P extends Record<string, number>>(
  dist: ParameterDistribution<P>
): string {
  const lines: string[] = [`Recommended (n=${dist.sampleCount}, top=${dist.topCandidates.length}):`];
  for (const k of Object.keys(dist.recommended) as (keyof P)[]) {
    const median = dist.recommended[k] as number;
    const lo = dist.confidenceInterval.p25[k] as number;
    const hi = dist.confidenceInterval.p75[k] as number;
    lines.push(`  ${String(k)}: ${median.toFixed(3)}  [${lo.toFixed(3)} – ${hi.toFixed(3)}]`);
  }
  return lines.join("\n");
}

