/**
 * selection-bias.test.ts
 *
 * Demonstrates selection bias using the SAME oracle (next-1-tick: did price
 * stay at/above bar?) but TWO different sampling strategies:
 *
 *   Strategy A (random):      sample t uniformly at random → P(stay)
 *   Strategy B (conditional): sample only t where alert just fired
 *                             (prices[t-1] < bar AND prices[t] >= bar)
 *                             → P(stay | just fired)
 *
 * Selection bias = P(stay) - P(stay | just fired)
 *
 * On an oscillating mean-reverting series (AR(1) with phi < 0), the price
 * overshoots the mean in the opposite direction each tick. After crossing up
 * through bar=mean, the next tick is pulled back below — so P(stay|fired) is
 * lower than the unconditional P(stay).
 *
 * On a white-noise (i.i.d.) series, conditioning on just-fired gives no extra
 * information, so the two probabilities are approximately equal.
 *
 * On a strongly trending series, "just fired upward" tends to continue, so
 * P(stay|fired) >= P(stay).
 *
 * NOTE on AR(1) sign convention used here:
 *   price[t+1] = mean + phi * (price[t] - mean) + noise
 *   phi > 0 → persistent (slow mean reversion, positive autocorrelation)
 *   phi = 0 → white noise (i.i.d.)
 *   phi < 0 → oscillating mean reversion (overshoots each tick)
 * The tests below use phi < 0 to produce the selection-bias effect.
 */

import { describe, it, expect } from "vitest";

// ── Deterministic RNG ────────────────────────────────────────────────────────

/** Mulberry32 seeded PRNG — returns a function that yields [0, 1) floats. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Series generators ────────────────────────────────────────────────────────

/**
 * Oscillating mean-reverting AR(1):
 *   price[t+1] = mean + phi * (price[t] - mean) + noise
 *
 * phi must be negative for oscillating reversion (overshoots each tick).
 * Larger |phi| = stronger oscillation = bigger selection bias.
 * noise ~ Uniform(-0.05, 0.05).
 */
function meanRevertingSeries(
  n: number,
  mean = 1.0,
  phi = -0.5,
  seed = 1
): number[] {
  const rand = mulberry32(seed);
  const prices: number[] = [mean];
  for (let i = 1; i < n; i++) {
    const noise = (rand() - 0.5) * 0.1;
    prices.push(mean + phi * (prices[i - 1] - mean) + noise);
  }
  return prices;
}

/**
 * White noise (i.i.d.): price[t] = mean + noise, independent each tick.
 * No autocorrelation → no selection bias.
 */
function whiteNoiseSeries(n: number, mean = 1.0, seed = 1): number[] {
  const rand = mulberry32(seed);
  const prices: number[] = [mean];
  for (let i = 1; i < n; i++) {
    const noise = (rand() - 0.5) * 0.1;
    prices.push(mean + noise);
  }
  return prices;
}

/** Trending series: price[t+1] = price[t] + drift + noise */
function trendingSeries(
  n: number,
  start = 1.0,
  drift = 0.005,
  seed = 1
): number[] {
  const rand = mulberry32(seed);
  const prices: number[] = [start];
  for (let i = 1; i < n; i++) {
    const noise = (rand() - 0.5) * 0.05;
    prices.push(prices[i - 1] + drift + noise);
  }
  return prices;
}

// ── Sampling strategies ──────────────────────────────────────────────────────

/**
 * Random sampling: pick `samples` random t in [1, n-2] (with replacement),
 * measure fraction where prices[t+1] >= bar.
 * This estimates the unconditional P(stay).
 */
function pStayRandom(
  prices: number[],
  bar: number,
  samples: number,
  seed: number
): number {
  const rand = mulberry32(seed);
  const n = prices.length;
  let hits = 0;
  for (let i = 0; i < samples; i++) {
    // t in [1, n-2] so that t+1 always exists
    const t = 1 + Math.floor(rand() * (n - 2));
    if (prices[t + 1] >= bar) hits++;
  }
  return hits / samples;
}

/**
 * Conditional sampling: find ALL t where the alert just fired
 *   prices[t-1] < bar  (was below)
 *   prices[t]   >= bar (now at/above — alert fires)
 * then measure fraction where prices[t+1] >= bar (stays at/above).
 *
 * Returns 0 if there are no fire events (graceful fallback).
 * This estimates P(stay | just fired).
 */
