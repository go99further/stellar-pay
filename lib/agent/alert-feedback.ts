/**
 * Alert Feedback Loop — 警报数据闭环
 *
 * 与 docs/BACKTEST_GUIDE.md 中描述的闭环对应：
 *   触发 → 跟踪后续价格 → 统计准确率 → 建议阈值 →（用户采纳）→ 新警报
 *
 * 关键不变量（与 alert-backtest-v2.ts 一致）：
 * 1. 结算只用"触发后下一笔观察到的价格"，不用未来 N 笔平均，避免前瞻偏差。
 * 2. 触发记录在结算前保持 pending 状态，结算一次后不再变更。
 * 3. 阈值建议由 V2 回测 + 在线命中率联合给出，不自动修改警报；用户在 UI 显式确认。
 */

import type { PriceAlert } from "./price-alerts";
import { backtestAlertsV2, type BacktestResultV2 } from "./alert-backtest-v2";
import { getSuggestionParams } from "./alert-feedback-tuning";

const STORAGE_KEY = "stellar-pay-alert-feedback";
const MAX_RECORDS = 200;

export type FeedbackOutcome = "pending" | "hit" | "miss";

export interface FeedbackRecord {
  id: string;
  alertId: string;
  tokenPair: PriceAlert["tokenPair"];
  condition: PriceAlert["condition"];
  targetPrice: number;
  triggerPrice: number;
  triggeredAt: number;
  outcome: FeedbackOutcome;
  settledAt?: number;
  settledPrice?: number;
  /** Which settlement rule was used. Undefined for legacy next-tick records. */
  settlementRule?: "next_tick" | "k_tick_avg";
  /** K used at settlement (only present when settlementRule === "k_tick_avg"). */
  observationCount?: number;
  /** Cumulative average of K observations that decided the outcome. */
  observedAvgPrice?: number;
}

export interface OnlineAlertStats {
  alertId: string;
  total: number;
  settled: number;
  hits: number;
  misses: number;
  pending: number;
  hitRate: number | null; // null when no settled samples
  confidence: "high" | "medium" | "low";
}

export interface ThresholdSuggestion {
  alertId: string;
  action: "keep" | "tighten" | "loosen" | "insufficient_data";
  currentTarget: number;
  suggestedTarget: number | null;
  reason: string;
  backtest: BacktestResultV2 | null;
  online: OnlineAlertStats;
}

// ── Storage ──────────────────────────────────────────────────────────────────

function readAll(): FeedbackRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

function writeAll(records: FeedbackRecord[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const trimmed = records.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota exceeded / disabled — silently ignore (matches transaction-history)
  }
}

function isValidRecord(r: unknown): r is FeedbackRecord {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.alertId === "string" &&
    (x.tokenPair === "TKNA/TKNB" || x.tokenPair === "TKNB/TKNA") &&
    (x.condition === "above" || x.condition === "below") &&
    typeof x.targetPrice === "number" &&
    typeof x.triggerPrice === "number" &&
    typeof x.triggeredAt === "number" &&
    (x.outcome === "pending" || x.outcome === "hit" || x.outcome === "miss")
  );
}

function generateId(): string {
  return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Step 1 of the loop — record an alert trigger with the price that caused it.
 * The record stays `pending` until `recordOutcome` settles it on the next price tick.
 */
export function recordTrigger(
  alert: Pick<PriceAlert, "id" | "tokenPair" | "condition" | "targetPrice">,
  triggerPrice: number,
  now: number = Date.now()
): FeedbackRecord {
  const record: FeedbackRecord = {
    id: generateId(),
    alertId: alert.id,
    tokenPair: alert.tokenPair,
    condition: alert.condition,
    targetPrice: alert.targetPrice,
    triggerPrice,
    triggeredAt: now,
    outcome: "pending",
  };
  const all = readAll();
  all.push(record);
  writeAll(all);
  return record;
}

/**
 * Step 2 — settle every pending record using the next observed price.
 *
 * Settlement rule (no future leak): for "above" alerts the prediction is that
 * price stays at or above the trigger; for "below" alerts the prediction is
 * the symmetric one. We only ever consult the *first* price observed after
 * the trigger — repeated calls with the same observation re-affirm the same
 * outcome rather than peeking further forward.
 *
 * The observation must be strictly newer than the trigger time, otherwise it
 * would let us read a price recorded simultaneously with the trigger and bias
 * the result.
 */
export function recordOutcome(
  observedPrice: number,
  observedAt: number = Date.now()
): FeedbackRecord[] {
  const all = readAll();
  let changed = false;
  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    if (observedAt <= rec.triggeredAt) return rec;
    const hit =
      rec.condition === "above"
        ? observedPrice >= rec.triggerPrice
        : observedPrice <= rec.triggerPrice;
    changed = true;
    return {
      ...rec,
      outcome: hit ? ("hit" as const) : ("miss" as const),
      settledAt: observedAt,
      settledPrice: observedPrice,
    };
  });
  if (changed) writeAll(updated);
  return updated.filter((r) => r.settledAt === observedAt);
}

