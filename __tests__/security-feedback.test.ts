import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordSecurityTrigger,
  settleByExecutedSwap,
  settleByTvlChange,
  settleBySandwichBehavior,
  expirePending,
  getSecurityStats,
  getSecurityRecords,
  suggestSecurityThresholds,
  clearSecurityFeedback,
  type PriceImpactContext,
  type LiquidityFlowContext,
  type SandwichContext,
} from "../lib/agent/security-feedback";
import { THRESHOLDS } from "../lib/agent/security-core";
import type { DecodedAmmEvent } from "../lib/agent/security-core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePriceImpactCtx(
  predictedImpactPct = 2.5,
  reserveA = "1000000",
  reserveB = "1000000"
): PriceImpactContext {
  return {
    predictedImpactPct,
    amountIn: "500000",
    tokenIn: "TKNA",
    reserveAAtTrigger: reserveA,
    reserveBAtTrigger: reserveB,
  };
}

function makeLiquidityFlowCtx(
  outflowPct = 10,
  tvlAtTrigger = 2_000_000
): LiquidityFlowContext {
  return {
    outflowPct,
    reserveAAtTrigger: "1000000",
    reserveBAtTrigger: "1000000",
    tvlAtTrigger,
  };
}

function makeSandwichCtx(
  suspectAddress = "GATTACKER",
  frontRunLedger = 100,
  observedAtLedger = 100
): SandwichContext {
  return { suspectAddress, frontRunLedger, observedAtLedger };
}

