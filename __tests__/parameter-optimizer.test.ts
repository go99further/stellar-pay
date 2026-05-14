import { describe, it, expect } from "vitest";
import {
  monteCarloSearch,
  gridSearch,
  walkForwardOptimize,
  mulberry32,
  formatDistribution,
  type ParamSpace,
  type SimulateFn,
} from "../lib/agent/parameter-optimizer";

// ── Toy simulator: "alert fires if price > threshold" ──────────────────────
//
// On a synthetic data series we know the answer: the optimal threshold for a
// monotonically rising series should sit near the median of the price range.
// If the optimizer can recover something in that ballpark, the framework
// works.

interface ToyParams extends Record<string, number> {
  threshold: number;
  delta: number; // unused but checks that multi-key search works
}

function makeRisingSeries(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1.0 + i * 0.01);
  return out;
}

function makeNoisySeries(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1.0 + i * 0.01 + (rng() - 0.5) * 0.05);
  return out;
}

const toySimulate: SimulateFn<ToyParams> = (window, params) => {
  // alert fires when price >= threshold; "hit" if price keeps rising 1 step
  // later, otherwise "miss". Triggers below threshold but in last 5% of range
  // count as false alarms (proxy for noise sensitivity).
  let hits = 0,
    misses = 0,
    falseAlarms = 0;
  for (let i = 0; i < window.length - 1; i++) {
    const p = window[i];
    const next = window[i + 1];
    const fired = p >= params.threshold;
    if (fired) {
      if (next >= p) hits++;
      else misses++;
    } else if (p >= params.threshold * 0.95) {
      // near-miss noise: penalize too-low thresholds
      if (next < p) falseAlarms++;
    }
  }
  return { hits, misses, falseAlarms };
};

