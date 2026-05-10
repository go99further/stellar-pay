import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractPriceHistoryV2,
  backtestAlertsV2,
  generateBacktestReportV2,
} from "../lib/agent/alert-backtest-v2";
import type { PriceAlert } from "../lib/agent/price-alerts";

function saveSwapAt(amountIn: number, amountOut: number, tokenIn: string, ts: number) {
  const key = "stellar-pay-transaction-history";
  const raw = localStorage.getItem(key);
  const history = raw ? JSON.parse(raw) : [];
  history.unshift({
    id: `${ts}-test`,
    type: "swap",
    timestamp: ts,
    details: { amountIn, amountOut, tokenIn },
    txHash: `h${ts}`,
    status: "success",
  });
  localStorage.setItem(key, JSON.stringify(history));
}

function makeAlert(id: string, targetPrice: number, condition: "above" | "below"): PriceAlert {
  return {
    id,
    tokenPair: "TKNA/TKNB",
    targetPrice,
    condition,
    triggered: false,
    createdAt: Date.now(),
  };
}

// Seed N price points with rising prices starting at ts=1000, step=1000
function seedPricePoints(n: number, basePrice = 1.0, step = 0.1) {
  for (let i = 0; i < n; i++) {
    const price = basePrice + i * step;
    saveSwapAt(100, 100 * price, "TKNA", (i + 1) * 1000);
  }
}

