/**
 * Security Feedback Loop — 安全检测数据闭环
 *
 * Phase 2 of the data closed-loop for the multi-agent security system.
 * Mirrors the shape of alert-feedback.ts but covers three security detectors:
 *   price_impact | liquidity_flow | sandwich
 *
 * Flow: trigger → pending record → settlement (per-detector rules) → stats → threshold suggestion
 *
 * Critical invariants:
 * 1. No future leak: observedAt <= triggeredAt must never settle a record.
 * 2. One-shot: a settled record cannot be re-settled.
 * 3. suggestSecurityThresholds never mutates the live THRESHOLDS object.
 */

import { type DecodedAmmEvent } from "./security-core";
import { getActiveThresholds } from "./security-thresholds-runtime";

const STORAGE_KEY = "stellar-pay-security-feedback";
const MAX_RECORDS = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SecurityDetectorType = "price_impact" | "liquidity_flow" | "sandwich";
export type SecurityOutcome = "pending" | "confirmed" | "false_positive" | "expired";

export interface PriceImpactContext {
  predictedImpactPct: number;
  amountIn: string; // bigint serialized as string for storage
  tokenIn: "TKNA" | "TKNB";
  reserveAAtTrigger: string;
  reserveBAtTrigger: string;
}

export interface LiquidityFlowContext {
  outflowPct: number;
  reserveAAtTrigger: string;
  reserveBAtTrigger: string;
  tvlAtTrigger: number; // sum of reserves at trigger time
}

export interface SandwichContext {
  suspectAddress: string;
  frontRunLedger: number;
  observedAtLedger: number;
}

export interface SecurityFeedbackRecord {
  id: string;
  detectorType: SecurityDetectorType;
  triggeredAt: number;
  riskLevel: "low" | "medium" | "high";
  triggerContext: PriceImpactContext | LiquidityFlowContext | SandwichContext;
  outcome: SecurityOutcome;
  settledAt?: number;
  settlementEvidence?: Record<string, unknown>;
}

export interface SecurityStats {
  total: number;
  settled: number;
  confirmed: number;
  falsePositives: number;
  expired: number;
  pending: number;
  precision: number | null;
  expirationRate: number;
  effectiveSampleRate: number;
  confidence: "high" | "medium" | "low";
}

