/**
 * Alert Feedback Tuning — 数据驱动的建议参数管理
 *
 * 把 suggestThreshold 里原来硬编码的 0.6/0.4/0.75/0.5/0.05/0.03 变成可从
 * localStorage 读取、可通过 walkForwardOptimize 自动调优的参数对象。
 *
 * 循环依赖规避：本文件不导入 alert-feedback.ts。
 * 模拟器内联了 suggestThreshold 的完整决策树（combined accuracy → keep/tighten/loosen），
 * 不是 surrogate——优化器找到的参数和真实闭环使用的是同一套逻辑。
 */

import {
  monteCarloSearch,
  walkForwardOptimize,
  mulberry32,
  type ParamSpace,
  type SimulateFn,
} from "./parameter-optimizer";
import { extractPriceHistoryV2 } from "./alert-backtest-v2";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SuggestionParams {
  /** 0.0–1.0 — weight given to online hit-rate vs offline backtest. Default 0.6 */
  onlineWeight: number;
  /** accuracy ≥ this → "keep". Default 0.75 */
  keepThreshold: number;
  /** accuracy < this → "tighten". Default 0.5 */
  tightenThreshold: number;
  /** fraction of ref price to move threshold on tighten. Default 0.05 */
  tightenDelta: number;
  /** fraction of last price to move threshold on loosen. Default 0.03 */
  loosenDelta: number;
}

export interface TuningReport {
  success: boolean;
  params: SuggestionParams;
  /**
   * IQR (interquartile range) of the top-5% candidate parameters from Monte
   * Carlo search. NOT a statistical confidence interval — those would require
   * bootstrap-with-replacement. p25 and p75 here measure how stable the search
   * was, not the uncertainty of a point estimate.
   */
  iqr: { p25: SuggestionParams; p75: SuggestionParams } | null;
  trainScore: number;
  validationScore: number;
  testScore: number;
  /**
   * Score of DEFAULT_PARAMS on the same data windows used for tuning. The
   * difference (testScore - baselineTestScore) is the meaningful number — if
   * it's negative or near zero, the tuned params aren't actually better.
   */
  baseline: {
    trainScore: number;
    validationScore: number;
    testScore: number;
  };
  message: string;
  sampleCount: number;
}

// ── Defaults (mirror the values previously hardcoded in alert-feedback.ts) ───

export const DEFAULT_PARAMS: SuggestionParams = {
  onlineWeight: 0.6,
  keepThreshold: 0.75,
  tightenThreshold: 0.5,
  tightenDelta: 0.05,
  loosenDelta: 0.03,
};

const STORAGE_KEY = "stellar-pay-suggestion-params";

// ── Validation ────────────────────────────────────────────────────────────────

function isValidShape(v: unknown): v is SuggestionParams {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  return (
    typeof x.onlineWeight === "number" &&
    typeof x.keepThreshold === "number" &&
    typeof x.tightenThreshold === "number" &&
    typeof x.tightenDelta === "number" &&
    typeof x.loosenDelta === "number"
  );
}

function validateRanges(p: SuggestionParams): void {
  if (p.onlineWeight < 0 || p.onlineWeight > 1) {
    throw new RangeError(
      `onlineWeight must be in [0, 1], got ${p.onlineWeight}`
    );
  }
  if (p.tightenDelta <= 0) {
    throw new RangeError(`tightenDelta must be > 0, got ${p.tightenDelta}`);
  }
  if (p.loosenDelta <= 0) {
    throw new RangeError(`loosenDelta must be > 0, got ${p.loosenDelta}`);
  }
  if (p.tightenThreshold >= p.keepThreshold) {
    throw new RangeError(
      `tightenThreshold (${p.tightenThreshold}) must be < keepThreshold (${p.keepThreshold})`
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns persisted SuggestionParams from localStorage, or DEFAULT_PARAMS if
 * nothing is stored or the stored value fails shape/range validation.
 */
export function getSuggestionParams(): SuggestionParams {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PARAMS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PARAMS };
    const parsed: unknown = JSON.parse(raw);
    if (!isValidShape(parsed)) return { ...DEFAULT_PARAMS };
    // Silently fall back on range violations rather than throwing on read.
    try {
      validateRanges(parsed);
    } catch {
      return { ...DEFAULT_PARAMS };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_PARAMS };
  }
}

/**
 * Persists SuggestionParams to localStorage.
 * Throws RangeError on invalid input so callers get explicit feedback.
 */
export function setSuggestionParams(p: SuggestionParams): void {
  validateRanges(p);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // quota exceeded / disabled — silently ignore
  }
}

