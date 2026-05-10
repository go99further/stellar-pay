import {
  detectPriceImpact,
  detectLiquidityFlow,
  detectAnomalies,
  detectSandwich,
} from "../../lib/agent/security-core";
import { SCENARIOS, type BacktestScenario } from "./scenarios";
import { computeSetMetrics, setSimilarity, type DetectorResult } from "./metrics";

function runScenario(scenario: BacktestScenario): DetectorResult[] {
  const results: DetectorResult[] = [];

  // Price impact: only evaluated if probe swap is present
  if (scenario.probeSwap && scenario.expected.priceImpact !== undefined) {
    const r = detectPriceImpact(
      scenario.probeSwap.amountIn,
      scenario.probeSwap.tokenIn,
      scenario.reserveA,
      scenario.reserveB
    );
    results.push({
      scenarioId: scenario.id,
      detector: "priceImpact",
      expected: scenario.expected.priceImpact,
      actual: r.riskLevel,
      match: r.riskLevel === scenario.expected.priceImpact,
      details: { priceImpactPct: r.priceImpactPct.toFixed(3) },
    });
  }

  // Liquidity flow
  if (scenario.expected.liquidityFlow !== undefined) {
    const r = detectLiquidityFlow(scenario.events, scenario.reserveA);
    results.push({
      scenarioId: scenario.id,
      detector: "liquidityFlow",
      expected: scenario.expected.liquidityFlow,
      actual: r.riskLevel,
      match: r.riskLevel === scenario.expected.liquidityFlow,
      details: { outflowPct: r.outflowPct.toFixed(2) },
    });
  }

  // Anomaly (flagged addresses)
  if (scenario.expected.anomaly !== undefined) {
    const r = detectAnomalies(scenario.events, scenario.reserveA);
    const actualAddrs = r.flaggedAddresses.map((f) => f.address);
    const expectedAddrs = scenario.expected.flaggedAddresses ?? [];
    const sim = setSimilarity(expectedAddrs, actualAddrs);
    results.push({
      scenarioId: scenario.id,
      detector: "anomaly",
      expected: scenario.expected.anomaly,
      actual: r.riskLevel,
      match: r.riskLevel === scenario.expected.anomaly && sim.missed.length === 0,
      details: {
        flaggedCount: r.flaggedAddresses.length,
        jaccard: sim.jaccard.toFixed(2),
        missed: sim.missed,
        extra: sim.extra,
      },
    });
  }

  // Sandwich
  if (scenario.expected.sandwich !== undefined) {
    const r = detectSandwich(scenario.events);
    const actualAttackers = [...new Set(r.hits.map((h) => h.attacker))];
    const expectedAttackers = scenario.expected.sandwichAttackers ?? [];
    const sim = setSimilarity(expectedAttackers, actualAttackers);
    results.push({
      scenarioId: scenario.id,
      detector: "sandwich",
      expected: scenario.expected.sandwich,
      actual: r.riskLevel,
      match: r.riskLevel === scenario.expected.sandwich && sim.missed.length === 0,
      details: {
        hitCount: r.hits.length,
        jaccard: sim.jaccard.toFixed(2),
        missed: sim.missed,
        extra: sim.extra,
      },
    });
  }

  return results;
}

function formatCell(r: DetectorResult): string {
  const icon = r.match ? "✓" : "✗";
  return `${icon} ${r.expected ?? "—"} / ${r.actual}`;
}