export interface SecuritySuggestion {
  detectorType: SecurityDetectorType;
  action: "keep" | "tighten" | "loosen" | "insufficient_data";
  currentThresholds: { medium: number; high: number };
  suggestedThresholds: { medium: number; high: number } | null;
  reason: string;
  stats: SecurityStats;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function readAll(): SecurityFeedbackRecord[] {
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

function writeAll(records: SecurityFeedbackRecord[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const trimmed = records.slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota exceeded / disabled — silently ignore
  }
}

function isValidRecord(r: unknown): r is SecurityFeedbackRecord {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    (x.detectorType === "price_impact" ||
      x.detectorType === "liquidity_flow" ||
      x.detectorType === "sandwich") &&
    typeof x.triggeredAt === "number" &&
    (x.riskLevel === "low" || x.riskLevel === "medium" || x.riskLevel === "high") &&
    typeof x.triggerContext === "object" &&
    x.triggerContext !== null &&
    (x.outcome === "pending" ||
      x.outcome === "confirmed" ||
      x.outcome === "false_positive" ||
      x.outcome === "expired")
  );
}

function generateId(): string {
  return `sfb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Step 1 — record a security detector trigger.
 * Only records if riskLevel !== "low" (low-risk events are not worth tracking).
 */
export function recordSecurityTrigger(
  detectorType: SecurityDetectorType,
  riskLevel: "low" | "medium" | "high",
  triggerContext: PriceImpactContext | LiquidityFlowContext | SandwichContext,
  now: number = Date.now()
): SecurityFeedbackRecord {
  const record: SecurityFeedbackRecord = {
    id: generateId(),
    detectorType,
    triggeredAt: now,
    riskLevel,
    triggerContext,
    outcome: "pending",
  };

  if (riskLevel === "low") {
    // Return the record without persisting it
    return record;
  }

  const all = readAll();
  all.push(record);
  writeAll(all);
  return record;
}

/**
 * Step 2a — settle price_impact records.
 *
 * Settlement rule: |actualImpactPct - predictedImpactPct| / predictedImpactPct <= 0.20
 *   → confirmed, else → false_positive.
 * Skips records where observedAt <= triggeredAt (no future leak).
 */
export function settleByExecutedSwap(
  actualImpactPct: number,
  observedAt: number
): SecurityFeedbackRecord[] {
  const all = readAll();
  let changed = false;
  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    if (rec.detectorType !== "price_impact") return rec;
    if (observedAt <= rec.triggeredAt) return rec;

    const ctx = rec.triggerContext as PriceImpactContext;
    const predicted = ctx.predictedImpactPct;
    const relativeError =
      predicted !== 0
        ? Math.abs(actualImpactPct - predicted) / Math.abs(predicted)
        : actualImpactPct === 0
        ? 0
        : Infinity;

    const outcome: SecurityOutcome =
      relativeError <= 0.2 ? "confirmed" : "false_positive";

    changed = true;
    return {
      ...rec,
      outcome,
      settledAt: observedAt,
      settlementEvidence: {
        actualImpactPct,
        predictedImpactPct: predicted,
        relativeError,
      },
    };
  });

  if (changed) writeAll(updated);
  return updated.filter((r) => r.settledAt === observedAt && r.detectorType === "price_impact");
}

/**
 * Step 2b — settle liquidity_flow records.
 *
 * Only settles records aged >= hourMs (default 1 hour).
 * currentTvl = currentReserveA + currentReserveB (as numbers, reserves are
 * passed as numbers here since we store them as strings in context).
 * If currentTvl < tvlAtTrigger * 0.95 → confirmed, else → false_positive.
 * Records < 1h old stay pending.
 */
export function settleByTvlChange(
  currentReserveA: number,
  currentReserveB: number,
  observedAt: number,
  hourMs: number = 3_600_000
): SecurityFeedbackRecord[] {
  const all = readAll();
  let changed = false;
  const settled: SecurityFeedbackRecord[] = [];

  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    if (rec.detectorType !== "liquidity_flow") return rec;
    if (observedAt <= rec.triggeredAt) return rec;
    // Must be at least 1 hour old
    if (observedAt - rec.triggeredAt < hourMs) return rec;

    const ctx = rec.triggerContext as LiquidityFlowContext;
    const currentTvl = currentReserveA + currentReserveB;
    const outcome: SecurityOutcome =
      currentTvl < ctx.tvlAtTrigger * 0.95 ? "confirmed" : "false_positive";

    changed = true;
    const next: SecurityFeedbackRecord = {
      ...rec,
      outcome,
      settledAt: observedAt,
      settlementEvidence: {
        currentReserveA,
        currentReserveB,
        currentTvl,
        tvlAtTrigger: ctx.tvlAtTrigger,
      },
    };
    settled.push(next);
    return next;
  });

  if (changed) writeAll(updated);
  return settled;
}

/**
 * Step 2c — settle sandwich records.
 *
 * For each pending record older than ledgerWindow ledgers (currentLedger - observedAtLedger > ledgerWindow),
 * check if suspectAddress had a profitable round-trip in the provided events:
 *   buy then sell same token, gross output > input → confirmed, else → false_positive.
 */
export function settleBySandwichBehavior(
  events: DecodedAmmEvent[],
  currentLedger: number,
  ledgerWindow: number = 10
): SecurityFeedbackRecord[] {
  const all = readAll();
  let changed = false;
  const settled: SecurityFeedbackRecord[] = [];

  const swaps = events.filter(
    (e): e is Extract<DecodedAmmEvent, { kind: "swap" }> => e.kind === "swap"
  );

  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    if (rec.detectorType !== "sandwich") return rec;

    const ctx = rec.triggerContext as SandwichContext;
    // Only settle records that are older than ledgerWindow ledgers
    if (currentLedger - ctx.observedAtLedger <= ledgerWindow) return rec;

    // Check for profitable round-trip by suspectAddress
    const suspectSwaps = swaps
      .filter((s) => s.user === ctx.suspectAddress)
      .sort((a, b) => a.ledger - b.ledger);

    let hasRoundTrip = false;
    for (let i = 0; i < suspectSwaps.length; i++) {
      const buy = suspectSwaps[i];
      for (let j = i + 1; j < suspectSwaps.length; j++) {
        const sell = suspectSwaps[j];
        // Sell must be opposite direction (tokenIn of sell != tokenIn of buy)
        if (sell.tokenIn === buy.tokenIn) continue;
        // Gross output > input: sell.amountOut > buy.amountIn
        if (sell.amountOut > buy.amountIn) {
          hasRoundTrip = true;
          break;
        }
      }
      if (hasRoundTrip) break;
    }

    const outcome: SecurityOutcome = hasRoundTrip ? "confirmed" : "false_positive";
    changed = true;
    const next: SecurityFeedbackRecord = {
      ...rec,
      outcome,
      settledAt: Date.now(),
      settlementEvidence: {
        currentLedger,
        suspectAddress: ctx.suspectAddress,
        hasRoundTrip,
        swapsChecked: suspectSwaps.length,
      },
    };
    settled.push(next);
    return next;
  });

  if (changed) writeAll(updated);
  return settled;
}

/**
 * Step 2d — expire pending records older than maxAgeMs (default 24h).
 */
export function expirePending(
  now: number = Date.now(),
  maxAgeMs: number = 24 * 3_600_000
): SecurityFeedbackRecord[] {
  const all = readAll();
  let changed = false;
  const expired: SecurityFeedbackRecord[] = [];

  const updated = all.map((rec) => {
    if (rec.outcome !== "pending") return rec;
    if (now - rec.triggeredAt < maxAgeMs) return rec;

    changed = true;
    const next: SecurityFeedbackRecord = {
      ...rec,
      outcome: "expired",
      settledAt: now,
    };
    expired.push(next);
    return next;
  });

  if (changed) writeAll(updated);
  return expired;
}

/**
 * Orchestrator — run all settlement passes in sequence.
 * Callers supply the current observations; each settler only touches its own detector type.
 */
export function settleAllPending(opts: {
  priceImpact?: { actualImpactPct: number; observedAt: number };
  tvlChange?: { currentReserveA: number; currentReserveB: number; observedAt: number };
  sandwich?: { events: DecodedAmmEvent[]; currentLedger: number };
  expireNow?: number;
}): {
  priceImpactSettled: SecurityFeedbackRecord[];
  tvlSettled: SecurityFeedbackRecord[];
  sandwichSettled: SecurityFeedbackRecord[];
  expired: SecurityFeedbackRecord[];
} {
  const priceImpactSettled = opts.priceImpact
    ? settleByExecutedSwap(opts.priceImpact.actualImpactPct, opts.priceImpact.observedAt)
    : [];

  const tvlSettled = opts.tvlChange
    ? settleByTvlChange(
        opts.tvlChange.currentReserveA,
        opts.tvlChange.currentReserveB,
        opts.tvlChange.observedAt
      )
    : [];

  const sandwichSettled = opts.sandwich
    ? settleBySandwichBehavior(opts.sandwich.events, opts.sandwich.currentLedger)
    : [];

  const expired = expirePending(opts.expireNow ?? Date.now());

  return { priceImpactSettled, tvlSettled, sandwichSettled, expired };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Step 3 — per-detector (or global) statistics.
 * Confidence: >= 5 settled → high, 3-4 → medium, else low.
 * Precision = confirmed / (confirmed + falsePositives), null when no settled samples.
 */
export function getSecurityStats(detectorType?: SecurityDetectorType): SecurityStats {
  const records = getSecurityRecords(detectorType);
  const confirmed = records.filter((r) => r.outcome === "confirmed").length;
  const falsePositives = records.filter((r) => r.outcome === "false_positive").length;
  const expired = records.filter((r) => r.outcome === "expired").length;
  const pending = records.filter((r) => r.outcome === "pending").length;
  const settled = confirmed + falsePositives + expired;

  const precision =
    confirmed + falsePositives > 0 ? confirmed / (confirmed + falsePositives) : null;

  let confidence: SecurityStats["confidence"] = "low";
  if (settled >= 5) confidence = "high";
  else if (settled >= 3) confidence = "medium";

  return {
    total: records.length,
    settled,
    confirmed,
    falsePositives,
    expired,
    pending,
    precision,
    expirationRate: records.length > 0 ? expired / records.length : 0,
    effectiveSampleRate: records.length > 0 ? (confirmed + falsePositives) / records.length : 0,
    confidence,
  };
}

// ── Threshold Suggestions ─────────────────────────────────────────────────────

/**
 * Step 4 — derive threshold suggestions for one detector.
 * Never mutates the live THRESHOLDS object — all suggestions are read-only proposals.
 *
 * Logic:
 * - confidence === "low" → insufficient_data
 * - precision >= 0.75 → keep
 * - precision < 0.5 with >= 3 false positives → tighten (raise thresholds ~10%)
 * - else → keep with "borderline" message
 */
export function suggestSecurityThresholds(
  detectorType: SecurityDetectorType
): SecuritySuggestion {
  const stats = getSecurityStats(detectorType);

  // Read current thresholds (never mutate)
  const currentThresholds = getCurrentThresholds(detectorType);

  if (stats.confidence === "low") {
    return {
      detectorType,
      action: "insufficient_data",
      currentThresholds,
      suggestedThresholds: null,
      reason:
        "Insufficient data: fewer than 3 settled samples. Continue running the detector to accumulate more trigger records before evaluating thresholds.",
      stats,
    };
  }

  if (stats.precision !== null && stats.precision >= 0.75) {
    return {
      detectorType,
      action: "keep",
      currentThresholds,
      suggestedThresholds: currentThresholds,
      reason: `Precision ${(stats.precision * 100).toFixed(0)}% across ${stats.settled} settled samples. Thresholds are performing well — keep current settings.`,
      stats,
    };
  }

  if (stats.precision !== null && stats.precision < 0.5 && stats.falsePositives >= 3) {
    // Tighten: raise both medium and high thresholds by ~10%
    const suggestedThresholds = {
      medium: parseFloat((currentThresholds.medium * 1.1).toFixed(4)),
      high: parseFloat((currentThresholds.high * 1.1).toFixed(4)),
    };
    return {
      detectorType,
      action: "tighten",
      currentThresholds,
      suggestedThresholds,
      reason: `Precision only ${(stats.precision * 100).toFixed(0)}% with ${stats.falsePositives} false positives. Recommend raising thresholds ~10% to reduce false alarms.`,
      stats,
    };
  }

  // Borderline — keep but flag
  return {
    detectorType,
    action: "keep",
    currentThresholds,
    suggestedThresholds: currentThresholds,
    reason: `Precision ${stats.precision !== null ? (stats.precision * 100).toFixed(0) + "%" : "unknown"} (${stats.settled} settled samples). Borderline — continue observing before adjusting thresholds.`,
    stats,
  };
}

/**
 * Read current thresholds for a detector from the runtime override layer.
 * Returns { medium, high } in the same unit as the detector uses.
 * For sandwich, maps sandwichWindowLedgers → medium, anomalyRemovalPct → high
 * (closest analogue; suggestion targets anomalyRemovalPct adjustment).
 */
function getCurrentThresholds(detectorType: SecurityDetectorType): {
  medium: number;
  high: number;
} {
  const t = getActiveThresholds();
  if (detectorType === "price_impact") {
    return { medium: t.priceImpactMedium, high: t.priceImpactHigh };
  }
  if (detectorType === "liquidity_flow") {
    return { medium: t.liquidityOutflowMedium, high: t.liquidityOutflowHigh };
  }
  // sandwich: use sandwichWindowLedgers as medium, anomalyRemovalPct as high
  return { medium: t.sandwichWindowLedgers, high: t.anomalyRemovalPct };
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function getSecurityRecords(
  detectorType?: SecurityDetectorType
): SecurityFeedbackRecord[] {
  const all = readAll();
  return detectorType ? all.filter((r) => r.detectorType === detectorType) : all;
}

export function clearSecurityFeedback(detectorType?: SecurityDetectorType): void {
  if (!detectorType) {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    return;
  }
  writeAll(readAll().filter((r) => r.detectorType !== detectorType));
}
