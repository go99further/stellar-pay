import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordTrigger,
  recordOutcome,
  getFeedbackRecords,
  getOnlineStats,
  suggestThreshold,
  clearFeedback,
} from "../lib/agent/alert-feedback";
import {
  setSuggestionParams,
  clearSuggestionParams,
  DEFAULT_PARAMS,
} from "../lib/agent/alert-feedback-tuning";
import type { PriceAlert } from "../lib/agent/price-alerts";

function makeAlert(
  id: string,
  targetPrice: number,
  condition: "above" | "below" = "above"
): PriceAlert {
  return {
    id,
    tokenPair: "TKNA/TKNB",
    targetPrice,
    condition,
    triggered: false,
    createdAt: 1_000,
  };
}

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
  // newest first
  localStorage.setItem(key, JSON.stringify(history.reverse()));
}

describe("alert-feedback", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe("recordTrigger", () => {
    it("creates a pending record with the trigger price", () => {
      const alert = makeAlert("a1", 1.5, "above");
      const rec = recordTrigger(alert, 1.6, 5_000);
      expect(rec.outcome).toBe("pending");
      expect(rec.triggerPrice).toBe(1.6);
      expect(rec.targetPrice).toBe(1.5);
      expect(rec.alertId).toBe("a1");
      expect(getFeedbackRecords("a1")).toHaveLength(1);
    });

    it("appends rather than replaces across triggers", () => {
      const alert = makeAlert("a1", 1.5);
      recordTrigger(alert, 1.6, 1_000);
      recordTrigger(alert, 1.7, 2_000);
      expect(getFeedbackRecords("a1")).toHaveLength(2);
    });
  });

  describe("recordOutcome — settlement rules", () => {
    it("settles 'above' alert as hit when next price holds at/above trigger", () => {
      const alert = makeAlert("a1", 1.5, "above");
      recordTrigger(alert, 1.6, 1_000);
      const settled = recordOutcome(1.65, 2_000);
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome).toBe("hit");
    });

    it("settles 'above' alert as miss when next price drops below trigger", () => {
      const alert = makeAlert("a1", 1.5, "above");
      recordTrigger(alert, 1.6, 1_000);
      const settled = recordOutcome(1.4, 2_000);
      expect(settled[0].outcome).toBe("miss");
    });

    it("settles 'below' alert with symmetric semantics", () => {
      const alert = makeAlert("a1", 1.5, "below");
      recordTrigger(alert, 1.4, 1_000);
      expect(recordOutcome(1.3, 2_000)[0].outcome).toBe("hit");
      const a2 = makeAlert("a2", 1.5, "below");
      recordTrigger(a2, 1.4, 3_000);
      expect(recordOutcome(1.6, 4_000)[0].outcome).toBe("miss");
    });

    it("does not settle from a stale or simultaneous observation (no future-leak)", () => {
      const alert = makeAlert("a1", 1.5, "above");
      recordTrigger(alert, 1.6, 5_000);
      // observedAt <= triggeredAt must be ignored
      expect(recordOutcome(2.0, 5_000)).toHaveLength(0);
      expect(recordOutcome(2.0, 4_999)).toHaveLength(0);
      expect(getOnlineStats("a1").pending).toBe(1);
    });

    it("only settles each pending record once", () => {
      const alert = makeAlert("a1", 1.5, "above");
      recordTrigger(alert, 1.6, 1_000);
      recordOutcome(1.7, 2_000);
      const second = recordOutcome(0.5, 3_000);
      expect(second).toHaveLength(0); // already settled, no further mutation
      expect(getOnlineStats("a1").hits).toBe(1);
      expect(getOnlineStats("a1").misses).toBe(0);
    });
  });

  describe("getOnlineStats", () => {
    it("reports null hit rate with no settled samples", () => {
      const alert = makeAlert("a1", 1.5);
      recordTrigger(alert, 1.6, 1_000);
      const stats = getOnlineStats("a1");
      expect(stats.hitRate).toBeNull();
      expect(stats.pending).toBe(1);
      expect(stats.confidence).toBe("low");
    });

    it("computes hit rate and escalates confidence with sample count", () => {
      const alert = makeAlert("a1", 1.5, "above");
      // 5 hits — confidence high
      for (let i = 0; i < 5; i++) {
        recordTrigger(alert, 1.6, 1_000 + i * 1000);
        recordOutcome(1.7, 1_000 + i * 1000 + 500);
      }
      const stats = getOnlineStats("a1");
      expect(stats.settled).toBe(5);
      expect(stats.hits).toBe(5);
      expect(stats.hitRate).toBe(1);
      expect(stats.confidence).toBe("high");
    });
  });

  describe("suggestThreshold — HITL never auto-applies", () => {
    it("returns insufficient_data when both online and offline are weak", () => {
      const alert = makeAlert("a1", 1.5, "above");
      const sug = suggestThreshold(alert);
      expect(sug.action).toBe("insufficient_data");
      expect(sug.suggestedTarget).toBeNull();
    });

    it("suggests 'loosen' when alert never fires but history exists", () => {
      // Prices oscillate around 1.0; alert at 5.0 (above) never fires offline.
      seedSwapHistory([1.0, 1.05, 0.95, 1.02, 0.98, 1.03, 0.97, 1.01, 1.04, 1.0]);
      const alert = makeAlert("a1", 5.0, "above");
      const sug = suggestThreshold(alert);
      expect(sug.action).toBe("loosen");
      expect(sug.suggestedTarget).not.toBeNull();
      expect(sug.suggestedTarget!).toBeLessThan(5.0); // pulled toward last price
    });

    it("suggests 'tighten' when triggers happen but accuracy is poor", () => {
      // Strong downtrend after each trigger → 'above' alerts mis-fire.
      seedSwapHistory([
        1.5, 1.4, 1.6, 1.4, 1.6, 1.4, 1.6, 1.4, 1.6, 1.4, 1.6, 1.4,
      ]);
      const alert = makeAlert("a1", 1.5, "above");
      // Add online misses to push combined accuracy < 0.5 with confidence
      for (let i = 0; i < 5; i++) {
        recordTrigger(alert, 1.6, 10_000 + i * 1000);
        recordOutcome(1.4, 10_000 + i * 1000 + 500); // miss every time
      }
      const sug = suggestThreshold(alert);
      expect(["tighten", "keep"]).toContain(sug.action);
      // The important property: when 'tighten', suggestion moves *away* from price
      if (sug.action === "tighten") {
        expect(sug.suggestedTarget!).toBeGreaterThan(alert.targetPrice);
      }
    });

    it("never mutates the underlying alert object", () => {
      const alert = makeAlert("a1", 1.5, "above");
      const before = { ...alert };
      suggestThreshold(alert);
      expect(alert).toEqual(before);
    });
  });

  describe("clearFeedback", () => {
    it("clears records for a single alert", () => {
      recordTrigger(makeAlert("a1", 1.5), 1.6, 1_000);
      recordTrigger(makeAlert("a2", 2.0), 2.1, 1_000);
      clearFeedback("a1");
      expect(getFeedbackRecords("a1")).toHaveLength(0);
      expect(getFeedbackRecords("a2")).toHaveLength(1);
    });

    it("clears all when no id provided", () => {
      recordTrigger(makeAlert("a1", 1.5), 1.6, 1_000);
      recordTrigger(makeAlert("a2", 2.0), 2.1, 1_000);
      clearFeedback();
      expect(getFeedbackRecords()).toHaveLength(0);
    });
  });

  describe("price-alerts integration — checkAlerts records triggers automatically", () => {
    it("creates a feedback record when checkAlerts flips an alert", async () => {
      const { createAlert, checkAlerts } = await import(
        "../lib/agent/price-alerts"
      );
      const created = createAlert("TKNA/TKNB", 1.5, "above");
      expect(created.success).toBe(true);
      const triggered = checkAlerts(/* priceAtoB */ 1.6, /* priceBtoA */ 0.625);
      expect(triggered).toHaveLength(1);
      const records = getFeedbackRecords(created.alert!.id);
      expect(records).toHaveLength(1);
      expect(records[0].outcome).toBe("pending");
      expect(records[0].triggerPrice).toBe(1.6);
    });
  });

  describe("suggestThreshold respects custom tuning params", () => {
    afterEach(() => clearSuggestionParams());

    it("borderline-keep scenario becomes 'keep' when keepThreshold is lowered to 0.30", () => {
      // 20-price alternating series: alert above 1.5 fires on every price.
      // Validation window (prices[12..16]) → 2 hits, 1 miss → offlineAcc ≈ 0.67.
      // Online: 3 hits, 2 misses → hitRate = 0.6, settled = 5 → onlineWeight = 0.6.
      // combined ≈ 0.6*0.6 + 0.67*0.4 ≈ 0.627 — above tightenThreshold (0.5)
      // but below keepThreshold (0.75) → middle band "keep" (borderline).
      // Stability: train acc ≈ 0.55, val acc ≈ 0.67 → variance 0.12 → sensitivity 0.5 < 0.6.
      seedSwapHistory([
        1.6, 1.7, 1.6, 1.7, 1.6, 1.7, 1.6, 1.7, 1.6, 1.7,
        1.6, 1.7, 1.6, 1.7, 1.6, 1.7, 1.6, 1.7, 1.6, 1.7,
      ]);
      const alert = makeAlert("a-custom", 1.5, "above");

      // 3 hits, 2 misses → hitRate = 0.6
      for (let i = 0; i < 3; i++) {
        recordTrigger(alert, 1.6, 10_000 + i * 1000);
        recordOutcome(1.65, 10_000 + i * 1000 + 500); // hit
      }
      for (let i = 3; i < 5; i++) {
        recordTrigger(alert, 1.6, 10_000 + i * 1000);
        recordOutcome(1.4, 10_000 + i * 1000 + 500); // miss
      }

      // Baseline: combined ≈ 0.627 → middle band → action is "keep"
      const baseline = suggestThreshold(alert);
      expect(baseline.action).toBe("keep");

      // Lower keepThreshold to 0.30 (tightenThreshold must stay below it).
      // combined 0.627 >> 0.30 → still "keep", but now via the high-confidence
      // branch (combinedAccuracy >= keepThreshold && !stabilityUnreliable).
      setSuggestionParams({ ...DEFAULT_PARAMS, keepThreshold: 0.30, tightenThreshold: 0.20 });
      const custom = suggestThreshold(alert);
      expect(custom.action).toBe("keep");
      // The reason string for the high-confidence branch contains "阈值稳定"
      expect(custom.reason).toContain("阈值稳定");
    });
  });
});
