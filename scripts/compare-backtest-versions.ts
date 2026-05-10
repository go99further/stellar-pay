/**
 * 对比 V1 和 V2 回测引擎
 * 展示过拟合风险的具体差异
 */

import type { PriceAlert } from "../lib/agent/price-alerts";
import { backtestAlerts, generateBacktestReport } from "../lib/agent/alert-backtest";
import { backtestAlertsV2, generateBacktestReportV2 } from "../lib/agent/alert-backtest-v2";
import { saveTransaction, clearHistory } from "../lib/agent/transaction-history";

// ── localStorage 垫片（Node / tsx 环境没有浏览器 localStorage） ──
// transaction-history.ts 在函数内部调用 localStorage.setItem/getItem；
// 模块加载阶段不会触发，所以这里在任何函数被调用之前安装垫片即可。
if (typeof globalThis.localStorage === "undefined") {
  const memoryStore = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
    clear: () => {
      memoryStore.clear();
    },
    key: (index: number) => [...memoryStore.keys()][index] ?? null,
    get length() {
      return memoryStore.size;
    },
  };
}

// 生成模拟历史数据（价格波动序列）
function generateMockHistory() {
  console.log("📝 生成模拟历史数据...\n");

  // 清空旧数据，避免多次运行时数据累积污染结果
  clearHistory();

  // 价格序列：1.0 → 1.1 → 1.2 → 1.15 → 0.95 → 0.9 → 1.0 → 1.05 → 1.1 → 1.15
  const priceSequence = [
    1.0,   // 起点
    1.1,   // 上涨
    1.2,   // 峰值
    1.15,  // 回调
    0.95,  // 下跌
    0.9,   // 谷底
    1.0,   // 反弹
    1.05,  // 恢复
    1.1,   // 继续上涨
    1.15,  // 接近峰值
  ];

  const baseTime = Date.now() - 1000 * 60 * 60 * 24; // 24小时前开始
  const timeInterval = 1000 * 60 * 30; // 每30分钟一笔交易

  console.log("价格序列:");
  priceSequence.forEach((price, i) => {
    const timestamp = baseTime + i * timeInterval;
    const amountIn = 100;
    const amountOut = price * 100;

    console.log(`  ${i + 1}. ${new Date(timestamp).toLocaleTimeString()} - 价格: ${price.toFixed(2)}`);

    saveTransaction({
      type: "swap",
      details: {
        tokenIn: "TKNA",
        tokenOut: "TKNB",
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
      },
      txHash: `mock_tx_${i + 1}`,
      status: "success",
    });
  });

  console.log("\n✅ 已保存 10 笔模拟交易到 localStorage\n");
}

// 创建测试警报
function createTestAlerts(): PriceAlert[] {
  const now = Date.now();

  return [
    {
      id: "alert_breakout_1.15",
      tokenPair: "TKNA/TKNB",
      targetPrice: 1.15,
      condition: "above",
      triggered: false,
      createdAt: now - 1000 * 60 * 60 * 2, // 2小时前创建
    },
    {
      id: "alert_breakdown_0.95",
      tokenPair: "TKNA/TKNB",
      targetPrice: 0.95,
      condition: "below",
      triggered: false,
      createdAt: now - 1000 * 60 * 60 * 2,
    },
  ];
}

