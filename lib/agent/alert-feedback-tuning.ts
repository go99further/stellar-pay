/**
 * Alert Feedback Tuning — 数据驱动的建议参数管理
 *
 * 把 suggestThreshold 里原来硬编码的 0.6/0.4/0.75/0.5/0.05/0.03 变成可从
 * localStorage 读取、可通过 walkForwardOptimize 自动调优的参数对象。
 *
 * 循环依赖规避：本文件不导入 alert-feedback.ts。
 * 模拟器逻辑是内联的简化版本，与 alert-feedback.ts 的 suggestThreshold 语义对齐。
 */

import {
  monteCarloSearch,
  walkForwardOptimize,
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
  confidenceInterval: { p25: SuggestionParams; p75: SuggestionParams } | null;
  trainScore: number;
  validationScore: number;
  testScore: number;
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

// ── Simulator (self-contained, no import from alert-feedback.ts) ──────────────

/**
 * Inline simulator for the suggestion logic.
 *
 * Given a price window and a set of SuggestionParams, splits the window in
 * half, uses the median of the first half as the trigger price, then scores
 * how well that trigger discriminates rises from falls in the second half.
 *
 * Scoring:
 *   hits        — fired and next price stayed at/above trigger
 *   misses      — fired but next price fell below trigger
 *   falseAlarms — didn't fire but was within loosenDelta of trigger AND next
 *                 price fell (proxy for "would have been a useful signal")
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const simulateSuggestion: SimulateFn<SuggestionParams> = (window, params, _rng) => {
  if (window.length < 4) {
    return { hits: 0, misses: 0, falseAlarms: 0 };
  }

  const midpoint = Math.floor(window.length / 2);
  const trainSlice = window.slice(0, midpoint);
  const testSlice = window.slice(midpoint);

  // Median of train slice as trigger price
  const sorted = trainSlice.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const triggerPrice =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  let hits = 0;
  let misses = 0;
  let falseAlarms = 0;

  for (let i = 0; i < testSlice.length; i++) {
    const price = testSlice[i];
    const nextPrice = i + 1 < testSlice.length ? testSlice[i + 1] : testSlice[i];
    const fired = price >= triggerPrice;

    if (fired) {
      if (nextPrice >= triggerPrice) {
        hits++;
      } else {
        misses++;
      }
    } else {
      // Near-miss: within loosenDelta of trigger and next price fell
      if (
        price >= triggerPrice * (1 - params.loosenDelta) &&
        nextPrice < triggerPrice
      ) {
        falseAlarms++;
      }
    }
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
      confidenceInterval: null,
      trainScore: 0,
      validationScore: 0,
      testScore: 0,
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
    simulateSuggestion,
    monteCarloSearch,
    { iterations: 500, seed: 42, windowSize: Math.min(50, Math.floor(prices.length / 2)) }
  );

  // Re-run Monte Carlo on full data to get confidence interval
  const fullDist = monteCarloSearch(
    prices,
    SUGGESTION_PARAM_SPACE,
    simulateSuggestion,
    { iterations: 500, seed: 42, windowSize: Math.min(50, Math.floor(prices.length / 2)) }
  );

  const rawParams = report.recommended as SuggestionParams;
  const clamped = clampToSpace(rawParams);

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
      confidenceInterval: {
        p25: clampToSpace(fullDist.confidenceInterval.p25 as SuggestionParams),
        p75: clampToSpace(fullDist.confidenceInterval.p75 as SuggestionParams),
      },
      trainScore: report.trainScore,
      validationScore: report.validationScore,
      testScore: report.testScore,
      message: report.overfitFlag
        ? `调优结果疑似过拟合（train=${report.trainScore.toFixed(2)}, test=${report.testScore.toFixed(2)}），未持久化。建议扩大数据窗口后重试。`
        : "调优结果参数范围无效，未持久化。使用默认参数。",
      sampleCount: fullDist.sampleCount,
    };
  }

  // Persist the valid result
  setSuggestionParams(clamped);

  return {
    success: true,
    params: clamped,
    confidenceInterval: {
      p25: clampToSpace(fullDist.confidenceInterval.p25 as SuggestionParams),
      p75: clampToSpace(fullDist.confidenceInterval.p75 as SuggestionParams),
    },
    trainScore: report.trainScore,
    validationScore: report.validationScore,
    testScore: report.testScore,
    message: report.message,
    sampleCount: fullDist.sampleCount,
  };
}
