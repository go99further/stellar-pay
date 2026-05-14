/**
 * Runtime override layer for security detector thresholds.
 *
 * The compile-time THRESHOLDS const in security-core.ts is the default.
 * This module lets the dashboard "Apply Suggested Thresholds" button
 * actually take effect: the override is persisted to localStorage and
 * read on every detector call.
 *
 * Without this layer, the closed loop's HITL "apply" was theatre —
 * suggestions could be displayed but never reach detectPriceImpact /
 * detectLiquidityFlow / detectSandwich / detectAnomalies.
 *
 * Invariants kept consistent with alert-feedback-tuning.ts:
 *  - Bad localStorage data → fall back to defaults silently
 *  - typeof localStorage === 'undefined' guard for SSR
 *  - Validation throws on out-of-range writes (caller's setter)
 */

export interface ActiveThresholds {
  priceImpactMedium: number;
  priceImpactHigh: number;
  liquidityOutflowMedium: number;
  liquidityOutflowHigh: number;
  sandwichWindowLedgers: number;
  anomalyRemovalPct: number;
}

const STORAGE_KEY = "stellar-pay-security-thresholds-overrides";

/**
 * These MUST match THRESHOLDS in security-core.ts — single source of truth
 * would create a circular import. Tests verify they stay in sync.
 */
export const DEFAULT_ACTIVE_THRESHOLDS: ActiveThresholds = {
  priceImpactMedium: 1,
  priceImpactHigh: 3,
  liquidityOutflowMedium: 5,
  liquidityOutflowHigh: 20,
  sandwichWindowLedgers: 3,
  anomalyRemovalPct: 5,
};

function isValidShape(v: unknown): v is ActiveThresholds {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  return (
    typeof x.priceImpactMedium === "number" &&
    typeof x.priceImpactHigh === "number" &&
    typeof x.liquidityOutflowMedium === "number" &&
    typeof x.liquidityOutflowHigh === "number" &&
    typeof x.sandwichWindowLedgers === "number" &&
    typeof x.anomalyRemovalPct === "number"
  );
}

function validateRanges(t: ActiveThresholds): void {
  if (t.priceImpactMedium <= 0 || t.priceImpactHigh <= 0) {
    throw new RangeError("priceImpact thresholds must be > 0");
  }
  if (t.priceImpactMedium >= t.priceImpactHigh) {
    throw new RangeError("priceImpact medium must be < high");
  }
  if (t.liquidityOutflowMedium <= 0 || t.liquidityOutflowHigh <= 0) {
    throw new RangeError("liquidityOutflow thresholds must be > 0");
  }
  if (t.liquidityOutflowMedium >= t.liquidityOutflowHigh) {
    throw new RangeError("liquidityOutflow medium must be < high");
  }
  if (t.sandwichWindowLedgers < 1 || !Number.isInteger(t.sandwichWindowLedgers)) {
    throw new RangeError("sandwichWindowLedgers must be a positive integer");
  }
  if (t.anomalyRemovalPct <= 0 || t.anomalyRemovalPct > 100) {
    throw new RangeError("anomalyRemovalPct must be in (0, 100]");
  }
}

/** Returns the active thresholds — overrides if set & valid, defaults otherwise. */
export function getActiveThresholds(): ActiveThresholds {
  if (typeof localStorage === "undefined") return { ...DEFAULT_ACTIVE_THRESHOLDS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACTIVE_THRESHOLDS };
    const parsed = JSON.parse(raw);
    if (!isValidShape(parsed)) return { ...DEFAULT_ACTIVE_THRESHOLDS };
    return parsed;
  } catch {
    return { ...DEFAULT_ACTIVE_THRESHOLDS };
  }
}

/** Persists overrides. Throws on invalid ranges. */
export function setActiveThresholds(t: ActiveThresholds): void {
  validateRanges(t);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // ignore quota/disabled
  }
}

/** Removes overrides — next getActiveThresholds() returns defaults. */
export function clearActiveThresholds(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True iff overrides are persisted (regardless of whether they match defaults). */
export function hasActiveOverrides(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}