function pStayConditional(prices: number[], bar: number): number {
  const n = prices.length;
  let fires = 0;
  let stays = 0;
  // t must have a prior tick (t >= 1) and a next tick (t <= n-2)
  for (let t = 1; t < n - 1; t++) {
    if (prices[t - 1] < bar && prices[t] >= bar) {
      fires++;
      if (prices[t + 1] >= bar) stays++;
    }
  }
  if (fires === 0) return 0;
  return stays / fires;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("selection bias — same oracle, two sampling strategies", () => {
  it("on mean-reverting series: P(stay | just fired) is significantly lower than P(stay)", () => {
    // phi=-0.5: strong oscillating reversion — after crossing up, next tick reverts
    const prices = meanRevertingSeries(2000, 1.0, -0.5, 42);
    const bar = 1.0;
    const pRandom = pStayRandom(prices, bar, 500, 7);
    const pCond = pStayConditional(prices, bar);
    const bias = pRandom - pCond;
    // Mean reversion: after crossing up, next tick overshoots back down
    // → P(stay|fired) << P(stay); gap is the selection bias magnitude
    expect(bias).toBeGreaterThan(0.1);
  });

  it("on white-noise series: P(stay | just fired) ≈ P(stay) (no selection bias)", () => {
    // i.i.d. series: conditioning on just-fired gives no extra information
    const prices = whiteNoiseSeries(2000, 1.0, 42);
    const bar = 1.0;
    const pRandom = pStayRandom(prices, bar, 500, 7);
    const pCond = pStayConditional(prices, bar);
    // No autocorrelation → gap should be small
    expect(Math.abs(pRandom - pCond)).toBeLessThan(0.1);
  });

  it("on strongly trending series: P(stay | just fired) >= P(stay) (bias reverses)", () => {
    const prices = trendingSeries(2000, 1.0, 0.005, 42);
    const bar = 1.5; // intermediate level along the trend
    const pRandom = pStayRandom(prices, bar, 500, 7);
    const pCond = pStayConditional(prices, bar);
    // On strong uptrend, "just fired upward" tends to continue
    // Allow a small tolerance in case the effect is modest
    expect(pCond).toBeGreaterThanOrEqual(pRandom - 0.05);
  });

  it("documents the connection to recordOutcome (next-1-tick vs K-tick choice)", () => {
    // The conditional P is exactly what next-1-tick recordOutcome reports as
    // "hit rate" — and it is biased low on mean-reverting series.
    // K-tick averaging shifts the oracle definition; the bias is partially
    // averaged out by smoothing across multiple ticks. Both are documented
    // mitigations for the underlying selection bias.
    const prices = meanRevertingSeries(1000, 1.0, -0.3, 42);
    const bar = 1.0;
    const pRandom = pStayRandom(prices, bar, 500, 7);
    const pCond = pStayConditional(prices, bar);
    // The conditional P (what next-1-tick measures) is biased below the true P
    expect(pCond).toBeLessThan(pRandom);
  });

  it("bias magnitude scales with mean reversion strength (|phi|)", () => {
    // Larger |phi| = stronger oscillating reversion = bigger bias
    // phi=-0.7 (strong oscillation) vs phi=-0.1 (weak oscillation)
    const strong = meanRevertingSeries(2000, 1.0, -0.7, 42);
    const weak = meanRevertingSeries(2000, 1.0, -0.1, 42);
    const bar = 1.0;
    const biasStrong =
      pStayRandom(strong, bar, 500, 7) - pStayConditional(strong, bar);
    const biasWeak =
      pStayRandom(weak, bar, 500, 7) - pStayConditional(weak, bar);
    // Stronger oscillating reversion → larger selection bias
    expect(biasStrong).toBeGreaterThan(biasWeak);
  });

  it("bias disappears when bar is far above all prices (no firings → conditional P = 0)", () => {
    const prices = meanRevertingSeries(500, 1.0, -0.3, 42);
    const bar = 100.0; // never fires
    const pCond = pStayConditional(prices, bar);
    // No fire events → helper returns 0 gracefully, no crash
    expect(Number.isFinite(pCond) || pCond === 0).toBe(true);
    expect(pCond).toBe(0);
  });

  it("fire-event count is non-trivial on mean-reverting series (sanity check)", () => {
    // Verify the conditional sampler finds enough fire events to be statistically
    // meaningful — otherwise the bias test could be vacuous.
    const prices = meanRevertingSeries(2000, 1.0, -0.5, 42);
    const bar = 1.0;
    let fires = 0;
    for (let t = 1; t < prices.length - 1; t++) {
      if (prices[t - 1] < bar && prices[t] >= bar) fires++;
    }
    // With n=2000 and strong oscillating reversion around bar=mean, expect many crossings
    expect(fires).toBeGreaterThan(50);
  });
});
