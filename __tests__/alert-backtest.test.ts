import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractPriceHistory,
  backtestAlerts,
  generateBacktestReport,
} from "../lib/agent/alert-backtest";
import { saveTransaction, clearHistory } from "../lib/agent/transaction-history";
import type { PriceAlert } from "../lib/agent/price-alerts";

function makeSwap(amountIn: number, amountOut: number, tokenIn: string, ts: number) {
  saveTransaction({
    type: "swap",
    details: { amountIn, amountOut, tokenIn },
    txHash: `h${ts}`,
    status: "success",
  });
  // Manually set timestamp by reading and re-saving with correct timestamp
}

// Helper: save a swap with a specific timestamp by directly writing to localStorage
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

function saveLiquidityAt(amountA: number, amountB: number, type: "add_liquidity" | "remove_liquidity", ts: number) {
  const key = "stellar-pay-transaction-history";
  const raw = localStorage.getItem(key);
  const history = raw ? JSON.parse(raw) : [];
  history.unshift({
    id: `${ts}-liq`,
    type,
    timestamp: ts,
    details: { amountA, amountB },
    txHash: `liq${ts}`,
    status: "success",
  });
  localStorage.setItem(key, JSON.stringify(history));
}

describe("alert-backtest", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("extractPriceHistory", () => {
    it("should return empty array when no history", () => {
      expect(extractPriceHistory()).toHaveLength(0);
    });

    it("should extract price from TKNA→TKNB swap (price = amountOut/amountIn)", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      const points = extractPriceHistory();
      expect(points).toHaveLength(1);
      expect(points[0].price).toBeCloseTo(2.0);
    });

    it("should extract price from TKNB→TKNA swap (price = amountIn/amountOut)", () => {
      saveSwapAt(200, 100, "TKNB", 1000);
      const points = extractPriceHistory();
      expect(points).toHaveLength(1);
      expect(points[0].price).toBeCloseTo(2.0);
    });

    it("should extract price from add_liquidity (price = amountB/amountA)", () => {
      saveLiquidityAt(100, 150, "add_liquidity", 1000);
      const points = extractPriceHistory();
      expect(points).toHaveLength(1);
      expect(points[0].price).toBeCloseTo(1.5);
    });

    it("should extract price from remove_liquidity", () => {
      saveLiquidityAt(200, 300, "remove_liquidity", 1000);
      const points = extractPriceHistory();
      expect(points).toHaveLength(1);
      expect(points[0].price).toBeCloseTo(1.5);
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
      expect(extractPriceHistory()).toHaveLength(0);
    });

    it("should skip transactions with missing amounts", () => {
      const key = "stellar-pay-transaction-history";
      localStorage.setItem(key, JSON.stringify([{
        id: "1",
        type: "swap",
        timestamp: 1000,
        details: { tokenIn: "TKNA" }, // no amountIn/amountOut
        txHash: "h1",
        status: "success",
      }]));
      expect(extractPriceHistory()).toHaveLength(0);
    });

    it("should sort price points by timestamp ascending", () => {
      saveSwapAt(100, 200, "TKNA", 3000);
      saveSwapAt(100, 100, "TKNA", 1000);
      saveSwapAt(100, 150, "TKNA", 2000);
      const points = extractPriceHistory();
      expect(points[0].timestamp).toBe(1000);
      expect(points[1].timestamp).toBe(2000);
      expect(points[2].timestamp).toBe(3000);
    });

    it("should include txHash and type in price points", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      const points = extractPriceHistory();
      expect(points[0].txHash).toBe("h1000");
      expect(points[0].type).toBe("swap");
    });
  });

  describe("backtestAlerts", () => {
    it("should return zero stats when no price history", () => {
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.5,
        condition: "above",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.totalAlerts).toBe(1);
      expect(result.triggeredAlerts).toBe(0);
      expect(result.pricePoints).toHaveLength(0);
    });

    it("should return zero stats when only one price point", () => {
      saveSwapAt(100, 150, "TKNA", 1000);
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.0,
        condition: "above",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.triggeredAlerts).toBe(0);
    });

    it("should trigger alert when price crosses above target", () => {
      // price = 2.0 (above target 1.5)
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      saveSwapAt(100, 220, "TKNA", 3000);
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.5,
        condition: "above",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.triggeredAlerts).toBeGreaterThan(0);
    });

    it("should trigger alert when price crosses below target", () => {
      // price = 0.5 (below target 1.0)
      saveSwapAt(100, 50, "TKNA", 1000);
      saveSwapAt(100, 45, "TKNA", 2000);
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.0,
        condition: "below",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.triggeredAlerts).toBeGreaterThan(0);
    });

    it("should not trigger already-triggered alerts", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.5,
        condition: "above",
        triggered: true, // already triggered
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.triggeredAlerts).toBe(0);
    });

    it("should count accurate vs false alerts", () => {
      // Rising prices: 1.0, 1.5, 2.0, 2.5, 3.0, 3.5
      for (let i = 1; i <= 6; i++) {
        saveSwapAt(100, 100 * (i * 0.5), "TKNA", i * 1000);
      }
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 0.8,
        condition: "above",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      expect(result.accurateAlerts + result.falseAlerts).toBe(result.triggeredAlerts);
    });

    it("should return pricePoints in result", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      const result = backtestAlerts([]);
      expect(result.pricePoints).toHaveLength(2);
    });

    it("should handle empty alerts array", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      const result = backtestAlerts([]);
      expect(result.totalAlerts).toBe(0);
      expect(result.triggeredAlerts).toBe(0);
    });
  });

  describe("generateBacktestReport", () => {
    it("should return a non-empty string", () => {
      const result = backtestAlerts([]);
      const report = generateBacktestReport(result);
      expect(typeof report).toBe("string");
      expect(report.length).toBeGreaterThan(0);
    });

    it("should include alert statistics in report", () => {
      saveSwapAt(100, 200, "TKNA", 1000);
      saveSwapAt(100, 210, "TKNA", 2000);
      const alert: PriceAlert = {
        id: "a1",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.5,
        condition: "above",
        triggered: false,
        createdAt: Date.now(),
      };
      const result = backtestAlerts([alert]);
      const report = generateBacktestReport(result);
      expect(report).toContain("警报统计");
      expect(report).toContain("收益模拟");
    });

    it("should warn when no alerts triggered", () => {
      const result = backtestAlerts([]);
      const report = generateBacktestReport(result);
      expect(report).toContain("⚠️");
    });
  });
});
