/**
 * Benchmark runner — real mode only (mock mode added later).
 *
 * For each case:
 *   1. classifyIntent (Router, real DeepSeek call)
 *   2. dispatch (Agent layer, real DeepSeek + real testnet RPC)
 *   3. record: actualIntent, actualTools, latencies, tokens, response text
 *
 * Output: ScoreReport written to data/benchmark-report.json
 */

// IMPORTANT: load env before any lib/agent imports — they read process.env
// at module-load time and would otherwise fall back to defaults.
import "./load-env";

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";

import { CASES } from "./dataset";
import { classifyIntent } from "../../lib/agent/router";
import { dispatch } from "../../lib/agent/dispatcher";
import { getModelRouter, getModelAnalytics } from "../../lib/agent/anthropic";
import type { CaseResult, ScoreReport, BenchmarkCase } from "./types";
import type { AgentMessage } from "../../lib/agent/types";
import { computeMetrics } from "./scorer";
import { renderReport } from "./reporter";

async function runCase(c: BenchmarkCase): Promise<CaseResult> {
  const messages: AgentMessage[] = [
    ...(c.conversationHistory ?? []),
    { role: "user", content: c.userMessage },
  ];

  const t0 = Date.now();

  // Step 1: Router
  let routerLatencyMs = 0;
  let actualIntent: CaseResult["actualIntent"] = "clarify";

  try {
    const routerT0 = Date.now();
    const routed = await classifyIntent(messages);
    routerLatencyMs = Date.now() - routerT0;
    actualIntent = routed.intent;
  } catch (err) {
    return {
      caseId: c.id,
      level: c.level,
      actualIntent: "clarify",
      routerLatencyMs: Date.now() - t0,
      actualTools: [],
      actualTurns: 0,
      agentLatencyMs: 0,
      totalLatencyMs: Date.now() - t0,
      inputTokens: 0,
      outputTokens: 0,
      responseText: "",
      error: `router error: ${(err as Error).message}`,
    };
  }

  // Step 2: Agent dispatch (skip for clarify — no tool calls expected)
  const tools: string[] = [];
  let text = "";
  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  if (actualIntent !== "clarify") {
    const agentT0 = Date.now();
    try {
      for await (const evt of dispatch(actualIntent, messages)) {
        if (evt.type === "tool_use") {
          tools.push(evt.name);
          turns++;
        }
        if (evt.type === "text") text += evt.delta;
        if (evt.type === "usage") {
          inputTokens += evt.inputTokens;
          outputTokens += evt.outputTokens;
        }
      }
    } catch (err) {
      return {
        caseId: c.id,
        level: c.level,
        actualIntent,
        routerLatencyMs,
        actualTools: tools,
        actualTurns: turns,
        agentLatencyMs: Date.now() - agentT0,
        totalLatencyMs: Date.now() - t0,
        inputTokens,
        outputTokens,
        responseText: text,
        error: `agent error: ${(err as Error).message}`,
      };
    }
    return {
      caseId: c.id,
      level: c.level,
      actualIntent,
      routerLatencyMs,
      actualTools: tools,
      actualTurns: turns,
      agentLatencyMs: Date.now() - agentT0,
      totalLatencyMs: Date.now() - t0,
      inputTokens,
      outputTokens,
      responseText: text,
    };
  }

  return {
    caseId: c.id,
    level: c.level,
    actualIntent,
    routerLatencyMs,
    actualTools: tools,
    actualTurns: turns,
    agentLatencyMs: 0,
    totalLatencyMs: Date.now() - t0,
    inputTokens,
    outputTokens,
    responseText: text,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const limitArg = argv.find(a => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : CASES.length;
  const cases = CASES.slice(0, limit);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Benchmark Runner (real mode)`);
  console.log(`  Cases: ${cases.length} (L1: ${cases.filter(c => c.level === 1).length} / L2: ${cases.filter(c => c.level === 2).length} / L3: ${cases.filter(c => c.level === 3).length})`);
  console.log(`  Router: ${getModelRouter()}`);
  console.log(`  Agent:  ${getModelAnalytics()}`);
  console.log(`  Date:   ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results: CaseResult[] = [];
  const t0 = Date.now();

  for (const c of cases) {
    process.stdout.write(`  ${c.id} ${c.userMessage.slice(0, 30).padEnd(32)} `);
    const r = await runCase(c);
    const intentMatch = r.actualIntent === c.expectedIntent || c.acceptableIntents?.includes(r.actualIntent);
    const toolsMatch = c.expectedTools.length === 0 || c.expectedTools.every(t => r.actualTools.includes(t));
    const flag = intentMatch && toolsMatch ? "✓" : "✗";
    console.log(`${flag} ${r.totalLatencyMs}ms intent=${r.actualIntent} tools=[${r.actualTools.join(",")}]${r.error ? " ERR: " + r.error.slice(0, 60) : ""}`);
    results.push(r);
    await new Promise(r => setTimeout(r, 200)); // rate limit
  }

  const durationMs = Date.now() - t0;

  const report: ScoreReport = {
    timestamp: new Date().toISOString(),
    mode: "real",
    modelRouter: getModelRouter(),
    modelAgent: getModelAnalytics(),
    totalCases: results.length,
    durationMs,
    metrics: computeMetrics(cases, results),
    results,
  };

  // Print terminal report
  console.log();
  console.log(renderReport(report));

  // Persist JSON
  const outPath = resolve(process.cwd(), "data/benchmark-report.json");
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${outPath}`);
  console.log(`Total runtime: ${(durationMs / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