// ── K-tick averaged settlement ────────────────────────────────────────────────

/**
 * In-memory buffer for K-tick settlement.
 * Key: record id → array of { price, observedAt } observations collected so far.
 * Dropped once the record settles. Not persisted — acceptable loss on reload.
 */
const _kTickBuffer = new Map<string, Array<{ price: number; observedAt: number }>>();

/** Test/debug helper — clears the in-flight K-tick observation buffer. */
export function clearOutcomeBuffer(): void {
  _kTickBuffer.clear();
}

/**
 * Settle pending records using the cumulative average of K observed prices
 * after the trigger.
 *
 * Why this exists: settling on the next-1-tick price suffers from a subtle
 * selection bias. Conditional on "alert just fired", the trigger price has
 * just moved up to cross the threshold; mean reversion makes a single-tick
 * dip-back more likely than continued movement, so the next-tick estimator
 * systematically under-reports true hit rate. Averaging K subsequent ticks
 * is a much less biased estimator of "did the move sustain".
 *
 * Trade-off: K-tick rule needs K observations before it can settle. We model
 * this by buffering observations per record until enough have accumulated.
 *
 * Caller pattern:
 *   - Call once per polled tick with the latest observed price.
 *   - Internal buffer accumulates per-record observations.
 *   - Once a record has K observations, it settles in one shot using the mean.
 */
export function recordOutcomeKTick(
  observedPrice: number,
  observedAt: number = Date.now(),
  k: number = 5
): FeedbackRecord[] {
  const all = readAll();
  const settled: FeedbackRecord[] = [];
  let changed = false;

  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    // No future-leak: observation must be strictly after the trigger.
    if (observedAt <= rec.triggeredAt) return rec;

    // Accumulate into buffer.
    let buf = _kTickBuffer.get(rec.id);
    if (!buf) {
      buf = [];
      _kTickBuffer.set(rec.id, buf);
    }
    buf.push({ price: observedPrice, observedAt });

    if (buf.length < k) return rec; // not enough observations yet

    // We have K observations — compute mean and settle.
    const mean = buf.reduce((sum, o) => sum + o.price, 0) / buf.length;
    const hit =
      rec.condition === "above" ? mean >= rec.triggerPrice : mean <= rec.triggerPrice;

    _kTickBuffer.delete(rec.id);
    changed = true;

    const settledRec: FeedbackRecord = {
      ...rec,
      outcome: hit ? "hit" : "miss",
      settledAt: observedAt,
      settledPrice: mean,
      settlementRule: "k_tick_avg",
      observationCount: k,
      observedAvgPrice: mean,
    };
    settled.push(settledRec);
    return settledRec;
  });

  if (changed) writeAll(updated);
  return settled;
}

export function getFeedbackRecords(alertId?: string): FeedbackRecord[] {
  const all = readAll();
  return alertId ? all.filter((r) => r.alertId === alertId) : all;
}

export function clearFeedback(alertId?: string): void {
  if (!alertId) {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    return;
  }
  writeAll(readAll().filter((r) => r.alertId !== alertId));
}

/**
 * Step 3 — per-alert online statistics.
 *
 * Confidence mirrors the backtest's logic: at least 5 settled samples → high,
 * 3-4 → medium, otherwise low. We do not surface a hit rate when there are
 * zero settled samples because a "0/0 = 100%" or "0/0 = 0%" reading would
 * mislead the user when they decide whether to act on the suggestion.
 */
export function getOnlineStats(alertId: string): OnlineAlertStats {
  const records = getFeedbackRecords(alertId);
  const settledRecords = records.filter((r) => r.outcome !== "pending");
  const hits = settledRecords.filter((r) => r.outcome === "hit").length;
  const misses = settledRecords.filter((r) => r.outcome === "miss").length;
  const pending = records.length - settledRecords.length;
  const settled = settledRecords.length;
  const hitRate = settled > 0 ? hits / settled : null;

  let confidence: OnlineAlertStats["confidence"] = "low";
  if (settled >= 5) confidence = "high";
  else if (settled >= 3) confidence = "medium";

  return {
    alertId,
    total: records.length,
    settled,
    hits,
    misses,
    pending,
    hitRate,
    confidence,
  };
}

/**
 * Step 4 — derive a threshold suggestion for one alert.
 *
 * Combines the V2 backtest (offline, anti-overfit) with the online hit rate.
 * The function never mutates the alert; it only proposes a new target price
 * which the UI must surface for HITL confirmation. This keeps the loop
 * aligned with the project-wide rule that write actions never auto-execute.
 *
 * Direction conventions:
 * - "tighten" pushes the threshold further from typical price (harder to hit,
 *   used when the rule fires too often and is mostly wrong).
 * - "loosen" pulls the threshold closer to typical price (easier to hit, used
 *   when the rule never fires and we have no signal at all).
 */