/** Removes persisted params so getSuggestionParams falls back to defaults. */
export function clearSuggestionParams(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Simulator (真跑 suggestThreshold 决策逻辑，非 surrogate) ─────────────────
//
// 之前这里是一个 shadow simulator（用中位数模拟触发），和 suggestThreshold 的
// 真实逻辑不同。Issue 2 重构：现在 simulator 内联了 suggestThreshold 的完整
// 决策树（combined accuracy → keep/tighten/loosen），用价格窗口模拟触发和结算，
// 然后用参数化的阈值做决策，计算 hits/misses/falseAlarms。
//
// 这保证了优化器找到的参数和真实闭环使用的是同一套逻辑。

const simulateSuggestion: SimulateFn<SuggestionParams> = (window, params, _rng) => {
  if (window.length < 6) {
    return { hits: 0, misses: 0, falseAlarms: 0 };
  }

  // Split window: first 60% = "history" (for backtest), last 40% = "live" (for online)
  const splitIdx = Math.floor(window.length * 0.6);
  const historySlice = window.slice(0, splitIdx);
  const liveSlice = window.slice(splitIdx);

  // Simulate an "above" alert with target = median of history
  const sortedHistory = historySlice.slice().sort((a, b) => a - b);
  const mid = Math.floor(sortedHistory.length / 2);
  const targetPrice = sortedHistory.length % 2 === 0
    ? (sortedHistory[mid - 1] + sortedHistory[mid]) / 2
    : sortedHistory[mid];

  // Simulate offline backtest accuracy using history slice
  let offlineTriggered = 0;
  let offlineAccurate = 0;
  for (let i = 0; i < historySlice.length - 1; i++) {
    if (historySlice[i] >= targetPrice) {
      offlineTriggered++;
      if (historySlice[i + 1] >= targetPrice) offlineAccurate++;
    }
  }
  const offlineAccuracy = offlineTriggered > 0 ? offlineAccurate / offlineTriggered : 0;

  // Simulate online triggers + settlements using live slice
  let onlineHits = 0;
  let onlineMisses = 0;
  for (let i = 0; i < liveSlice.length - 1; i++) {
    if (liveSlice[i] >= targetPrice) {
      // Triggered — settle with next price
      if (liveSlice[i + 1] >= liveSlice[i]) {
        onlineHits++;
      } else {
        onlineMisses++;
      }
    }
  }
  const onlineSettled = onlineHits + onlineMisses;
  const onlineHitRate = onlineSettled > 0 ? onlineHits / onlineSettled : 0;

  // ── Real suggestThreshold decision tree (parameterized) ──
  const onlineWeight = onlineSettled >= 3 ? params.onlineWeight : params.onlineWeight * 0.33;
  const offlineWeight = 1 - onlineWeight;
  const combinedAccuracy = onlineHitRate * onlineWeight + offlineAccuracy * offlineWeight;

  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;

  // Decision: what would suggestThreshold recommend?
  if (onlineSettled === 0 && offlineTriggered === 0) {
    // "loosen" path — no data, suggest moving threshold closer
    // Score: if the last live price is near target, loosen would help → hit
    // If far away, loosen is premature → falseAlarm
    const lastLive = liveSlice[liveSlice.length - 1];
    const distance = Math.abs(lastLive - targetPrice) / targetPrice;
    if (distance < params.loosenDelta * 3) {
      hits++; // loosen would bring threshold into useful range
    } else {
      falseAlarms++; // loosen wouldn't help, target is too far
    }
  } else if (combinedAccuracy >= params.keepThreshold) {
    // "keep" path — good accuracy, correct decision
    hits += onlineHits;
    misses += onlineMisses;
  } else if (combinedAccuracy < params.tightenThreshold && (onlineSettled >= 3 || offlineTriggered >= 3)) {
    // "tighten" path — would tightening have helped?
    // Simulate: if we raised threshold by tightenDelta, how many misses become non-triggers?
    const tightenedTarget = targetPrice * (1 + params.tightenDelta);
    let tightenedHits = 0;
    let tightenedMisses = 0;
    for (let i = 0; i < liveSlice.length - 1; i++) {
      if (liveSlice[i] >= tightenedTarget) {
        if (liveSlice[i + 1] >= liveSlice[i]) {
          tightenedHits++;
        } else {
          tightenedMisses++;
        }
      }
    }
    // Tighten is a "hit" if it reduced misses without killing all hits
    if (tightenedMisses < onlineMisses && tightenedHits > 0) {
      hits += tightenedHits;
      misses += tightenedMisses;
    } else {
      // Tighten didn't help — count as false alarm (bad suggestion)
      falseAlarms += onlineMisses;
      hits += onlineHits;
    }
  } else {
    // Middle band — "keep" with borderline warning
    hits += onlineHits;
    misses += onlineMisses;
  }

  return { hits, misses, falseAlarms };
};

// ── Param space bounds ────────────────────────────────────────────────────────

const SUGGESTION_PARAM_SPACE: ParamSpace<SuggestionParams> = {
  onlineWeight: { min: 0.0, max: 1.0 },
  keepThreshold: { min: 0.5, max: 0.95 },
  tightenThreshold: { min: 0.2, max: 0.6 },
  tightenDelta: { min: 0.01, max: 0.15 },
  loosenDelta: { min: 0.01, max: 0.10 },
};

// ── Clamp helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampToSpace(p: SuggestionParams): SuggestionParams {
  const clamped: SuggestionParams = {
    onlineWeight: clamp(p.onlineWeight, 0.0, 1.0),
    keepThreshold: clamp(p.keepThreshold, 0.5, 0.95),
    tightenThreshold: clamp(p.tightenThreshold, 0.2, 0.6),
    tightenDelta: clamp(p.tightenDelta, 0.01, 0.15),
    loosenDelta: clamp(p.loosenDelta, 0.01, 0.10),
  };
  // Enforce tightenThreshold < keepThreshold after clamping
  if (clamped.tightenThreshold >= clamped.keepThreshold) {
    clamped.tightenThreshold = Math.max(
      SUGGESTION_PARAM_SPACE.tightenThreshold.min,
      clamped.keepThreshold - 0.05
    );
  }
  return clamped;
}