// 运行对比测试
function runComparison() {
  console.log("🔬 警报回测引擎对比测试\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 1: 生成数据
  generateMockHistory();

  // Step 2: 创建警报
  const alerts = createTestAlerts();
  console.log("⚠️  测试警报:");
  console.log(`  1. TKNA/TKNB 突破 1.15 (买入信号)`);
  console.log(`  2. TKNA/TKNB 跌破 0.95 (卖出信号)\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 3: 运行 V1
  console.log("🔵 运行 V1 回测引擎（有过拟合风险）\n");
  const startV1 = Date.now();
  const resultV1 = backtestAlerts(alerts);
  const timeV1 = Date.now() - startV1;

  console.log(generateBacktestReport(resultV1));
  console.log(`\n⏱️  V1 执行时间: ${timeV1}ms\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 4: 运行 V2
  console.log("🟢 运行 V2 回测引擎（防过拟合版本）\n");
  const startV2 = Date.now();
  const resultV2 = backtestAlertsV2(alerts);
  const timeV2 = Date.now() - startV2;

  console.log(generateBacktestReportV2(resultV2));
  console.log(`\n⏱️  V2 执行时间: ${timeV2}ms\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 5: 关键差异对比
  console.log("📊 关键差异对比\n");

  console.log("1️⃣  数据使用:");
  console.log(`   V1: 使用全部 ${resultV1.pricePoints.length} 个数据点（无切分）`);
  console.log(`   V2: 训练集 ${resultV2.windows.train.points.length} 个点，验证集 ${resultV2.windows.validation.points.length} 个点，测试集 ${resultV2.windows.test.points.length} 个点（保留）`);
  console.log(`   ⚠️  V1 风险: 用户可以反复调参直到回测完美\n`);

  console.log("2️⃣  准确性判断:");
  console.log(`   V1: 使用"未来 5 笔交易的平均价格"`);
  console.log(`   V2: 只使用"下一笔交易的价格"`);
  console.log(`   ⚠️  V1 风险: 前瞻偏差（look-ahead bias）\n`);

  const v1Accuracy = resultV1.triggeredAlerts > 0
    ? (resultV1.accurateAlerts / resultV1.triggeredAlerts * 100).toFixed(1)
    : "N/A";
  const v2Accuracy = resultV2.triggeredAlerts > 0
    ? (resultV2.accurateAlerts / resultV2.triggeredAlerts * 100).toFixed(1)
    : "N/A";

  console.log("3️⃣  准确率:");
  console.log(`   V1: ${v1Accuracy}% (${resultV1.accurateAlerts}/${resultV1.triggeredAlerts})`);
  console.log(`   V2: ${v2Accuracy}% (${resultV2.accurateAlerts}/${resultV2.triggeredAlerts})`);

  if (parseFloat(v1Accuracy) > parseFloat(v2Accuracy)) {
    console.log(`   ⚠️  V1 准确率更高是因为"偷看了未来"，这是虚假的优势\n`);
  } else {
    console.log(`   ✅ V2 准确率更真实，反映上线后的实际表现\n`);
  }

  console.log("4️⃣  收益模拟:");
  console.log(`   V1: ${resultV1.profitSimulation.improvement > 0 ? "+" : ""}${resultV1.profitSimulation.improvement}% (固定 +5% 假设)`);
  console.log(`   V2: ${resultV2.profitSimulation.improvement > 0 ? "+" : ""}${resultV2.profitSimulation.improvement}% (实际价格变化，置信度: ${resultV2.profitSimulation.confidence})`);
  console.log(`   ⚠️  V1 风险: 固定假设不反映真实市场\n`);

  console.log("5️⃣  稳定性分析:");
  console.log(`   V1: 无`);
  console.log(`   V2: 阈值敏感度 ${(resultV2.stability.thresholdSensitivity * 100).toFixed(0)}%, ${resultV2.stability.recommendation}`);
  console.log(`   ⚠️  V1 风险: 无法检测"尖锐峰值"阈值\n`);

  console.log("6️⃣  压力测试:");
  console.log(`   V1: 无`);
  console.log(`   V2: 正常行情 ${resultV2.stressTest.normalAccuracy.toFixed(1)}%, 高波动 ${resultV2.stressTest.volatileAccuracy.toFixed(1)}%`);
  console.log(`   ⚠️  V1 风险: 只在"风和日丽"的数据上测试\n`);

  console.log("7️⃣  前瞻偏差检查:");
  console.log(`   V1: 无`);
  console.log(`   V2: ${resultV2.biasCheck.message}`);
  console.log(`   ⚠️  V1 风险: 无法检测是否用了未来数据\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 6: 结论
  console.log("💡 结论\n");
  console.log("V1 的问题:");
  console.log("  ❌ 用全部数据回测，容易过拟合");
  console.log("  ❌ 用未来数据判断准确性（前瞻偏差）");
  console.log("  ❌ 固定收益假设，不反映真实市场");
  console.log("  ❌ 无稳定性检查，可能选到'尖锐峰值'阈值");
  console.log("  ❌ 无压力测试，高波动下可能崩溃\n");

  console.log("V2 的优势:");
  console.log("  ✅ 时间窗口切分（60% 训练，20% 验证，20% 测试）");
  console.log("  ✅ 零前瞻偏差（只用触发时刻之前的数据）");
  console.log("  ✅ 真实收益估计（用实际价格变化）");
  console.log("  ✅ 稳定性分析（检测过拟合）");
  console.log("  ✅ 压力测试（高波动行情验证）");
  console.log("  ✅ 置信度标记（数据量不足时警告）\n");

  console.log("面试话术:");
  console.log('  "V1 是原型，展示了回测的基本逻辑。');
  console.log('   V2 是生产版本，加入了五层防过拟合措施。');
  console.log('   我用历史数据不是为了找完美参数，');
  console.log('   而是找一个上线后不丢人的下限。"\n');

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Step 7: 性能对比
  console.log("⚡ 性能对比\n");
  console.log(`  V1 执行时间: ${timeV1}ms`);
  console.log(`  V2 执行时间: ${timeV2}ms`);
  console.log(`  V2 额外开销: ${timeV2 - timeV1}ms (${((timeV2 / timeV1 - 1) * 100).toFixed(1)}%)`);
  console.log(`  结论: V2 虽然慢一点，但换来了生产级的可靠性\n`);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return {
    v1: resultV1,
    v2: resultV2,
    timeV1,
    timeV2,
  };
}

// 导出供其他模块使用
export { runComparison, generateMockHistory, createTestAlerts };

// 如果直接运行此脚本（兼容 CJS 和 ESM；tsx/node 下 argv[1] 会是脚本路径）
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("compare-backtest-versions.ts");

if (isDirectRun) {
  runComparison();
}
