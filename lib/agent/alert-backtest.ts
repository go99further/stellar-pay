/**
 * Alert Backtest Engine
 * 用历史交易数据验证价格警报的准确性
 */

import { getTransactionHistory, type TransactionRecord } from "./transaction-history";
import type { PriceAlert } from "./price-alerts";

export interface PricePoint {
  timestamp: number;
  price: number; // TKNA/TKNB
  txHash: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
}

export interface BacktestResult {
  totalAlerts: number;
  triggeredAlerts: number;
  accurateAlerts: number; // 触发后价格确实朝预期方向变化
  falseAlerts: number; // 触发后价格反向变化
  avgDelayMs: number; // 平均延迟（从触发到最佳交易点）
  profitSimulation: {
    withAlert: number; // 按警报交易的收益（%）
    withoutAlert: number; // 不设警报的收益（%）
    improvement: number; // 改进幅度（%）
  };
  pricePoints: PricePoint[];
  triggeredPoints: Array<{
    timestamp: number;
    price: number;
    alert: PriceAlert;
    accurate: boolean;
  }>;
}

/**
 * 从交易历史提取价格序列
 */
export function extractPriceHistory(): PricePoint[] {
  const history = getTransactionHistory();
  const pricePoints: PricePoint[] = [];

  for (const tx of history) {
    if (tx.status !== "success") continue;

    const price = extractPrice(tx);
    if (price === null) continue;

    pricePoints.push({
      timestamp: tx.timestamp,
      price,
      txHash: tx.txHash,
      type: tx.type,
    });
  }

  // 按时间排序（最早的在前）
  return pricePoints.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 从交易记录提取价格（TKNA/TKNB）
 */
function extractPrice(tx: TransactionRecord): number | null {
  const details = tx.details;

  if (tx.type === "swap") {
    // Swap: price = amountOut / amountIn
    const amountIn = parseAmount(details.amountIn);
    const amountOut = parseAmount(details.amountOut);
    const tokenIn = details.tokenIn as string | undefined;

    if (amountIn === null || amountOut === null) return null;

    // 如果是 TKNA → TKNB，价格 = amountOut / amountIn
    // 如果是 TKNB → TKNA，价格 = amountIn / amountOut
    if (tokenIn?.includes("TKNA") || tokenIn?.includes("TOKEN_A")) {
      return amountOut / amountIn;
    } else {
      return amountIn / amountOut;
    }
  }

  if (tx.type === "add_liquidity" || tx.type === "remove_liquidity") {
    // Liquidity: price = amountB / amountA
    const amountA = parseAmount(details.amountA);
    const amountB = parseAmount(details.amountB);

    if (amountA === null || amountB === null) return null;
    return amountB / amountA;
  }

  return null;
}

/**
 * 解析金额（支持 bigint 字符串和数字）
 */
function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

/**
 * 回测价格警报
 */
export function backtestAlerts(alerts: PriceAlert[]): BacktestResult {
  const pricePoints = extractPriceHistory();

  if (pricePoints.length < 2) {
    return {
      totalAlerts: alerts.length,
      triggeredAlerts: 0,
      accurateAlerts: 0,
      falseAlerts: 0,
      avgDelayMs: 0,
      profitSimulation: { withAlert: 0, withoutAlert: 0, improvement: 0 },
      pricePoints,
      triggeredPoints: [],
    };
  }

  const triggeredPoints: BacktestResult["triggeredPoints"] = [];
  let totalDelayMs = 0;

  // 遍历价格序列，检查警报触发
  for (let i = 0; i < pricePoints.length; i++) {
    const point = pricePoints[i];

    for (const alert of alerts) {
      if (alert.triggered) continue; // 已触发的警报跳过

      const shouldTrigger = checkAlertTrigger(alert, point.price);
      if (!shouldTrigger) continue;

      // 警报触发，检查后续价格变化
      const nextPoints = pricePoints.slice(i + 1, i + 6); // 看后续 5 个点
      const accurate = isAlertAccurate(alert, point.price, nextPoints);

      // 计算延迟（从触发到最佳交易点）
      const bestPoint = findBestTradingPoint(alert, nextPoints);
      const delayMs = bestPoint ? bestPoint.timestamp - point.timestamp : 0;

      triggeredPoints.push({
        timestamp: point.timestamp,
        price: point.price,
        alert,
        accurate,
      });

      totalDelayMs += delayMs;
    }
  }

  const triggeredAlerts = triggeredPoints.length;
  const accurateAlerts = triggeredPoints.filter((p) => p.accurate).length;
  const falseAlerts = triggeredAlerts - accurateAlerts;
  const avgDelayMs = triggeredAlerts > 0 ? totalDelayMs / triggeredAlerts : 0;

  // 收益模拟
  const profitSimulation = simulateProfit(pricePoints, triggeredPoints);

  return {
    totalAlerts: alerts.length,
    triggeredAlerts,
    accurateAlerts,
    falseAlerts,
    avgDelayMs,
    profitSimulation,
    pricePoints,
    triggeredPoints,
  };
}

/**
 * 检查警报是否应该触发
 */
function checkAlertTrigger(alert: PriceAlert, currentPrice: number): boolean {
  if (alert.condition === "above") {
    return currentPrice >= alert.targetPrice;
  } else {
    return currentPrice <= alert.targetPrice;
  }
}

/**
 * 检查警报是否准确（触发后价格朝预期方向变化）
 */
function isAlertAccurate(
  alert: PriceAlert,
  triggerPrice: number,
  nextPoints: PricePoint[]
): boolean {
  if (nextPoints.length === 0) return false;

  // 计算后续价格的平均变化
  const avgNextPrice =
    nextPoints.reduce((sum, p) => sum + p.price, 0) / nextPoints.length;

  if (alert.condition === "above") {
    // "价格突破 X" → 期望后续价格继续上涨
    return avgNextPrice > triggerPrice;
  } else {
    // "价格跌破 X" → 期望后续价格继续下跌
    return avgNextPrice < triggerPrice;
  }
}

/**
 * 找到最佳交易点（警报触发后的最优价格点）
 */
function findBestTradingPoint(
  alert: PriceAlert,
  nextPoints: PricePoint[]
): PricePoint | null {
  if (nextPoints.length === 0) return null;

  if (alert.condition === "above") {
    // 找最高价
    return nextPoints.reduce((best, p) => (p.price > best.price ? p : best));
  } else {
    // 找最低价
    return nextPoints.reduce((best, p) => (p.price < best.price ? p : best));
  }
}

/**
 * 模拟收益（按警报交易 vs 不设警报）
 */
function simulateProfit(
  pricePoints: PricePoint[],
  triggeredPoints: BacktestResult["triggeredPoints"]
): BacktestResult["profitSimulation"] {
  if (pricePoints.length < 2 || triggeredPoints.length === 0) {
    return { withAlert: 0, withoutAlert: 0, improvement: 0 };
  }

  const firstPrice = pricePoints[0].price;
  const lastPrice = pricePoints[pricePoints.length - 1].price;

  // 不设警报：买入并持有
  const withoutAlert = ((lastPrice - firstPrice) / firstPrice) * 100;

  // 设警报：在触发点交易
  let withAlert = 0;
  for (const triggered of triggeredPoints) {
    if (!triggered.accurate) continue;

    // 简化模型：在触发点买入/卖出
    if (triggered.alert.condition === "above") {
      // 价格突破 → 买入 → 假设后续上涨 5%
      withAlert += 5;
    } else {
      // 价格跌破 → 卖出 → 避免后续下跌 5%
      withAlert += 5;
    }
  }

  const improvement = withAlert - withoutAlert;

  return {
    withAlert: parseFloat(withAlert.toFixed(2)),
    withoutAlert: parseFloat(withoutAlert.toFixed(2)),
    improvement: parseFloat(improvement.toFixed(2)),
  };
}

/**
 * 生成回测报告（人类可读）
 */
export function generateBacktestReport(result: BacktestResult): string {
  const accuracyRate =
    result.triggeredAlerts > 0
      ? ((result.accurateAlerts / result.triggeredAlerts) * 100).toFixed(1)
      : "N/A";

  const avgDelaySeconds = (result.avgDelayMs / 1000).toFixed(1);

  return `
📊 警报回测报告

数据范围: ${result.pricePoints.length} 个历史价格点
时间跨度: ${formatTimeSpan(result.pricePoints)}

警报统计:
- 设置警报数: ${result.totalAlerts}
- 触发次数: ${result.triggeredAlerts}
- 准确触发: ${result.accurateAlerts} (${accuracyRate}%)
- 误报: ${result.falseAlerts}
- 平均延迟: ${avgDelaySeconds}s

收益模拟:
- 不设警报 (买入持有): ${result.profitSimulation.withoutAlert > 0 ? "+" : ""}${result.profitSimulation.withoutAlert}%
- 设置警报 (按信号交易): ${result.profitSimulation.withAlert > 0 ? "+" : ""}${result.profitSimulation.withAlert}%
- 改进幅度: ${result.profitSimulation.improvement > 0 ? "+" : ""}${result.profitSimulation.improvement}%

${result.triggeredAlerts === 0 ? "⚠️ 历史数据中未触发任何警报，建议调整警报阈值" : ""}
${result.accurateAlerts === 0 && result.triggeredAlerts > 0 ? "⚠️ 所有触发均为误报，建议重新设置警报条件" : ""}
  `.trim();
}

function formatTimeSpan(points: PricePoint[]): string {
  if (points.length < 2) return "N/A";

  const first = points[0].timestamp;
  const last = points[points.length - 1].timestamp;
  const spanMs = last - first;

  const hours = Math.floor(spanMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} 天`;
  if (hours > 0) return `${hours} 小时`;
  return `${Math.floor(spanMs / (1000 * 60))} 分钟`;
}
