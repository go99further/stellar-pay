/**
 * Benchmark reporter — terminal table renderer for ScoreReport.
 */

import type { ScoreReport } from "./types";

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function ms(x: number): string {
  if (x < 1000) return `${x.toFixed(0)}ms`;
  return `${(x / 1000).toFixed(1)}s`;
}

export function renderReport(r: ScoreReport): string {
  const lines: string[] = [];
  const m = r.metrics;

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("  Benchmark Report");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push(`  Date:  ${r.timestamp}`);
  lines.push(`  Mode:  ${r.mode}`);
  lines.push(`  Cases: ${r.totalCases}  Runtime: ${(r.durationMs / 1000).toFixed(1)}s`);
  lines.push(`  Models: Router=${r.modelRouter}, Agent=${r.modelAgent}`);
  lines.push("");

  lines.push("┌─────────────────────────┬──────────┬────────────────────────────┐");
  lines.push("│ Metric                  │ Value    │ Detail                     │");
  lines.push("├─────────────────────────┼──────────┼────────────────────────────┤");
  lines.push(`│ Router Accuracy strict  │ ${pct(m.routerAccuracy.strict).padStart(7)}  │ ${m.routerAccuracy.correctStrict}/${m.routerAccuracy.total}`.padEnd(57) + "  │");
  lines.push(`│ Router Accuracy lenient │ ${pct(m.routerAccuracy.lenient).padStart(7)}  │ ${m.routerAccuracy.correctLenient}/${m.routerAccuracy.total} (incl. acceptableIntents)`.padEnd(57) + "  │");
  lines.push(`│ Tool Recall             │ ${pct(m.toolRecall.overall).padStart(7)}  │ ${m.toolRecall.recalled}/${m.toolRecall.cases} (excl. clarify)`.padEnd(57) + "  │");
  lines.push(`│ Tool Precision          │ ${pct(m.toolPrecision.overall).padStart(7)}  │ ${m.toolPrecision.clean}/${m.toolPrecision.cases} (no forbidden tools)`.padEnd(57) + "  │");
  lines.push(`│ Safety Reject Rate      │ ${pct(m.safetyRejectRate.rate).padStart(7)}  │ ${m.safetyRejectRate.rejected}/${m.safetyRejectRate.total} adversarial blocked`.padEnd(57) + "  │");
  lines.push(`│ Content Match           │ ${(m.contentMatch.total > 0 ? pct((m.contentMatch.mustContainPass + m.contentMatch.mustNotContainPass) / m.contentMatch.total) : "n/a").padStart(7)}  │ ${m.contentMatch.mustContainPass + m.contentMatch.mustNotContainPass}/${m.contentMatch.total} content checks`.padEnd(57) + "  │");
  lines.push("├─────────────────────────┼──────────┼────────────────────────────┤");
  lines.push(`│ Router Latency P50      │ ${ms(m.efficiency.routerLatencyP50).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Router Latency P95      │ ${ms(m.efficiency.routerLatencyP95).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Agent Latency P50       │ ${ms(m.efficiency.agentLatencyP50).padStart(7)}  │ Includes testnet RPC`.padEnd(57) + "  │");
  lines.push(`│ Agent Latency P95       │ ${ms(m.efficiency.agentLatencyP95).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Total E2E P50           │ ${ms(m.efficiency.totalLatencyP50).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Avg Turns               │ ${m.efficiency.avgTurns.toFixed(1).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Avg Input Tokens        │ ${m.efficiency.avgInputTokens.toFixed(0).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push(`│ Avg Output Tokens       │ ${m.efficiency.avgOutputTokens.toFixed(0).padStart(7)}  │`.padEnd(57) + "  │");
  lines.push("└─────────────────────────┴──────────┴────────────────────────────┘");
  lines.push("");

  // Per-Level
  lines.push("Per-Level Breakdown:");
  lines.push(`  L1 (${m.byLevel.L1.cases} cases):  RouterStrict ${pct(m.byLevel.L1.routerStrict)}, ToolRecall ${pct(m.byLevel.L1.toolRecall)}`);
  lines.push(`  L2 (${m.byLevel.L2.cases} cases):  RouterStrict ${pct(m.byLevel.L2.routerStrict)}, ToolRecall ${pct(m.byLevel.L2.toolRecall)}, SafetyReject ${pct(m.byLevel.L2.safetyRate)}`);
  lines.push(`  L3 (${m.byLevel.L3.cases} cases):  RouterStrict ${pct(m.byLevel.L3.routerStrict)}, ToolRecall ${pct(m.byLevel.L3.toolRecall)}`);
  lines.push("");

  // Confusion matrix
  const intents = Array.from(new Set([
    ...Object.keys(m.routerAccuracy.confusion),
    ...Object.values(m.routerAccuracy.confusion).flatMap(v => Object.keys(v)),
  ])).sort();
  if (intents.length > 0) {
    lines.push("Router Confusion Matrix (rows=expected, cols=actual):");
    const colW = 8;
    lines.push("  " + "expected\\actual".padEnd(20) + intents.map(i => i.slice(0, colW).padStart(colW)).join(" "));
    for (const expected of intents) {
      const row = intents.map(actual => String(m.routerAccuracy.confusion[expected]?.[actual] ?? 0).padStart(colW)).join(" ");
      lines.push("  " + expected.padEnd(20) + row);
    }
    lines.push("");
  }

  // Failures
  if (m.toolRecall.misses.length > 0) {
    lines.push("Tool Recall Misses (expected tools not all called):");
    for (const miss of m.toolRecall.misses.slice(0, 8)) {
      lines.push(`  ${miss.caseId}: expected [${miss.expected.join(",")}], got [${miss.actual.join(",")}]`);
    }
    lines.push("");
  }
  if (m.toolPrecision.violations.length > 0) {
    lines.push("Tool Precision Violations (forbidden tools called):");
    for (const v of m.toolPrecision.violations) {
      lines.push(`  ${v.caseId}: called forbidden [${v.forbiddenCalled.join(",")}]`);
    }
    lines.push("");
  }
  if (m.safetyRejectRate.failures.length > 0) {
    lines.push("Safety Failures (adversarial cases not blocked):");
    for (const f of m.safetyRejectRate.failures) {
      lines.push(`  ${f.caseId}: "${f.userMessage}" → ${f.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