function makeSwapEvent(
  user: string,
  ledger: number,
  tokenIn: string,
  amountIn: bigint,
  amountOut: bigint
): Extract<DecodedAmmEvent, { kind: "swap" }> {
  return { kind: "swap", ledger, user, tokenIn, amountIn, amountOut };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("security-feedback", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  // ── recordSecurityTrigger ──────────────────────────────────────────────────

  describe("recordSecurityTrigger", () => {
    it("ignores low-risk triggers — does not persist to storage", () => {
      recordSecurityTrigger("price_impact", "low", makePriceImpactCtx(), 1_000);
      expect(getSecurityRecords()).toHaveLength(0);
    });

    it("creates a pending record for medium risk", () => {
      const rec = recordSecurityTrigger(
        "price_impact",
        "medium",
        makePriceImpactCtx(),
        2_000
      );
      expect(rec.outcome).toBe("pending");
      expect(rec.detectorType).toBe("price_impact");
      expect(rec.riskLevel).toBe("medium");
      expect(rec.triggeredAt).toBe(2_000);
      expect(getSecurityRecords("price_impact")).toHaveLength(1);
    });

    it("creates a pending record for high risk", () => {
      const rec = recordSecurityTrigger(
        "liquidity_flow",
        "high",
        makeLiquidityFlowCtx(),
        3_000
      );
      expect(rec.outcome).toBe("pending");
      expect(rec.riskLevel).toBe("high");
      expect(getSecurityRecords("liquidity_flow")).toHaveLength(1);
    });

    it("appends multiple records without replacing", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 1_000);
      recordSecurityTrigger("price_impact", "high", makePriceImpactCtx(5), 2_000);
      expect(getSecurityRecords("price_impact")).toHaveLength(2);
    });
  });

  // ── settleByExecutedSwap ───────────────────────────────────────────────────

  describe("settleByExecutedSwap", () => {
    it("confirms when actual impact is within 20% of predicted", () => {
      // predicted = 2.5, actual = 2.6 → |2.6-2.5|/2.5 = 0.04 ≤ 0.20 → confirmed
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 1_000);
      const settled = settleByExecutedSwap(2.6, 2_000);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("confirmed");
    });

    it("marks false_positive when actual diverges more than 20% from predicted", () => {
      // predicted = 2.5, actual = 0.5 → |0.5-2.5|/2.5 = 0.80 > 0.20 → false_positive
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 1_000);
      const settled = settleByExecutedSwap(0.5, 2_000);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("false_positive");
    });

    it("refuses to settle when observedAt <= triggeredAt (no future leak)", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 5_000);
      // Same timestamp — must not settle
      expect(settleByExecutedSwap(2.5, 5_000)).toHaveLength(0);
      // Earlier timestamp — must not settle
      expect(settleByExecutedSwap(2.5, 4_999)).toHaveLength(0);
      expect(getSecurityStats("price_impact").pending).toBe(1);
    });

    it("does not re-settle an already-settled record (one-shot invariant)", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 1_000);
      settleByExecutedSwap(2.6, 2_000); // confirmed
      // Second call with diverging actual — must not flip to false_positive
      const second = settleByExecutedSwap(0.1, 3_000);
      expect(second).toHaveLength(0);
      expect(getSecurityStats("price_impact").confirmed).toBe(1);
      expect(getSecurityStats("price_impact").falsePositives).toBe(0);
    });

    it("only settles price_impact records, not other detector types", () => {
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(), 1_000);
      const settled = settleByExecutedSwap(2.5, 2_000);
      expect(settled).toHaveLength(0);
      expect(getSecurityStats("liquidity_flow").pending).toBe(1);
    });
  });

  // ── settleByTvlChange ──────────────────────────────────────────────────────

  describe("settleByTvlChange", () => {
    it("keeps record pending when observation is less than 1 hour after trigger", () => {
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(10, 2_000_000), 0);
      // 30 minutes later — should stay pending
      const settled = settleByTvlChange(900_000, 900_000, 1_800_000);
      expect(settled).toHaveLength(0);
      expect(getSecurityStats("liquidity_flow").pending).toBe(1);
    });

    it("confirms when current TVL drops more than 5% below trigger TVL", () => {
      // tvlAtTrigger = 2_000_000; currentTvl = 1_800_000 (10% drop) → confirmed
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(10, 2_000_000), 0);
      const settled = settleByTvlChange(900_000, 900_000, 3_600_001);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("confirmed");
    });

    it("marks false_positive when TVL is stable (drop <= 5%)", () => {
      // tvlAtTrigger = 2_000_000; currentTvl = 1_960_000 (2% drop) → false_positive
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(10, 2_000_000), 0);
      const settled = settleByTvlChange(980_000, 980_000, 3_600_001);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("false_positive");
    });
  });

  // ── settleBySandwichBehavior ───────────────────────────────────────────────

  describe("settleBySandwichBehavior", () => {
    it("confirms when suspect address has a profitable round-trip within events", () => {
      // observedAtLedger=100, currentLedger=115 → 15 > ledgerWindow(10) → eligible
      recordSecurityTrigger(
        "sandwich",
        "medium",
        makeSandwichCtx("GATTACKER", 100, 100),
        1_000
      );

      const events: DecodedAmmEvent[] = [
        // buy: TKNA in, 1000 out
        makeSwapEvent("GATTACKER", 100, "TKNA", 1000n, 1000n),
        // sell: TKNB in (opposite), 1200 out > 1000 in → profitable
        makeSwapEvent("GATTACKER", 102, "TKNB", 500n, 1200n),
      ];

      const settled = settleBySandwichBehavior(events, 115, 10);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("confirmed");
    });

    it("marks false_positive when no profitable round-trip found within window", () => {
      recordSecurityTrigger(
        "sandwich",
        "medium",
        makeSandwichCtx("GATTACKER", 100, 100),
        1_000
      );

      // No events for GATTACKER at all
      const events: DecodedAmmEvent[] = [
        makeSwapEvent("GINNOCENT", 101, "TKNA", 500n, 500n),
      ];

      const settled = settleBySandwichBehavior(events, 115, 10);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("false_positive");
    });

    it("leaves record pending when not enough ledgers have passed", () => {
      // observedAtLedger=100, currentLedger=105 → 5 <= ledgerWindow(10) → pending
      recordSecurityTrigger(
        "sandwich",
        "medium",
        makeSandwichCtx("GATTACKER", 100, 100),
        1_000
      );

      const events: DecodedAmmEvent[] = [
        makeSwapEvent("GATTACKER", 100, "TKNA", 1000n, 1000n),
        makeSwapEvent("GATTACKER", 102, "TKNB", 500n, 1200n),
      ];

      const settled = settleBySandwichBehavior(events, 105, 10);
      expect(settled).toHaveLength(0);
      expect(getSecurityStats("sandwich").pending).toBe(1);
    });
  });

  // ── expirePending ──────────────────────────────────────────────────────────

  describe("expirePending", () => {
    it("flips records older than 24h to expired", () => {
      const DAY_MS = 24 * 3_600_000;
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 0);
      const expired = expirePending(DAY_MS + 1);
      expect(expired).toHaveLength(1);
      expect(expired[0].outcome).toBe("expired");
      expect(getSecurityStats("price_impact").expired).toBe(1);
    });

    it("does not expire records younger than 24h", () => {
      const DAY_MS = 24 * 3_600_000;
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 0);
      const expired = expirePending(DAY_MS - 1);
      expect(expired).toHaveLength(0);
      expect(getSecurityStats("price_impact").pending).toBe(1);
    });

    it("does not re-expire an already-settled record", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 0);
      settleByExecutedSwap(2.6, 1_000); // confirmed
      const expired = expirePending(48 * 3_600_000);
      expect(expired).toHaveLength(0);
      expect(getSecurityStats("price_impact").confirmed).toBe(1);
    });
  });

  // ── getSecurityStats ───────────────────────────────────────────────────────

  describe("getSecurityStats", () => {
    it("returns null precision and low confidence with no settled samples", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 1_000);
      const stats = getSecurityStats("price_impact");
      expect(stats.precision).toBeNull();
      expect(stats.confidence).toBe("low");
      expect(stats.pending).toBe(1);
    });

    it("computes precision correctly and escalates confidence with sample count", () => {
      const base = 1_000;
      // 4 confirmed, 1 false_positive → precision = 4/5 = 0.8
      for (let i = 0; i < 4; i++) {
        recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), base + i * 1000);
        settleByExecutedSwap(2.6, base + i * 1000 + 500); // confirmed
      }
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), base + 4_000);
      settleByExecutedSwap(0.1, base + 4_500); // false_positive

      const stats = getSecurityStats("price_impact");
      expect(stats.confirmed).toBe(4);
      expect(stats.falsePositives).toBe(1);
      expect(stats.precision).toBeCloseTo(0.8);
      expect(stats.confidence).toBe("high"); // 5 settled >= 5
    });

    it("reports medium confidence with 3-4 settled samples", () => {
      for (let i = 0; i < 3; i++) {
        recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), i * 1000);
        settleByExecutedSwap(2.6, i * 1000 + 500);
      }
      expect(getSecurityStats("price_impact").confidence).toBe("medium");
    });

    it("filters by detectorType when provided", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 1_000);
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(), 2_000);
      expect(getSecurityStats("price_impact").total).toBe(1);
      expect(getSecurityStats("liquidity_flow").total).toBe(1);
      expect(getSecurityStats().total).toBe(2);
    });
  });

  // ── suggestSecurityThresholds ──────────────────────────────────────────────

  describe("suggestSecurityThresholds", () => {
    it("returns insufficient_data when confidence is low", () => {
      // No records at all
      const sug = suggestSecurityThresholds("price_impact");
      expect(sug.action).toBe("insufficient_data");
      expect(sug.suggestedThresholds).toBeNull();
    });

    it("returns keep when precision >= 0.75", () => {
      // 5 confirmed, 0 false_positive → precision = 1.0
      for (let i = 0; i < 5; i++) {
        recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), i * 1000);
        settleByExecutedSwap(2.6, i * 1000 + 500);
      }
      const sug = suggestSecurityThresholds("price_impact");
      expect(sug.action).toBe("keep");
      expect(sug.suggestedThresholds).not.toBeNull();
    });

    it("returns tighten when precision < 0.5 with >= 3 false positives", () => {
      // 1 confirmed, 4 false_positive → precision = 0.2 < 0.5, falsePositives = 4 >= 3
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 0);
      settleByExecutedSwap(2.6, 500); // confirmed

      for (let i = 1; i <= 4; i++) {
        recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), i * 1000);
        settleByExecutedSwap(0.1, i * 1000 + 500); // false_positive
      }

      const sug = suggestSecurityThresholds("price_impact");
      expect(sug.action).toBe("tighten");
      expect(sug.suggestedThresholds).not.toBeNull();
      // Suggested thresholds should be higher than current (raised ~10%)
      expect(sug.suggestedThresholds!.medium).toBeGreaterThan(sug.currentThresholds.medium);
      expect(sug.suggestedThresholds!.high).toBeGreaterThan(sug.currentThresholds.high);
    });

    it("never mutates the live THRESHOLDS object", () => {
      // Seed enough data to trigger a tighten suggestion
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), 0);
      settleByExecutedSwap(2.6, 500);
      for (let i = 1; i <= 4; i++) {
        recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(2.5), i * 1000);
        settleByExecutedSwap(0.1, i * 1000 + 500);
      }

      const beforeMedium = THRESHOLDS.priceImpact.medium;
      const beforeHigh = THRESHOLDS.priceImpact.high;
      const beforeOutflowMedium = THRESHOLDS.liquidityOutflow.medium;
      const beforeOutflowHigh = THRESHOLDS.liquidityOutflow.high;
      const beforeAnomalyPct = THRESHOLDS.anomalyRemovalPct;
      const beforeSandwichWindow = THRESHOLDS.sandwichWindowLedgers;

      suggestSecurityThresholds("price_impact");
      suggestSecurityThresholds("liquidity_flow");
      suggestSecurityThresholds("sandwich");

      expect(THRESHOLDS.priceImpact.medium).toBe(beforeMedium);
      expect(THRESHOLDS.priceImpact.high).toBe(beforeHigh);
      expect(THRESHOLDS.liquidityOutflow.medium).toBe(beforeOutflowMedium);
      expect(THRESHOLDS.liquidityOutflow.high).toBe(beforeOutflowHigh);
      expect(THRESHOLDS.anomalyRemovalPct).toBe(beforeAnomalyPct);
      expect(THRESHOLDS.sandwichWindowLedgers).toBe(beforeSandwichWindow);
    });

    it("reads correct current thresholds for each detector type", () => {
      const piSug = suggestSecurityThresholds("price_impact");
      expect(piSug.currentThresholds.medium).toBe(THRESHOLDS.priceImpact.medium);
      expect(piSug.currentThresholds.high).toBe(THRESHOLDS.priceImpact.high);

      const lfSug = suggestSecurityThresholds("liquidity_flow");
      expect(lfSug.currentThresholds.medium).toBe(THRESHOLDS.liquidityOutflow.medium);
      expect(lfSug.currentThresholds.high).toBe(THRESHOLDS.liquidityOutflow.high);

      const swSug = suggestSecurityThresholds("sandwich");
      expect(swSug.currentThresholds.medium).toBe(THRESHOLDS.sandwichWindowLedgers);
      expect(swSug.currentThresholds.high).toBe(THRESHOLDS.anomalyRemovalPct);
    });
  });

  // ── clearSecurityFeedback ──────────────────────────────────────────────────

  describe("clearSecurityFeedback", () => {
    it("clears records for a specific detector type only", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 1_000);
      recordSecurityTrigger("liquidity_flow", "high", makeLiquidityFlowCtx(), 2_000);
      clearSecurityFeedback("price_impact");
      expect(getSecurityRecords("price_impact")).toHaveLength(0);
      expect(getSecurityRecords("liquidity_flow")).toHaveLength(1);
    });

    it("clears all records when no detector type provided", () => {
      recordSecurityTrigger("price_impact", "medium", makePriceImpactCtx(), 1_000);
      recordSecurityTrigger("sandwich", "high", makeSandwichCtx(), 2_000);
      clearSecurityFeedback();
      expect(getSecurityRecords()).toHaveLength(0);
    });
  });
});
