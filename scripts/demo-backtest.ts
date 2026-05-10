/**
 * Demo script: 演示警报回测的数据闭环
 *
 * 使用方法:
 * 1. 先执行一些 swap 交易，生成历史数据
 * 2. 设置价格警报
 * 3. 运行回测，查看警报在历史数据中的表现
 */

import { saveTransaction } from "../lib/agent/transaction-history";
import { backtestAlerts, generateBacktestReport } from "../lib/agent/alert-backtest";
import type { PriceAlert } from "../lib/agent/price-alerts";

// 模拟历史交易数据（价格从 1.0 → 1.2 → 0.9 → 1.1）
const mockTransactions = [
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "100", // 价格 = 1.0
    },
    txHash: "mock_tx_1",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "110", // 价格 = 1.1
    },
    txHash: "mock_tx_2",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "120", // 价格 = 1.2 (峰值)
    },
    txHash: "mock_tx_3",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "95", // 价格 = 0.95 (下跌)
    },
    txHash: "mock_tx_4",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "90", // 价格 = 0.9 (谷底)
    },
    txHash: "mock_tx_5",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "105", // 价格 = 1.05 (反弹)
    },
    txHash: "mock_tx_6",
    status: "success" as const,
  },
  {
    type: "swap" as const,
    details: {
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: "100",
      amountOut: "110", // 价格 = 1.1 (恢复)
    },
    txHash: "mock_tx_7",
    status: "success" as const,
  },
];

// 模拟警报设置
const mockAlerts: PriceAlert[] = [
  {
    id: "alert_1",
    tokenPair: "TKNA/TKNB",
    targetPrice: 1.15, // 突破 1.15 时买入
    condition: "above",
    triggered: false,
    createdAt: Date.now() - 1000 * 60 * 60, // 1小时前创建
  },
  {
    id: "alert_2",
    tokenPair: "TKNA/TKNB",
    targetPrice: 0.95, // 跌破 0.95 时卖出
    condition: "below",
    triggered: false,
    createdAt: Date.now() - 1000 * 60 * 60,
  },
];

function runDemo() {
  console.log("🚀 警报回测演示 - 数据闭环\n");

  // Step 1: 生成模拟历史数据
  console.log("📝 Step 1: 生成模拟历史交易数据");
  console.log("价格序列: 1.0 → 1.1 → 1.2 → 0.95 → 0.9 → 1.05 → 1.1\n");

  // 注意：这里只是演示，实际使用时数据已经在 localStorage 中
  // mockTransactions.forEach((tx) => saveTransaction(tx));

  // Step 2: 设置警报
  console.log("⚠️  Step 2: 设置价格警报");
  console.log("- Alert 1: TKNA/TKNB 突破 1.15 (买入信号)");
  console.log("- Alert 2: TKNA/TKNB 跌破 0.95 (卖出信号)\n");

  // Step 3: 运行回测
  console.log("🔄 Step 3: 运行回测引擎\n");
  const result = backtestAlerts(mockAlerts);

  // Step 4: 显示结果
  console.log("📊 Step 4: 回测结果\n");
  console.log(generateBacktestReport(result));

  // Step 5: 分析
  console.log("\n💡 数据闭环分析:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (result.triggeredAlerts > 0) {
    const accuracy = (result.accurateAlerts / result.triggeredAlerts) * 100;

    if (accuracy >= 80) {
      console.log("✅ 警报系统表现优秀 (准确率 ≥ 80%)");
      console.log("   建议: 保持当前警报设置");
    } else if (accuracy >= 50) {
      console.log("⚠️  警报系统表现一般 (准确率 50-80%)");
      console.log("   建议: 调整警报阈值，减少误报");
    } else {
      console.log("❌ 警报系统表现较差 (准确率 < 50%)");
      console.log("   建议: 重新设计警报策略");
    }

    if (result.profitSimulation.improvement > 0) {
      console.log(`\n💰 使用警报可提升收益 ${result.profitSimulation.improvement}%`);
    } else {
      console.log(`\n📉 警报未能提升收益 (${result.profitSimulation.improvement}%)`);
    }
  } else {
    console.log("⚠️  历史数据中未触发任何警报");
    console.log("   建议: 降低警报阈值，或等待更多交易数据");
  }

  console.log("\n🔁 闭环完成:");
  console.log("   历史数据 → 回测引擎 → 准确率统计 → 优化建议 → 调整警报");
}

// 如果直接运行此脚本
if (require.main === module) {
  runDemo();
}

export { runDemo, mockTransactions, mockAlerts };
