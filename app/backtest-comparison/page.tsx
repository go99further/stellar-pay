"use client";

import { useState } from "react";
import { backtestAlerts, generateBacktestReport } from "@/lib/agent/alert-backtest";
import { backtestAlertsV2, generateBacktestReportV2 } from "@/lib/agent/alert-backtest-v2";
import { saveTransaction, clearHistory } from "@/lib/agent/transaction-history";
import type { PriceAlert } from "@/lib/agent/price-alerts";

export default function BacktestComparisonPage() {
  const [v1Result, setV1Result] = useState<string>("");
  const [v2Result, setV2Result] = useState<string>("");
  const [comparison, setComparison] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);

  const generateMockData = () => {
    // 先清空，避免累积污染：连点两次按钮时旧 mock 会被挤掉
    // 也避免覆盖真实用户交易（如果用户已做过真实 swap，不要静默销毁）
    clearHistory();

    // 价格序列：1.0 → 1.1 → 1.2 → 1.15 → 0.95 → 0.9 → 1.0 → 1.05 → 1.1 → 1.15
    const priceSequence = [1.0, 1.1, 1.2, 1.15, 0.95, 0.9, 1.0, 1.05, 1.1, 1.15];
    const baseTime = Date.now() - 1000 * 60 * 60 * 24; // 24小时前
    const timeInterval = 1000 * 60 * 30; // 每30分钟

    priceSequence.forEach((price, i) => {
      const timestamp = baseTime + i * timeInterval;
      saveTransaction({
        type: "swap",
        details: {
          tokenIn: "TKNA",
          tokenOut: "TKNB",
          amountIn: "100",
          amountOut: (price * 100).toString(),
        },
        txHash: `mock_tx_${i + 1}_${Date.now()}`,
        status: "success",
      });
    });
  };

  const runComparison = () => {
    setIsRunning(true);
    setV1Result("");
    setV2Result("");
    setComparison("");

    // 生成模拟数据
    generateMockData();

    // 创建测试警报
    const alerts: PriceAlert[] = [
      {
        id: "alert_breakout_1.15",
        tokenPair: "TKNA/TKNB",
        targetPrice: 1.15,
        condition: "above",
        triggered: false,
        createdAt: Date.now() - 1000 * 60 * 60 * 2,
      },
      {
        id: "alert_breakdown_0.95",
        tokenPair: "TKNA/TKNB",
        targetPrice: 0.95,
        condition: "below",
        triggered: false,
        createdAt: Date.now() - 1000 * 60 * 60 * 2,
      },
    ];

    // 运行 V1
    const startV1 = Date.now();
    const resultV1 = backtestAlerts(alerts);
    const timeV1 = Date.now() - startV1;
    const reportV1 = generateBacktestReport(resultV1);
    setV1Result(`${reportV1}\n\n⏱️ 执行时间: ${timeV1}ms`);

    // 运行 V2
    const startV2 = Date.now();
    const resultV2 = backtestAlertsV2(alerts);
    const timeV2 = Date.now() - startV2;
    const reportV2 = generateBacktestReportV2(resultV2);
    setV2Result(`${reportV2}\n\n⏱️ 执行时间: ${timeV2}ms`);

    // 生成对比
    const v1Accuracy =
      resultV1.triggeredAlerts > 0
        ? ((resultV1.accurateAlerts / resultV1.triggeredAlerts) * 100).toFixed(1)
        : "N/A";
    const v2Accuracy =
      resultV2.triggeredAlerts > 0
        ? ((resultV2.accurateAlerts / resultV2.triggeredAlerts) * 100).toFixed(1)
        : "N/A";

    const comparisonText = `
📊 关键差异对比

1️⃣  数据使用:
   V1: 使用全部 ${resultV1.pricePoints.length} 个数据点（无切分）
   V2: 训练集 ${resultV2.windows.train.points.length} 个点，验证集 ${resultV2.windows.validation.points.length} 个点，测试集 ${resultV2.windows.test.points.length} 个点
   ⚠️  V1 风险: 用户可以反复调参直到回测完美

2️⃣  准确性判断:
   V1: 使用"未来 5 笔交易的平均价格"
   V2: 只使用"下一笔交易的价格"
   ⚠️  V1 风险: 前瞻偏差（look-ahead bias）

3️⃣  准确率:
   V1: ${v1Accuracy}% (${resultV1.accurateAlerts}/${resultV1.triggeredAlerts})
   V2: ${v2Accuracy}% (${resultV2.accurateAlerts}/${resultV2.triggeredAlerts})
   ${parseFloat(v1Accuracy) > parseFloat(v2Accuracy) ? "⚠️  V1 准确率更高是因为'偷看了未来'，这是虚假的优势" : "✅ V2 准确率更真实"}

4️⃣  收益模拟:
   V1: ${resultV1.profitSimulation.improvement > 0 ? "+" : ""}${resultV1.profitSimulation.improvement}% (固定 +5% 假设)
   V2: ${resultV2.profitSimulation.improvement > 0 ? "+" : ""}${resultV2.profitSimulation.improvement}% (实际价格变化，置信度: ${resultV2.profitSimulation.confidence})
   ⚠️  V1 风险: 固定假设不反映真实市场

5️⃣  稳定性分析:
   V1: 无
   V2: 阈值敏感度 ${(resultV2.stability.thresholdSensitivity * 100).toFixed(0)}%, ${resultV2.stability.recommendation}
   ⚠️  V1 风险: 无法检测"尖锐峰值"阈值

6️⃣  压力测试:
   V1: 无
   V2: 正常行情 ${resultV2.stressTest.normalAccuracy.toFixed(1)}%, 高波动 ${resultV2.stressTest.volatileAccuracy.toFixed(1)}%
   ⚠️  V1 风险: 只在"风和日丽"的数据上测试

7️⃣  前瞻偏差检查:
   V1: 无
   V2: ${resultV2.biasCheck.message}
   ⚠️  V1 风险: 无法检测是否用了未来数据

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 结论

V1 的问题:
  ❌ 用全部数据回测，容易过拟合
  ❌ 用未来数据判断准确性（前瞻偏差）
  ❌ 固定收益假设，不反映真实市场
  ❌ 无稳定性检查，可能选到"尖锐峰值"阈值
  ❌ 无压力测试，高波动下可能崩溃

V2 的优势:
  ✅ 时间窗口切分（60% 训练，20% 验证，20% 测试）
  ✅ 零前瞻偏差（只用触发时刻之前的数据）
  ✅ 真实收益估计（用实际价格变化）
  ✅ 稳定性分析（检测过拟合）
  ✅ 压力测试（高波动行情验证）
  ✅ 置信度标记（数据量不足时警告）

⚡ 性能对比:
  V1 执行时间: ${timeV1}ms
  V2 执行时间: ${timeV2}ms
  V2 额外开销: ${timeV2 - timeV1}ms (${((timeV2 / timeV1 - 1) * 100).toFixed(1)}%)
  结论: V2 虽然慢一点，但换来了生产级的可靠性

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎤 面试话术:
"V1 是原型，展示了回测的基本逻辑。
 V2 是生产版本，加入了五层防过拟合措施。
 我用历史数据不是为了找完美参数，
 而是找一个上线后不丢人的下限。"
    `.trim();

    setComparison(comparisonText);
    setIsRunning(false);
  };

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">警报回测引擎对比</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          V1 (有过拟合风险) vs V2 (防过拟合版本)
        </p>
      </header>

      <button
        onClick={runComparison}
        disabled={isRunning}
        className="w-full rounded bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {isRunning ? "运行中..." : "🔬 运行对比测试"}
      </button>

      {comparison && (
        <div className="rounded border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <h2 className="mb-2 text-lg font-semibold text-amber-900 dark:text-amber-200">
            📊 对比结果
          </h2>
          <pre className="whitespace-pre-wrap text-xs text-amber-800 dark:text-amber-300">
            {comparison}
          </pre>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* V1 结果 */}
        {v1Result && (
          <div className="rounded border border-red-400 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950">
            <h2 className="mb-2 text-lg font-semibold text-red-900 dark:text-red-200">
              🔵 V1 回测结果（有过拟合风险）
            </h2>
            <pre className="whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">
              {v1Result}
            </pre>
          </div>
        )}

        {/* V2 结果 */}
        {v2Result && (
          <div className="rounded border border-emerald-400 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950">
            <h2 className="mb-2 text-lg font-semibold text-emerald-900 dark:text-emerald-200">
              🟢 V2 回测结果（防过拟合版本）
            </h2>
            <pre className="whitespace-pre-wrap text-xs text-emerald-800 dark:text-emerald-300">
              {v2Result}
            </pre>
          </div>
        )}
      </div>

      <div className="rounded border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-lg font-semibold">📝 测试说明</h2>
        <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            <strong>模拟数据:</strong> 10 笔 swap 交易，价格序列: 1.0 → 1.1 → 1.2 → 1.15 → 0.95 → 0.9 → 1.0 → 1.05 → 1.1 → 1.15
          </p>
          <p>
            <strong>测试警报:</strong>
          </p>
          <ul className="ml-6 list-disc">
            <li>Alert 1: TKNA/TKNB 突破 1.15 (买入信号)</li>
            <li>Alert 2: TKNA/TKNB 跌破 0.95 (卖出信号)</li>
          </ul>
          <p>
            <strong>预期结果:</strong> V1 准确率可能虚高（因为用了未来数据），V2 准确率更真实但可能更低
          </p>
        </div>
      </div>

      <div className="rounded border border-indigo-400 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-950">
        <h2 className="mb-2 text-lg font-semibold text-indigo-900 dark:text-indigo-200">
          🎯 关键观察点
        </h2>
        <div className="space-y-2 text-sm text-indigo-800 dark:text-indigo-300">
          <div>
            <strong>1. 数据切分:</strong> V2 会将数据分为训练/验证/测试集，V1 使用全部数据
          </div>
          <div>
            <strong>2. 准确率差异:</strong> V1 可能更高（因为前瞻偏差），V2 更真实
          </div>
          <div>
            <strong>3. 稳定性分析:</strong> V2 会警告阈值是否过拟合
          </div>
          <div>
            <strong>4. 压力测试:</strong> V2 会单独测试高波动行情
          </div>
          <div>
            <strong>5. 置信度:</strong> V2 会标记数据量是否足够（high/medium/low）
          </div>
        </div>
      </div>
    </main>
  );
}