export function suggestThreshold(alert: PriceAlert): ThresholdSuggestion {
  const params = getSuggestionParams();
  const online = getOnlineStats(alert.id);
  let backtest: BacktestResultV2 | null = null;
  try {
    backtest = backtestAlertsV2([alert]);
  } catch {
    backtest = null;
  }

  const stabilityUnreliable =
    !backtest || backtest.stability.thresholdSensitivity >= 0.6;
  const offlineTriggered = backtest?.triggeredAlerts ?? 0;
  const offlineAccuracy =
    backtest && offlineTriggered > 0
      ? backtest.accurateAlerts / offlineTriggered
      : null;

  // Loosen first — if the rule has *never* fired (online + offline both empty
  // of triggers) but we do have price history, this is the most actionable
  // case: pull the threshold closer to the most recent observed price so
  // the rule has a chance to produce data. Must run before the
  // insufficient_data branch, which would otherwise swallow it.
  const lastPrice = backtest?.pricePoints.at(-1)?.price ?? null;
  if (online.total === 0 && offlineTriggered === 0 && lastPrice) {
    const delta = lastPrice * params.loosenDelta;
    const suggested =
      alert.condition === "above"
        ? Math.max(lastPrice * 0.9, alert.targetPrice - delta)
        : Math.min(lastPrice * 1.1, alert.targetPrice + delta);
    return {
      alertId: alert.id,
      action: "loosen",
      currentTarget: alert.targetPrice,
      suggestedTarget: roundPrice(suggested),
      reason: `警报从未触发（在线 0 次，回测 0 次）。建议把目标价向最近价格 ${roundPrice(lastPrice)} 靠近 ${(params.loosenDelta * 100).toFixed(0)}%，让规则有机会产生信号。`,
      backtest,
      online,
    };
  }

  // Insufficient data: neither stream gives us anything we can act on without
  // overfitting. Be explicit so the UI can disable "Apply".
  if (
    online.confidence === "low" &&
    (stabilityUnreliable || offlineTriggered < 3)
  ) {
    return {
      alertId: alert.id,
      action: "insufficient_data",
      currentTarget: alert.targetPrice,
      suggestedTarget: null,
      reason:
        "数据不足：在线样本 < 3 且回测稳定性不可信，暂不建议调整阈值。继续运行警报积累更多触发记录后再评估。",
      backtest,
      online,
    };
  }

  // Combined accuracy — prefer settled online samples once we have ≥3.
  // Low-confidence dampening: use a fraction of onlineWeight when settled < 3.
  const onlineWeight = online.settled >= 3 ? params.onlineWeight : params.onlineWeight * 0.33;
  const offlineWeight = 1 - onlineWeight;
  const combinedAccuracy =
    (online.hitRate ?? 0) * onlineWeight +
    (offlineAccuracy ?? 0) * offlineWeight;

  // Keep: combined accuracy is good and stability is solid.
  if (combinedAccuracy >= params.keepThreshold && !stabilityUnreliable) {
    return {
      alertId: alert.id,
      action: "keep",
      currentTarget: alert.targetPrice,
      suggestedTarget: alert.targetPrice,
      reason: `综合准确率 ${(combinedAccuracy * 100).toFixed(0)}%（在线 ${online.settled} 次 / 回测 ${offlineTriggered} 次），阈值稳定，建议保留。`,
      backtest,
      online,
    };
  }

  // Tighten: rule fires often but is mostly wrong → move further from price.
  if (combinedAccuracy < params.tightenThreshold && (online.settled >= 3 || offlineTriggered >= 3)) {
    const ref = lastPrice ?? alert.targetPrice;
    const delta = ref * params.tightenDelta;
    const suggested =
      alert.condition === "above"
        ? alert.targetPrice + delta
        : alert.targetPrice - delta;
    return {
      alertId: alert.id,
      action: "tighten",
      currentTarget: alert.targetPrice,
      suggestedTarget: roundPrice(Math.max(suggested, 0.0001)),
      reason: `综合准确率仅 ${(combinedAccuracy * 100).toFixed(0)}%（在线 ${online.settled} 次 / 回测 ${offlineTriggered} 次），误报偏多。建议把目标价${alert.condition === "above" ? "上调" : "下调"} ${(params.tightenDelta * 100).toFixed(0)}%，提升信号质量。`,
      backtest,
      online,
    };
  }

  // Middle band — keep but flag as borderline so the UI can show a soft warning.
  return {
    alertId: alert.id,
    action: "keep",
    currentTarget: alert.targetPrice,
    suggestedTarget: alert.targetPrice,
    reason: `综合准确率 ${(combinedAccuracy * 100).toFixed(0)}%（在线 ${online.settled} 次 / 回测 ${offlineTriggered} 次），处于中间区间。继续观察，再积累几次触发后重新评估。`,
    backtest,
    online,
  };
}

function roundPrice(p: number): number {
  if (p === 0) return 0;
  if (p < 1) return parseFloat(p.toFixed(6));
  if (p < 100) return parseFloat(p.toFixed(4));
  return parseFloat(p.toFixed(2));
}
