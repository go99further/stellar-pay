/**
 * Regression tests for the "false confidence" fix in alert-backtest-v2.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { backtestAlertsV2 } from "@/lib/agent/alert-backtest-v2";
import { clearHistory } from "@/lib/agent/transaction-history";
import type { PriceAlert } from "@/lib/agent/price-alerts";

function saveMockSwap(timestamp: number, price: number, id: string) {
  const KEY = "stellar-pay-transaction-history";
  const existing = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  existing.unshift({
    id,
    type: "swap",
    timestamp,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: (price * 100).toString(),
    },
    txHash: `mock_${id}`,
    status: "success",
  });
  localStorage.setItem(KEY, JSON.stringify(existing));
}

describe("alert-backtest-v2: stability fix (刺③ regression guard)", () => {
  beforeEach(() => {
    clearHistory();
  });

  it("refuses to report stability when triggers are insufficient", () => {
    const baseTime = Date.now() - 1000 * 60 * 60 * 24;
    for (let i = 0; i < 10; i++) {
      saveMockSwap(baseTime + i * 60_000, 1.0, `s${i}`);
    }

    const neverTriggerAlert: PriceAlert = {
      id: "never",
      tokenPair: "TKNA/TKNB",
      targetPrice: 999,
      condition: "above",
      triggered: false,
      createdAt: baseTime,
    };

    const result = backtestAlertsV2([neverTriggerAlert]);

    expect(result.stability.thresholdSensitivity).toBe(1);
    expect(result.stability.recommendation).toMatch(/数据不足|无法评估/);
    expect(result.stability.recommendation).not.toMatch(/✅/);
  });

  it("reports stability normally when triggers are sufficient", () => {
    const baseTime = Date.now() - 1000 * 60 * 60 * 24;
    // Need 60 points so validation window (20% = 12 points) has ~6 triggers,
    // which exceeds MIN_TRIGGERS(3). Prices alternate 1.0/1.2; alert at 1.15
    // triggers on every 1.2 point.
    const prices = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 1.0 : 1.2));
    prices.forEach((p, i) => saveMockSwap(baseTime + i * 60_000, p, `s${i}`));

    const breakoutAlert: PriceAlert = {
      id: "breakout",
      tokenPair: "TKNA/TKNB",
      targetPrice: 1.15,
      condition: "above",
      triggered: false,
      createdAt: baseTime,
    };

    const result = backtestAlertsV2([breakoutAlert]);

    // Should enter the normal branch (0.2 / 0.5 / 0.8), not the
    // "insufficient data" sentinel (1).
    expect(result.stability.thresholdSensitivity).not.toBe(1);
    expect([0.2, 0.5, 0.8]).toContain(result.stability.thresholdSensitivity);
  });
});