describe("alert-backtest-v2", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("extractPriceHistoryV2", () => {
    it("should return empty array when no history", () => {
      expect(extractPriceHistoryV2()).toHaveLength(0);
    });

    it("should extract price from TKNA→TKNB swap", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      const points = extractPriceHistoryV2();
      expect(points).toHaveLength(1);
      expect(points[0].price).toBeCloseTo(2.0);
    });

    it("should sort by timestamp ascending", () => {
      saveSwapAt(100, 300, "TKNA", 3000);
      saveSwapAt(100, 100, "TKNA", 1000);
      saveSwapAt(100, 200, "TKNA", 2000);
      const points = extractPriceHistoryV2();
      expect(points[0].timestamp).toBe(1000);
      expect(points[2].timestamp).toBe(3000);
    });

    it("should compute volatility for points after the first", () => {
      saveSwapAt(100, 100, "TKNA", 1000); // price 1.0
      saveSwapAt(100, 110, "TKNA", 2000); // price 1.1 → volatility = 0.1
      const points = extractPriceHistoryV2();
      expect(points[0].volatility).toBeUndefined();
      expect(points[1].volatility).toBeCloseTo(0.1);
    });

    it("should skip failed transactions", () => {
      const key = "stellar-pay-transaction-history";
      localStorage.setItem(key, JSON.stringify([{
        id: "1",
        type: "swap",
        timestamp: 1000,
        details: { amountIn: 100, amountOut: 200, tokenIn: "TKNA" },
        txHash: "h1",
        status: "failed",
      }]));
      expect(extractPriceHistoryV2()).toHaveLength(0);
    });
  });

  describe("backtestAlertsV2 — empty / insufficient data", () => {
    it("should return empty result when no price history", () => {
      const result = backtestAlertsV2([makeAlert("a1", 1.5, "above")]);
      expect(result.totalAlerts).toBe(1);
      expect(result.triggeredAlerts).toBe(0);
      expect(result.pricePoints).toHaveLength(0);
    });

    it("should return empty result when only one price point", () => {
      saveSwapAt(100, 150, "TKNA", 1000);
      const result = backtestAlertsV2([makeAlert("a1", 1.0, "above")]);
      expect(result.triggeredAlerts).toBe(0);
    });

    it("should set confidence=low when insufficient data", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      const result = backtestAlertsV2([makeAlert("a1", 1.5, "above")]);
      expect(result.profitSimulation.confidence).toBe("low");
    });
  });

  describe("backtestAlertsV2 — time window splitting", () => {
    it("should split into train/validation/test windows with enough data", () => {
      seedPricePoints(15);
      const result = backtestAlertsV2([]);
      expect(result.windows.train.points.length).toBeGreaterThan(0);
      expect(result.windows.validation.points.length).toBeGreaterThan(0);
      expect(result.windows.test.points.length).toBeGreaterThan(0);
    });

    it("should put all data in train when fewer than 10 points", () => {
      seedPricePoints(5);
      const result = backtestAlertsV2([]);
      expect(result.windows.train.points.length).toBe(5);
      expect(result.windows.validation.points.length).toBe(0);
      expect(result.windows.test.points.length).toBe(0);
    });

    it("should have non-overlapping windows (train ends before validation starts)", () => {
      seedPricePoints(20);
      const result = backtestAlertsV2([]);
      const trainEnd = result.windows.train.endTime;
      const validStart = result.windows.validation.startTime;
      if (trainEnd > 0 && validStart > 0) {
        expect(validStart).toBeGreaterThanOrEqual(trainEnd);
      }
    });
  });

  describe("backtestAlertsV2 — alert triggering", () => {
    it("should trigger alert when price crosses above target in validation set", () => {
      // 20 points: prices 1.0, 1.1, ..., 2.9
      // validation set is points 12-16 (prices ~2.2-2.6)
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(result.triggeredAlerts).toBeGreaterThan(0);
    });

    it("should not trigger already-triggered alerts", () => {
      seedPricePoints(20, 1.0, 0.1);
      const alert = makeAlert("a1", 0.5, "above");
      alert.triggered = true;
      const result = backtestAlertsV2([alert]);
      expect(result.triggeredAlerts).toBe(0);
    });

    it("should include nextPrice in triggered points", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      if (result.triggeredPoints.length > 0) {
        expect(result.triggeredPoints[0].nextPrice).toBeGreaterThan(0);
      }
    });

    it("should count accurate vs false alerts", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(result.accurateAlerts + result.falseAlerts).toBe(result.triggeredAlerts);
    });
  });

  describe("backtestAlertsV2 — bias check", () => {
    it("should report no forward-looking bias", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(result.biasCheck.hasFutureLeak).toBe(false);
      expect(result.biasCheck.message).toContain("✅");
    });
  });

  describe("backtestAlertsV2 — stability analysis", () => {
    it("should return stability with recommendation", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(typeof result.stability.recommendation).toBe("string");
      expect(result.stability.recommendation.length).toBeGreaterThan(0);
    });

    it("should warn about insufficient data when triggers are too few", () => {
      // Only 5 points → all go to train, validation is empty → insufficient triggers
      seedPricePoints(5, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(result.stability.thresholdSensitivity).toBe(1);
      expect(result.stability.recommendation).toContain("⚠️");
    });
  });

  describe("backtestAlertsV2 — stress test", () => {
    it("should include stress test results", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      expect(typeof result.stressTest.normalAccuracy).toBe("number");
      expect(typeof result.stressTest.volatileAccuracy).toBe("number");
      expect(typeof result.stressTest.degradation).toBe("number");
    });
  });

  describe("generateBacktestReportV2", () => {
    it("should return a non-empty string", () => {
      const result = backtestAlertsV2([]);
      const report = generateBacktestReportV2(result);
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
    });

    it("should include all major sections", () => {
      seedPricePoints(20, 1.0, 0.1);
      const result = backtestAlertsV2([makeAlert("a1", 0.5, "above")]);
      const report = generateBacktestReportV2(result);
      expect(report).toContain("数据窗口");
      expect(report).toContain("警报统计");
      expect(report).toContain("稳定性分析");
      expect(report).toContain("压力测试");
      expect(report).toContain("收益模拟");
      expect(report).toContain("前瞻偏差检查");
    });

    it("should warn when no alerts triggered", () => {
      seedPricePoints(20, 1.0, 0.1);
      // target price 999 will never trigger
      const result = backtestAlertsV2([makeAlert("a1", 999, "above")]);
      const report = generateBacktestReportV2(result);
      expect(report).toContain("⚠️");
    });
  });
});
