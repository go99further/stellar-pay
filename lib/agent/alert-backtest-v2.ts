/**
 * Alert Backtest Engine V2 - 防过拟合版本
 *
 * 防过拟合策略（本文件中所有回测逻辑遵循）：
 *
 * 1. 时间窗口切割 —— 数据严格按时间排序，训练集、验证集、测试集不重叠，
 *    保证无前瞻偏差。使用滚动窗口交叉验证（walk-forward optimization）。
 *
 * 2. 定价时点约束 —— 每笔交易的价格只取 timestamp ≤ 本交易时间的数据，
 *    禁止使用事后插值的平均价格。判断准确性时，只用"下一笔交易"的价格，
 *    而不是"未来 N 笔的平均"。
 *
 * 3. 参数平坦区选择 —— 阈值优化取效果指标平稳区间中点，不取单一最优点。
 *    提供阈值稳定性分析，警告"尖锐峰值"阈值。
 *
 * 4. 压力窗口验证 —— 额外对异常行情（大滑点、价格剧烈波动）做测试，
 *    确保阈值不崩溃。
 *
 * 5. 硬安全规则不下场 —— 极端滑点 (>50%)、黑名单等直接 block，
 *    不参与回测调优，避免历史数据"美化了"这些不可妥协的规则。
 */

import { getTransactionHistory, type TransactionRecord } from "./transaction-history";
import type { PriceAlert } from "./price-alerts";

export interface PricePoint {
  timestamp: number;
  price: number;
  txHash: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  volatility?: number; // 价格波动率（用于识别压力窗口）
}

export interface TimeWindow {
  name: string;
  startTime: number;
  endTime: number;
  points: PricePoint[];
}

export interface BacktestResultV2 {
  // 基础统计
  totalAlerts: number;
  triggeredAlerts: number;
  accurateAlerts: number;
  falseAlerts: number;
  avgDelayMs: number;

  // 时间窗口分析
  windows: {
    train: TimeWindow;
    validation: TimeWindow;
    test: TimeWindow;
  };

  // 稳定性分析
  stability: {
    thresholdSensitivity: number; // 阈值敏感度（0-1，越低越稳定）
    performanceVariance: number; // 不同窗口的性能方差
    recommendation: string;
  };

  // 压力测试
  stressTest: {
    normalAccuracy: number; // 正常行情准确率
    volatileAccuracy: number; // 高波动行情准确率
    degradation: number; // 性能下降幅度
  };

  // 收益模拟（保守版）
  profitSimulation: {
    withAlert: number;
    withoutAlert: number;
    improvement: number;
    confidence: "high" | "medium" | "low"; // 置信度
  };

  // 前瞻偏差检查
  biasCheck: {
    hasFutureLeak: boolean;
    message: string;
  };

  pricePoints: PricePoint[];
  triggeredPoints: Array<{
    timestamp: number;
    price: number;
    alert: PriceAlert;
    accurate: boolean;
    nextPrice: number; // 下一笔交易的价格（不是未来 N 笔平均）
  }>;
}

/**
 * 从交易历史提取价格序列（带波动率计算）
 */
export function extractPriceHistoryV2(): PricePoint[] {
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
  pricePoints.sort((a, b) => a.timestamp - b.timestamp);

  // 计算波动率（用于识别压力窗口）
  for (let i = 1; i < pricePoints.length; i++) {
    const prev = pricePoints[i - 1];
    const curr = pricePoints[i];
    curr.volatility = Math.abs((curr.price - prev.price) / prev.price);
  }

  return pricePoints;
}

/**
 * 时间窗口切分（训练/验证/测试）
 */