// ── tuneSuggestionParams ──────────────────────────────────────────────────────

/**
 * Runs walk-forward optimization over real price history to find
 * SuggestionParams that maximise hits − 0.5·misses − 0.3·falseAlarms.
 *
 * Uses monteCarloSearch as the inner searcher with seed=42 for reproducibility.
 * If the result passes validity checks it is persisted via setSuggestionParams.
 */
export function tuneSuggestionParams(): TuningReport {
  const pricePoints = extractPriceHistoryV2();
  const prices = pricePoints.map((p) => p.price);

  if (prices.length < 10) {
    return {
      success: false,
      params: { ...DEFAULT_PARAMS },
      iqr: null,
      trainScore: 0,
      validationScore: 0,
      testScore: 0,
      baseline: { trainScore: 0, validationScore: 0, testScore: 0 },
      message:
        prices.length === 0
          ? "价格历史为空，无法调优参数。请先积累交易记录后重试。"
          : `价格历史仅 ${prices.length} 个点（至少需要 10 个），无法完成 walk-forward 切分。`,
      sampleCount: 0,
    };
  }

  const report = walkForwardOptimize(
    prices,
    SUGGESTION_PARAM_SPACE,
    simulateSuggestion as unknown as SimulateFn<Record<string, number>>,
    monteCarloSearch,
    { iterations: 500, seed: 42, windowSize: Math.min(50, Math.floor(prices.length / 2)) }
  );

  // Re-run Monte Carlo on full data to get IQR of top-5% candidates
  const fullDist = monteCarloSearch(
    prices,
    SUGGESTION_PARAM_SPACE,
    simulateSuggestion as unknown as SimulateFn<Record<string, number>>,
    { iterations: 500, seed: 42, windowSize: Math.min(50, Math.floor(prices.length / 2)) }
  );

  const rawParams = report.recommended as unknown as SuggestionParams;
  const clamped = clampToSpace(rawParams);

  // ── Baseline: score DEFAULT_PARAMS on the same 60/20/20 windows ──────────
  const trainEnd = Math.floor(prices.length * 0.6);
  const valEnd = Math.floor(prices.length * 0.8);
  const weights = { hit: 1, miss: -0.5, falseAlarm: -0.3 };
  const evalRng = mulberry32(42);
  const baselineFn = (slice: number[]) => {
    if (slice.length === 0) return 0;
    const detail = simulateSuggestion(slice, DEFAULT_PARAMS, evalRng);
    return detail.hits * weights.hit + detail.misses * weights.miss + detail.falseAlarms * weights.falseAlarm;
  };
  const baselineTrain = baselineFn(prices.slice(0, trainEnd));
  const baselineVal = baselineFn(prices.slice(trainEnd, valEnd));
  const baselineTest = baselineFn(prices.slice(valEnd));

  // Validate the clamped result is usable
  let isValid = true;
  try {
    validateRanges(clamped);
  } catch {
    isValid = false;
  }

  if (!isValid || report.overfitFlag) {
    return {
      success: false,
      params: clamped,
      iqr: {
        p25: clampToSpace(fullDist.confidenceInterval.p25 as unknown as SuggestionParams),
        p75: clampToSpace(fullDist.confidenceInterval.p75 as unknown as SuggestionParams),
      },
      trainScore: report.trainScore,
      validationScore: report.validationScore,
      testScore: report.testScore,
      baseline: { trainScore: baselineTrain, validationScore: baselineVal, testScore: baselineTest },
      message: report.overfitFlag
        ? `调优结果疑似过拟合（train=${report.trainScore.toFixed(2)}, test=${report.testScore.toFixed(2)}），未持久化。建议扩大数据窗口后重试。`
        : "调优结果参数范围无效，未持久化。使用默认参数。",
      sampleCount: fullDist.sampleCount,
    };
  }

  // Persist the valid result
  setSuggestionParams(clamped);

  const delta = report.testScore - baselineTest;
  const messageWithBaseline = `${report.message}\nBaseline (default params) test score: ${baselineTest.toFixed(2)}. Tuned delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}.`;

  return {
    success: true,
    params: clamped,
    iqr: {
      p25: clampToSpace(fullDist.confidenceInterval.p25 as unknown as SuggestionParams),
      p75: clampToSpace(fullDist.confidenceInterval.p75 as unknown as SuggestionParams),
    },
    trainScore: report.trainScore,
    validationScore: report.validationScore,
    testScore: report.testScore,
    baseline: { trainScore: baselineTrain, validationScore: baselineVal, testScore: baselineTest },
    message: messageWithBaseline,
    sampleCount: fullDist.sampleCount,
  };
}