describe("parameter-optimizer", () => {
  describe("mulberry32 — determinism", () => {
    it("produces the same sequence for the same seed", () => {
      const a = mulberry32(42);
      const b = mulberry32(42);
      for (let i = 0; i < 20; i++) {
        expect(a()).toBe(b());
      }
    });

    it("produces different sequences for different seeds", () => {
      const a = mulberry32(1)();
      const b = mulberry32(2)();
      expect(a).not.toBe(b);
    });
  });

  describe("monteCarloSearch", () => {
    const space: ParamSpace<ToyParams> = {
      threshold: { min: 1.0, max: 2.0 },
      delta: { min: 0.01, max: 0.1 },
    };

    it("returns reproducible recommendation for the same seed", () => {
      const data = makeRisingSeries(60);
      const a = monteCarloSearch(data, space, toySimulate, {
        iterations: 200,
        seed: 7,
        windowSize: 20,
      });
      const b = monteCarloSearch(data, space, toySimulate, {
        iterations: 200,
        seed: 7,
        windowSize: 20,
      });
      expect(a.recommended).toEqual(b.recommended);
      expect(a.confidenceInterval).toEqual(b.confidenceInterval);
    });

    it("recommendation falls inside its own confidence interval", () => {
      const data = makeNoisySeries(80, 5);
      const dist = monteCarloSearch(data, space, toySimulate, {
        iterations: 500,
        seed: 11,
        windowSize: 30,
      });
      for (const k of Object.keys(dist.recommended) as (keyof ToyParams)[]) {
        expect(dist.recommended[k]).toBeGreaterThanOrEqual(
          dist.confidenceInterval.p25[k] - 1e-9
        );
        expect(dist.recommended[k]).toBeLessThanOrEqual(
          dist.confidenceInterval.p75[k] + 1e-9
        );
      }
    });

    it("recovers a planted optimum within the explored range", () => {
      // Series rises from ~1.0 to ~1.6; the simulator rewards thresholds
      // that fire mid-series (more upward steps follow) and penalizes ones
      // near the end (most steps already happened).
      const data = makeRisingSeries(60);
      const dist = monteCarloSearch(data, space, toySimulate, {
        iterations: 1000,
        seed: 3,
        windowSize: 30,
      });
      // Optimum should lie below the upper bound — anything > 1.5 fires
      // rarely on this series and earns a low score.
      expect(dist.recommended.threshold).toBeLessThan(1.5);
      expect(dist.topCandidates.length).toBeGreaterThan(10);
    });

    it("survives data shorter than the window size", () => {
      const data = [1.1, 1.2, 1.3];
      const dist = monteCarloSearch(data, space, toySimulate, {
        iterations: 50,
        seed: 1,
        windowSize: 50,
      });
      expect(dist.sampleCount).toBe(50);
    });
  });

  describe("gridSearch", () => {
    it("explores every grid cell deterministically", () => {
      const space: ParamSpace<ToyParams> = {
        threshold: { min: 1.0, max: 2.0, steps: 4 },
        delta: { min: 0.01, max: 0.1, steps: 3 },
      };
      const data = makeRisingSeries(50);
      const dist = gridSearch(data, space, toySimulate, { seed: 1, windowSize: 20 });
      expect(dist.sampleCount).toBe(4 * 3);
    });

    it("is fully reproducible without a seed (grid is deterministic)", () => {
      const space: ParamSpace<ToyParams> = {
        threshold: { min: 1.0, max: 2.0, steps: 4 },
        delta: { min: 0.01, max: 0.1, steps: 3 },
      };
      const data = makeRisingSeries(50);
      const a = gridSearch(data, space, toySimulate, { windowSize: 20 });
      const b = gridSearch(data, space, toySimulate, { windowSize: 20 });
      expect(a.recommended).toEqual(b.recommended);
    });
  });

  describe("walkForwardOptimize", () => {
    const space: ParamSpace<ToyParams> = {
      threshold: { min: 1.0, max: 2.0 },
      delta: { min: 0.01, max: 0.1 },
    };

    it("flags insufficient data for fewer than 10 points", () => {
      const report = walkForwardOptimize([1.0, 1.1, 1.2], space, toySimulate);
      expect(report.message).toContain("数据点不足");
      expect(report.overfitFlag).toBe(false);
    });

    it("returns scores for all three windows on a healthy series", () => {
      const data = makeNoisySeries(100, 9);
      const report = walkForwardOptimize(data, space, toySimulate, monteCarloSearch, {
        iterations: 200,
        seed: 13,
        windowSize: 20,
      });
      expect(report.trainScore).toBeTypeOf("number");
      expect(report.validationScore).toBeTypeOf("number");
      expect(report.testScore).toBeTypeOf("number");
      expect(report.message).toMatch(/Walk-forward|过拟合/);
    });

    it("does not leak — train score is measured only on first 60% of data", () => {
      // Construct a series where first 60% is monotone up and last 40% is
      // monotone down. Threshold optimal on training would over-fire on test.
      const series: number[] = [];
      for (let i = 0; i < 60; i++) series.push(1.0 + i * 0.01);
      for (let i = 0; i < 40; i++) series.push(1.6 - i * 0.02);

      const report = walkForwardOptimize(series, space, toySimulate, monteCarloSearch, {
        iterations: 400,
        seed: 17,
        windowSize: 20,
      });
      // Test score may be lower than train; we just want to confirm the
      // function actually evaluates them separately rather than reusing one.
      expect(report.trainScore).not.toBe(report.testScore);
    });
  });

  describe("formatDistribution", () => {
    it("renders median and IQR per parameter", () => {
      const dist = monteCarloSearch(
        makeRisingSeries(50),
        {
          threshold: { min: 1.0, max: 2.0 },
          delta: { min: 0.01, max: 0.1 },
        } as ParamSpace<ToyParams>,
        toySimulate,
        { iterations: 100, seed: 21, windowSize: 20 }
      );
      const text = formatDistribution(dist);
      expect(text).toContain("threshold");
      expect(text).toContain("delta");
      expect(text).toMatch(/\[\d+\.\d+ – \d+\.\d+\]/);
    });
  });
});