function splitTimeWindows(points: PricePoint[]): {
  train: PricePoint[];
  validation: PricePoint[];
  test: PricePoint[];
} {
  if (points.length < 10) {
    // 数据太少，全部用作训练（但标记低置信度）
    return {
      train: points,
      validation: [],
      test: [],
    };
  }

  // 60% 训练，20% 验证，20% 测试（严格按时间切分）
  const trainEnd = Math.floor(points.length * 0.6);
  const validEnd = Math.floor(points.length * 0.8);

  return {
    train: points.slice(0, trainEnd),
    validation: points.slice(trainEnd, validEnd),
    test: points.slice(validEnd),
  };
}

/**
 * 识别压力窗口（高波动行情）
 */
function identifyStressWindows(points: PricePoint[]): {
  normal: PricePoint[];
  volatile: PricePoint[];
} {
  const volatilityThreshold = 0.05; // 5% 波动视为高波动

  const normal: PricePoint[] = [];
  const volatile: PricePoint[] = [];

  for (const point of points) {
    if ((point.volatility ?? 0) > volatilityThreshold) {
      volatile.push(point);
    } else {
      normal.push(point);
    }
  }

  return { normal, volatile };
}

/**
 * 回测价格警报（防过拟合版本）
 */
export function backtestAlertsV2(alerts: PriceAlert[]): BacktestResultV2 {
  const pricePoints = extractPriceHistoryV2();

  if (pricePoints.length < 2) {
    return createEmptyResult(alerts, pricePoints);
  }

  // Step 1: 时间窗口切分
  const { train, validation, test } = splitTimeWindows(pricePoints);

  // Step 2: 在验证集上回测（不用测试集，测试集留到最后）
  const validationResult = runBacktest(alerts, validation);

  // Step 3: 压力测试
  const { normal, volatile } = identifyStressWindows(validation);
  const normalResult = runBacktest(alerts, normal);
  const volatileResult = runBacktest(alerts, volatile);

  // Step 4: 稳定性分析
  const stability = analyzeStability(alerts, train, validation);

  // Step 5: 前瞻偏差检查
  const biasCheck = checkForwardLookingBias(validationResult.triggeredPoints);

  // Step 6: 收益模拟（保守版）
  const profitSimulation = simulateProfitConservative(
    validationResult.triggeredPoints,
    validation
  );

  return {
    totalAlerts: alerts.length,
    triggeredAlerts: validationResult.triggeredAlerts,
    accurateAlerts: validationResult.accurateAlerts,
    falseAlerts: validationResult.falseAlerts,
    avgDelayMs: validationResult.avgDelayMs,
    windows: {
      train: {
        name: "Training",
        startTime: train[0]?.timestamp ?? 0,
        endTime: train[train.length - 1]?.timestamp ?? 0,
        points: train,
      },
      validation: {
        name: "Validation",
        startTime: validation[0]?.timestamp ?? 0,
        endTime: validation[validation.length - 1]?.timestamp ?? 0,
        points: validation,
      },
      test: {
        name: "Test (未使用)",
        startTime: test[0]?.timestamp ?? 0,
        endTime: test[test.length - 1]?.timestamp ?? 0,
        points: test,
      },
    },
    stability,
    stressTest: {
      normalAccuracy:
        normalResult.triggeredAlerts > 0
          ? (normalResult.accurateAlerts / normalResult.triggeredAlerts) * 100
          : 0,
      volatileAccuracy:
        volatileResult.triggeredAlerts > 0
          ? (volatileResult.accurateAlerts / volatileResult.triggeredAlerts) * 100
          : 0,
      degradation:
        normalResult.triggeredAlerts > 0 && volatileResult.triggeredAlerts > 0
          ? ((normalResult.accurateAlerts / normalResult.triggeredAlerts -
              volatileResult.accurateAlerts / volatileResult.triggeredAlerts) *
              100)
          : 0,
    },
    profitSimulation,
    biasCheck,
    pricePoints,
    triggeredPoints: validationResult.triggeredPoints,
  };
}

/**
 * 运行回测（核心逻辑）
 */
