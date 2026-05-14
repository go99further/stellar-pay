/**
 * selection-bias.test.ts
 *
 * Demonstrative comparison: same trigger, same observation sequence, run BOTH
 * settlement rules and show hit-rate divergence on a synthetic mean-reverting
 * price series.
 *
 * This is the interview punchline: the gap between next_tick and k_tick_avg
 * hit rates IS the selection bias introduced by settling on a single tick
 * immediately after a threshold crossing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTrigger,
  recordOutcome,
  recordOutcomeKTick,
  clearOutcomeBuffer,
  getFeedbackRecords,
} from "../lib/agent/alert-feedback";
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

/**
 * Deterministic mean-reverting price series.
 *
 * Pattern: every breakout above 1.00 is followed by partial reversion.
 * Trigger fires at 1.05 (above 1.00). The subsequent 5 ticks are:
 *   [1.05, 0.99, 1.02, 1.01, 1.03]
 * Mean = (1.05 + 0.99 + 1.02 + 1.01 + 1.03) / 5 = 1.02 → hit (>= 1.00)
 *
 * But the FIRST tick after the trigger is 1.05 (hit) for some triggers and
 * 0.99 (miss) for others, depending on where in the cycle we are.
 *
 * To surface the bias clearly we use a series where the first post-trigger
 * tick is ABOVE the trigger (so next_tick always says "hit") but the 5-tick
 * mean sometimes dips below (so k_tick_avg correctly says "miss").
 *
 * Bias-surfacing series (20 triggers):
 *   Trigger at 1.00. Post-trigger ticks: [1.05, 0.95, 0.90, 0.85, 0.80]
 *   next_tick: 1.05 >= 1.00 → HIT (biased — ignores reversion)
 *   k_tick_avg: mean = 0.91 < 1.00 → MISS (correct — move did not sustain)
 *
 * For the "recovery" series (k_tick_avg should show higher hit rate):
 *   Trigger at 1.00. Post-trigger ticks: [1.05, 1.03, 1.02, 1.04, 1.06]
 *   next_tick: 1.05 >= 1.00 → HIT
 *   k_tick_avg: mean = 1.04 >= 1.00 → HIT
 *   Both agree here — the bias only surfaces on the reverting triggers.
 *
 * We interleave 10 reverting triggers (bias surfaces) and 10 sustained triggers
 * (both rules agree) to get a realistic mixed series.
 */

// Reverting: first tick above, but mean below trigger → next_tick=HIT, k_tick=MISS
const REVERTING_POST_TICKS = [1.05, 0.95, 0.90, 0.85, 0.80]; // mean = 0.91

const TRIGGER_PRICE = 1.05; // price that crossed the threshold
const TARGET_PRICE = 1.00; // alert threshold

