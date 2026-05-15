/**
 * Agent Benchmark — 真实 API 调用测量
 *
 * 用法: npx tsx scripts/benchmark-agents.ts
 *
 * 对每个 Agent 发送标注好的测试用例，记录：
 *   - 延迟（ms）
 *   - 工具调用准确率（Router: intent 是否正确）
 *   - 成本估算（DeepSeek V4 定价）
 *
 * 输出一份 JSON 报告 + 终端表格。
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency)
try {
  const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env.local not found — rely on existing env
}

import { classifyIntent } from "../lib/agent/router";
import type { AgentMessage, RouterIntent } from "../lib/agent/types";

// ── DeepSeek V4 定价（2026-05 官网） ─────────────────────────────────────────
const PRICE_PER_M_INPUT = 1.0;   // ¥1 / 百万 input tokens (V4 Flash)
const PRICE_PER_M_OUTPUT = 2.0;  // ¥2 / 百万 output tokens (V4 Flash)
const PRICE_PRO_INPUT = 4.0;     // ¥4 / 百万 input tokens (V4 Pro)
const PRICE_PRO_OUTPUT = 16.0;   // ¥16 / 百万 output tokens (V4 Pro)

// ── Router 测试用例（标注好正确 intent） ─────────────────────────────────────
const ROUTER_CASES: { input: string; expected: RouterIntent }[] = [
  { input: "当前池子 TVL 多少", expected: "analytics" },
  { input: "最近有哪些交易", expected: "analytics" },
  { input: "池子储备量是多少", expected: "analytics" },
  { input: "24 小时交易量", expected: "analytics" },
  { input: "价格走势怎么样", expected: "analytics" },
  { input: "用 100 TKNA 换 TKNB", expected: "trading" },
  { input: "帮我添加流动性 50 TKNA 和 50 TKNB", expected: "trading" },
  { input: "我想移除所有流动性", expected: "trading" },
  { input: "swap 200 TKNB to TKNA slippage 2%", expected: "trading" },
  { input: "换币", expected: "trading" },
  { input: "这个池子安全吗", expected: "security" },
  { input: "有没有三明治攻击的风险", expected: "security" },
  { input: "合约有没有被审计过", expected: "security" },
  { input: "最近有没有异常大额撤资", expected: "security" },
  { input: "滑点风险大不大", expected: "security" },
  { input: "你好", expected: "clarify" },
  { input: "今天天气怎么样", expected: "clarify" },
  { input: "讲个笑话", expected: "clarify" },
  { input: "查一下池子然后评估风险", expected: "analytics_security" },
  { input: "看看流动性够不够，安全吗", expected: "analytics_security" },
];

interface RouterResult {
  input: string;
  expected: RouterIntent;
  actual: RouterIntent;
  correct: boolean;
  latencyMs: number;
}

interface BenchmarkReport {
  timestamp: string;
  model: string;
  router: {
    totalCases: number;
    correct: number;
    accuracy: number;
    latencies: number[];
    p50Ms: number;
    p95Ms: number;
    avgMs: number;
    results: RouterResult[];
  };
  cost: {
    perRouterCall: string;
    note: string;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

async function benchmarkRouter(): Promise<BenchmarkReport["router"]> {
  const results: RouterResult[] = [];

  for (const tc of ROUTER_CASES) {
    const messages: AgentMessage[] = [{ role: "user", content: tc.input }];
    const t0 = Date.now();
    try {
      const output = await classifyIntent(messages);
      const latencyMs = Date.now() - t0;
      results.push({
        input: tc.input,
        expected: tc.expected,
        actual: output.intent,
        correct: output.intent === tc.expected,
        latencyMs,
      });
    } catch (err) {
      const latencyMs = Date.now() - t0;
      results.push({
        input: tc.input,
        expected: tc.expected,
        actual: "clarify",
        correct: false,
        latencyMs,
      });
      console.error(`  ✗ "${tc.input}" failed:`, (err as Error).message);
    }
    // Rate limit: 100ms between calls
    await new Promise(r => setTimeout(r, 100));
  }

  const correct = results.filter(r => r.correct).length;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);

  return {
    totalCases: results.length,
    correct,
    accuracy: correct / results.length,
    latencies,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    avgMs: latencies.reduce((s, x) => s + x, 0) / latencies.length,
    results,
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Stellar-Pay Agent Benchmark");
  console.log("  Model: DeepSeek V4 Flash (Router)");
  console.log("  Date:", new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("Running Router benchmark (20 cases)...\n");
  const router = await benchmarkRouter();

  // Print results
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│ Router Agent (DeepSeek V4 Flash)                        │");
  console.log("├─────────────────┬───────────┬───────────────────────────┤");
  console.log(`│ Accuracy        │ ${(router.accuracy * 100).toFixed(0).padStart(5)}%    │ ${router.correct}/${router.totalCases} correct                  │`);
  console.log(`│ Latency P50     │ ${router.p50Ms.toFixed(0).padStart(5)}ms   │                           │`);
  console.log(`│ Latency P95     │ ${router.p95Ms.toFixed(0).padStart(5)}ms   │                           │`);
  console.log(`│ Latency Avg     │ ${router.avgMs.toFixed(0).padStart(5)}ms   │                           │`);
  console.log("└─────────────────┴───────────┴───────────────────────────┘\n");

  // Misclassifications
  const misses = router.results.filter(r => !r.correct);
  if (misses.length > 0) {
    console.log("Misclassifications:");
    for (const m of misses) {
      console.log(`  ✗ "${m.input}" → expected ${m.expected}, got ${m.actual}`);
    }
    console.log();
  }

  // Cost estimate
  // Router uses ~150-200 tokens input, ~30 tokens output per call (tool_choice forced)
  const avgInputTokens = 180;
  const avgOutputTokens = 30;
  const costPerCall = (avgInputTokens * PRICE_PER_M_INPUT + avgOutputTokens * PRICE_PER_M_OUTPUT) / 1_000_000;

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    model: "deepseek-v4-flash",
    router,
    cost: {
      perRouterCall: `¥${costPerCall.toFixed(6)}`,
      note: "Estimated from ~180 input + ~30 output tokens at V4 Flash pricing",
    },
  };

  // Write report
  const fs = await import("fs");
  const outPath = "data/benchmark-report.json";
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to ${outPath}`);
  console.log("\nDone.");
}

main().catch(console.error);