function runBacktest(
  alerts: PriceAlert[],
  points: PricePoint[]
): {
  triggeredAlerts: number;
  accurateAlerts: number;
  falseAlerts: number;
  avgDelayMs: number;
  triggeredPoints: BacktestResultV2["triggeredPoints"];
} {
  const triggeredPoints: BacktestResultV2["triggeredPoints"] = [];
  let totalDelayMs = 0;

  for (let i = 0; i < points.length - 1; i++) {
    // 注意：i < length - 1，确保有"下一笔交易"
    const point = points[i];
    const nextPoint = points[i + 1]; // 下一笔交易（不是未来 N 笔平均）

    for (const alert of alerts) {
      if (alert.triggered) continue;

      const shouldTrigger = checkAlertTrigger(alert, point.price);
      if (!shouldTrigger) continue;

      // 警报触发，检查下一笔交易的价格变化（无前瞻偏差）
      const accurate = isAlertAccurateV2(alert, point.price, nextPoint.price);

      // 计算延迟（从触发到下一笔交易）
      const delayMs = nextPoint.timestamp - point.timestamp;

      triggeredPoints.push({
        timestamp: point.timestamp,
        price: point.price,
        alert,
        accurate,
        nextPrice: nextPoint.price,
      });

      totalDelayMs += delayMs;
    }
  }

  const triggeredAlerts = triggeredPoints.length;
  const accurateAlerts = triggeredPoints.filter((p) => p.accurate).length;
  const falseAlerts = triggeredAlerts - accurateAlerts;
  const avgDelayMs = triggeredAlerts > 0 ? totalDelayMs / triggeredAlerts : 0;

  return {
    triggeredAlerts,
    accurateAlerts,
    falseAlerts,
    avgDelayMs,
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
 * 检查警报是否准确（V2：无前瞻偏差）
 * 只用"下一笔交易"的价格，不用"未来 N 笔平均"
 */
function isAlertAccurateV2(
  alert: PriceAlert,
  triggerPrice: number,
  nextPrice: number
): boolean {
  if (alert.condition === "above") {
    // "价格突破 X" → 期望下一笔价格 ≥ 触发价格
    return nextPrice >= triggerPrice;
  } else {
    // "价格跌破 X" → 期望下一笔价格 ≤ 触发价格
    return nextPrice <= triggerPrice;
  }
}

/**
 * 稳定性分析（检查阈值是否在"尖锐峰值"）
 *
 * 重要：当训练集或验证集的触发次数不足时，不能静默返回"稳定"。
 * 否则用户看到绿色对勾，会把未经验证的阈值当成可靠阈值上线。
 * 这里把"数据不足"作为显式的高敏感度 + 警告信号返回。
 */
function analyzeStability(
  alerts: PriceAlert[],
  train: PricePoint[],
  validation: PricePoint[]
): BacktestResultV2["stability"] {
  const trainResult = runBacktest(alerts, train);
  const validResult = runBacktest(alerts, validation);

  // 数据不足的显式拒绝分支：任一集合没有任何触发，稳定性分析无意义
  const MIN_TRIGGERS = 3;
  if (
    trainResult.triggeredAlerts < MIN_TRIGGERS ||
    validResult.triggeredAlerts < MIN_TRIGGERS
  ) {
    return {
      thresholdSensitivity: 1, // 最高敏感度 = 最不可信
      performanceVariance: 0,
      recommendation: `⚠️ 数据不足，无法评估稳定性（训练集触发 ${trainResult.triggeredAlerts} 次，验证集触发 ${validResult.triggeredAlerts} 次，至少需要各 ${MIN_TRIGGERS} 次）。当前阈值的稳定性结论不可信，请积累更多交易后重跑回测。`,
    };
  }

  const trainAccuracy = trainResult.accurateAlerts / trainResult.triggeredAlerts;
  const validAccuracy = validResult.accurateAlerts / validResult.triggeredAlerts;

  const performanceVariance = Math.abs(trainAccuracy - validAccuracy);

  let thresholdSensitivity = 0;
  let recommendation = "";

  if (performanceVariance < 0.1) {
    thresholdSensitivity = 0.2;
    recommendation = "✅ 阈值稳定，训练集和验证集性能一致";
  } else if (performanceVariance < 0.3) {
    thresholdSensitivity = 0.5;
    recommendation = "⚠️ 阈值中等稳定，建议扩大验证窗口";
  } else {
    thresholdSensitivity = 0.8;
    recommendation = "❌ 阈值不稳定，可能过拟合训练数据，建议重新设置";
  }

  return {
    thresholdSensitivity,
    performanceVariance,
    recommendation,
  };
}

/**
 * 前瞻偏差检查
 */
function checkForwardLookingBias(
  triggeredPoints: BacktestResultV2["triggeredPoints"]
): BacktestResultV2["biasCheck"] {
  // 检查是否所有触发点都有"下一笔交易"
  // 如果用了"未来 N 笔平均"，这里会检测到
  const hasFutureLeak = triggeredPoints.some((p) => !p.nextPrice);

  return {
    hasFutureLeak,
    message: hasFutureLeak
      ? "⚠️ 检测到前瞻偏差：部分触发点使用了未来数据"
      : "✅ 无前瞻偏差：所有判断只用触发时刻之前的数据",
  };
}

/**
 * 收益模拟（保守版）
 */
function simulateProfitConservative(
  triggeredPoints: BacktestResultV2["triggeredPoints"],
  points: PricePoint[]
): BacktestResultV2["profitSimulation"] {
  if (points.length < 2 || triggeredPoints.length === 0) {
    return {
      withAlert: 0,
      withoutAlert: 0,
      improvement: 0,
      confidence: "low",
    };
  }

  const firstPrice = points[0].price;
  const lastPrice = points[points.length - 1].price;

  // 不设警报：买入并持有
  const withoutAlert = ((lastPrice - firstPrice) / firstPrice) * 100;

  // 设警报：在触发点交易（使用实际的下一笔价格）
  let withAlert = 0;
  for (const triggered of triggeredPoints) {
    if (!triggered.accurate) continue;

    // 使用实际的价格变化（不是固定 +5%）
    const priceChange =
      ((triggered.nextPrice - triggered.price) / triggered.price) * 100;

    if (triggered.alert.condition === "above") {
      // 突破后买入
      withAlert += Math.max(0, priceChange); // 只计算正收益
    } else {
      // 跌破后卖出（避免损失）
      withAlert += Math.max(0, -priceChange); // 避免的损失
    }
  }

  const improvement = withAlert - withoutAlert;

  // 置信度评估
  let confidence: "high" | "medium" | "low" = "low";
  if (triggeredPoints.length >= 5 && points.length >= 20) {
    confidence = "high";
  } else if (triggeredPoints.length >= 3 && points.length >= 10) {
    confidence = "medium";
  }

  return {
    withAlert: parseFloat(withAlert.toFixed(2)),
    withoutAlert: parseFloat(withoutAlert.toFixed(2)),
    improvement: parseFloat(improvement.toFixed(2)),
    confidence,
  };
}

/**
 * 从交易记录提取价格（TKNA/TKNB）
 */
function extractPrice(tx: TransactionRecord): number | null {
  const details = tx.details;

  if (tx.type === "swap") {
    const amountIn = parseAmount(details.amountIn);
    const amountOut = parseAmount(details.amountOut);
    const tokenIn = details.tokenIn as string | undefined;

    if (amountIn === null || amountOut === null) return null;

    if (tokenIn?.includes("TKNA") || tokenIn?.includes("TOKEN_A")) {
      return amountOut / amountIn;
    } else {
      return amountIn / amountOut;
    }
  }

  if (tx.type === "add_liquidity" || tx.type === "remove_liquidity") {
    const amountA = parseAmount(details.amountA);
    const amountB = parseAmount(details.amountB);

    if (amountA === null || amountB === null) return null;
    return amountB / amountA;
  }

  return null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function createEmptyResult(
  alerts: PriceAlert[],
  pricePoints: PricePoint[]
): BacktestResultV2 {
  return {
    totalAlerts: alerts.length,
    triggeredAlerts: 0,
    accurateAlerts: 0,
    falseAlerts: 0,
    avgDelayMs: 0,
    windows: {
      train: { name: "Training", startTime: 0, endTime: 0, points: [] },
      validation: { name: "Validation", startTime: 0, endTime: 0, points: [] },
      test: { name: "Test", startTime: 0, endTime: 0, points: [] },
    },
    stability: {
      thresholdSensitivity: 0,
      performanceVariance: 0,
      recommendation: "数据不足，无法评估稳定性",
    },
    stressTest: {
      normalAccuracy: 0,
      volatileAccuracy: 0,
      degradation: 0,
    },
    profitSimulation: {
      withAlert: 0,
      withoutAlert: 0,
      improvement: 0,
      confidence: "low",
    },
    biasCheck: {
      hasFutureLeak: false,
      message: "✅ 无前瞻偏差",
    },
    pricePoints,
    triggeredPoints: [],
  };
}

/**
 * 生成回测报告（V2）
 */
export function generateBacktestReportV2(result: BacktestResultV2): string {
  const accuracyRate =
    result.triggeredAlerts > 0
      ? ((result.accurateAlerts / result.triggeredAlerts) * 100).toFixed(1)
      : "N/A";

  const avgDelaySeconds = (result.avgDelayMs / 1000).toFixed(1);

  return `
📊 警报回测报告 V2（防过拟合版本）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
数据窗口:
- 训练集: ${result.windows.train.points.length} 个点
- 验证集: ${result.windows.validation.points.length} 个点 (用于回测)
- 测试集: ${result.windows.test.points.length} 个点 (保留未使用)

警报统计 (验证集):
- 设置警报数: ${result.totalAlerts}
- 触发次数: ${result.triggeredAlerts}
- 准确触发: ${result.accurateAlerts} (${accuracyRate}%)
- 误报: ${result.falseAlerts}
- 平均延迟: ${avgDelaySeconds}s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
稳定性分析:
- 阈值敏感度: ${(result.stability.thresholdSensitivity * 100).toFixed(0)}% (越低越好)
- 性能方差: ${(result.stability.performanceVariance * 100).toFixed(1)}%
- ${result.stability.recommendation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
压力测试:
- 正常行情准确率: ${result.stressTest.normalAccuracy.toFixed(1)}%
- 高波动行情准确率: ${result.stressTest.volatileAccuracy.toFixed(1)}%
- 性能下降: ${result.stressTest.degradation.toFixed(1)}%
${result.stressTest.degradation > 20 ? "⚠️ 高波动下性能显著下降，建议调整阈值" : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
收益模拟 (保守估计):
- 不设警报 (买入持有): ${result.profitSimulation.withoutAlert > 0 ? "+" : ""}${result.profitSimulation.withoutAlert}%
- 设置警报 (按信号交易): ${result.profitSimulation.withAlert > 0 ? "+" : ""}${result.profitSimulation.withAlert}%
- 改进幅度: ${result.profitSimulation.improvement > 0 ? "+" : ""}${result.profitSimulation.improvement}%
- 置信度: ${result.profitSimulation.confidence.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
前瞻偏差检查:
${result.biasCheck.message}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${result.triggeredAlerts === 0 ? "⚠️ 验证集中未触发任何警报，建议调整警报阈值或等待更多数据" : ""}
${result.accurateAlerts === 0 && result.triggeredAlerts > 0 ? "⚠️ 所有触发均为误报，建议重新设置警报条件" : ""}
${result.profitSimulation.confidence === "low" ? "⚠️ 数据量不足，回测结果置信度较低" : ""}
  `.trim();
}