export function runAllAndReport(): {
  markdown: string;
  passed: number;
  total: number;
} {
  const allResults: DetectorResult[] = [];
  const perScenario: { scenario: BacktestScenario; results: DetectorResult[] }[] = [];

  for (const scenario of SCENARIOS) {
    const results = runScenario(scenario);
    allResults.push(...results);
    perScenario.push({ scenario, results });
  }

  const byDetector = new Map<string, DetectorResult[]>();
  for (const r of allResults) {
    const list = byDetector.get(r.detector) ?? [];
    list.push(r);
    byDetector.set(r.detector, list);
  }

  const overall = computeSetMetrics(allResults);
  const perDetectorMetrics = [...byDetector.entries()].map(([name, rs]) => ({
    name,
    metrics: computeSetMetrics(rs),
    total: rs.length,
  }));

  const passed = allResults.filter((r) => r.match).length;
  const total = allResults.length;

  const lines: string[] = [];
  lines.push("# Security Agent Backtest Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Scenarios**: ${SCENARIOS.length}`);
  lines.push(`- **Detector evaluations**: ${total}`);
  lines.push(`- **Exact match rate**: ${passed}/${total} = ${((passed / total) * 100).toFixed(1)}%`);
  lines.push(`- **Overall precision**: ${(overall.precision * 100).toFixed(1)}%`);
  lines.push(`- **Overall recall**: ${(overall.recall * 100).toFixed(1)}%`);
  lines.push(`- **Overall F1**: ${(overall.f1 * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("## Per-Detector Metrics");
  lines.push("");
  lines.push("| Detector | Evals | Precision | Recall | F1 | TP | FP | FN | TN |");
  lines.push("|----------|-------|-----------|--------|-----|----|----|----|----|");
  for (const d of perDetectorMetrics) {
    const m = d.metrics;
    lines.push(
      `| ${d.name} | ${d.total} | ${(m.precision * 100).toFixed(1)}% | ${(
        m.recall * 100
      ).toFixed(1)}% | ${(m.f1 * 100).toFixed(1)}% | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} |`
    );
  }
  lines.push("");
  lines.push("## Scenario Results");
  lines.push("");
  lines.push("| Scenario | Category | Price Impact | Liquidity Flow | Anomaly | Sandwich |");
  lines.push("|----------|----------|--------------|----------------|---------|----------|");
  for (const { scenario, results } of perScenario) {
    const byDet = new Map(results.map((r) => [r.detector, r]));
    const pi = byDet.get("priceImpact");
    const lf = byDet.get("liquidityFlow");
    const an = byDet.get("anomaly");
    const sw = byDet.get("sandwich");
    lines.push(
      `| ${scenario.id} — ${scenario.name} | ${scenario.category} | ${
        pi ? formatCell(pi) : "—"
      } | ${lf ? formatCell(lf) : "—"} | ${an ? formatCell(an) : "—"} | ${
        sw ? formatCell(sw) : "—"
      } |`
    );
  }
  lines.push("");
  lines.push("## Scenario Details");
  lines.push("");
  for (const { scenario, results } of perScenario) {
    lines.push(`### ${scenario.id} — ${scenario.name}`);
    lines.push("");
    lines.push(`> ${scenario.description}`);
    lines.push("");
    lines.push(`- Category: **${scenario.category}**`);
    lines.push(`- Events: ${scenario.events.length}, Reserves: ${scenario.reserveA / 10_000_000n} / ${scenario.reserveB / 10_000_000n}`);
    if (scenario.probeSwap) {
      lines.push(
        `- Probe swap: ${scenario.probeSwap.amountIn / 10_000_000n} ${scenario.probeSwap.tokenIn}`
      );
    }
    lines.push("");
    for (const r of results) {
      const icon = r.match ? "✓" : "✗";
      lines.push(
        `- ${icon} **${r.detector}** — expected: \`${r.expected}\`, actual: \`${r.actual}\``
      );
      if (r.details) {
        for (const [k, v] of Object.entries(r.details)) {
          const val = Array.isArray(v) ? (v.length === 0 ? "[]" : v.map((x) => String(x).slice(0, 12) + "…").join(", ")) : String(v);
          lines.push(`  - ${k}: ${val}`);
        }
      }
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(
    "**Methodology**: Each scenario is a hand-labeled event sequence. Detectors run as pure functions against the events + reserves. A detector passes if `actual === expected` and flagged address sets match. \"Positive\" = medium or high risk."
  );

  return { markdown: lines.join("\n"), passed, total };
}

// When invoked directly via tsx/ts-node (CJS). In ESM vitest context, `require` is undefined.
if (typeof require !== "undefined" && require.main === module) {
  const { markdown, passed, total } = runAllAndReport();
  // eslint-disable-next-line no-console
  console.log(markdown);
  // Exit non-zero if any scenario failed (useful for CI)
  process.exit(passed === total ? 0 : 1);
}