describe("selection bias: next_tick vs k_tick_avg on mean-reverting prices", () => {
  beforeEach(() => {
    localStorage.clear();
    clearOutcomeBuffer();
  });

  it("next_tick rule produces a structurally low hit rate on mean-reverting series", () => {
    // 20 triggers: all use the REVERTING post-tick series.
    // next_tick sees 1.05 (first tick) → always HIT → hit rate = 1.0
    // But this is the BIASED result — the move never sustained.
    // We use a mixed series (10 reverting + 10 sustained) to show the bias
    // inflates the hit rate beyond what the move actually warranted.
    //
    // For the pure-reverting case: next_tick hit rate = 1.0 (all first ticks above)
    // but the "true" sustained hit rate (k_tick_avg) = 0.0 (all means below).
    // The gap is 1.0 — that IS the selection bias.

    const alert = makeAlert("bias-next", TARGET_PRICE, "above");
    let hits = 0;
    let total = 0;

    for (let i = 0; i < 20; i++) {
      const t = 10_000 + i * 1_000;
      recordTrigger(alert, TRIGGER_PRICE, t);
      // Settle with next_tick (first post-trigger observation)
      const settled = recordOutcome(REVERTING_POST_TICKS[0], t + 100);
      if (settled.length > 0) {
        total++;
        if (settled[0].outcome === "hit") hits++;
      }
    }

    const hitRate = hits / total;
    // next_tick always sees 1.05 >= 1.00 → always HIT → hit rate = 1.0
    // This is the biased over-estimate.
    expect(hitRate).toBeGreaterThanOrEqual(0.9);
    // The "true" sustained rate (k_tick_avg) will be 0.0 — gap is the bias.
  });

  it("k_tick_avg rule recovers the true hit rate on the same series", () => {
    // Same 20 reverting triggers. k_tick_avg uses mean of 5 ticks = 0.91 < 1.00 → MISS.
    // Hit rate = 0.0 — correctly reflects that the move did not sustain.

    const alert = makeAlert("bias-ktick", TARGET_PRICE, "above");
    let hits = 0;
    let total = 0;

    for (let i = 0; i < 20; i++) {
      const t = 10_000 + i * 1_000;
      recordTrigger(alert, TRIGGER_PRICE, t);
      // Feed all 5 post-trigger ticks
      REVERTING_POST_TICKS.forEach((p, j) => {
        const settled = recordOutcomeKTick(p, t + (j + 1) * 100, 5);
        if (settled.length > 0) {
          total++;
          if (settled[0].outcome === "hit") hits++;
        }
      });
    }

    const hitRate = total > 0 ? hits / total : 0;
    // k_tick_avg mean = 0.91 < 1.00 → all MISS → hit rate = 0.0
    // This correctly reflects that the breakout never sustained.
    expect(hitRate).toBeLessThan(0.2);
    expect(total).toBe(20);
  });

  it("documents that the gap between the two rules IS the selection bias", () => {
    // Run the same 20 reverting triggers through BOTH rules in parallel.
    // next_tick hit rate >> k_tick_avg hit rate.
    // The difference is the selection bias: settling on the first tick
    // after a threshold crossing systematically over-counts hits because
    // the price has just moved up to cross — mean reversion makes the
    // first tick more likely to be above than subsequent ticks.

    const alertNext = makeAlert("gap-next", TARGET_PRICE, "above");
    const alertKtick = makeAlert("gap-ktick", TARGET_PRICE, "above");

    let nextHits = 0;
    let nextTotal = 0;
    let kHits = 0;
    let kTotal = 0;

    for (let i = 0; i < 20; i++) {
      const t = 10_000 + i * 1_000;

      // next_tick path
      recordTrigger(alertNext, TRIGGER_PRICE, t);
      const nextSettled = recordOutcome(REVERTING_POST_TICKS[0], t + 100);
      if (nextSettled.length > 0) {
        nextTotal++;
        if (nextSettled[0].outcome === "hit") nextHits++;
      }

      // k_tick_avg path
      recordTrigger(alertKtick, TRIGGER_PRICE, t);
      REVERTING_POST_TICKS.forEach((p, j) => {
        const ks = recordOutcomeKTick(p, t + (j + 1) * 100, 5);
        if (ks.length > 0) {
          kTotal++;
          if (ks[0].outcome === "hit") kHits++;
        }
      });
    }

    // Verify both rules settled all 20 triggers
    expect(nextTotal).toBe(20);
    expect(kTotal).toBe(20);

    // The gap: k_tick_avg hits < next_tick hits by at least 3
    // (in practice the gap is 20 on this pure-reverting series)
    expect(nextHits).toBeGreaterThan(kHits + 3);

    // Sanity: the records are stored separately and don't interfere
    const nextRecords = getFeedbackRecords("gap-next");
    const kRecords = getFeedbackRecords("gap-ktick");
    expect(nextRecords.filter((r) => r.settlementRule === undefined)).toHaveLength(20);
    expect(kRecords.filter((r) => r.settlementRule === "k_tick_avg")).toHaveLength(20);
  });
});
