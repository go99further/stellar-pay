#!/usr/bin/env tsx
// CRITICAL: Load env vars BEFORE importing agent modules
import { readFileSync } from "fs";
import { resolve } from "path";

const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
envContent.split("\n").forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

if (!process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  console.error("Error: No API key found in .env.local");
  process.exit(1);
}

console.log(`Using API: ${process.env.DEEPSEEK_API_KEY ? "DeepSeek" : "Anthropic"}\n`);

import { classifyIntent } from "../lib/agent/router";
import { runAnalytics } from "../lib/agent/analytics";
import { runTrading } from "../lib/agent/trading";
import { runSecurity } from "../lib/agent/security";
import type { AgentMessage } from "../lib/agent/types";

interface Measurement {
  scenario: string;
  routerMs: number;
  agentMs: number;
  totalMs: number;
}

async function runOne(
  scenario: string,
  history: AgentMessage[],
  runAgent: (h: AgentMessage[]) => AsyncGenerator<unknown>
): Promise<Measurement> {
  const t0 = Date.now();
  await classifyIntent(history);
  const routerMs = Date.now() - t0;

  const t1 = Date.now();
  for await (const _ of runAgent(history)) { /* consume */ }
  const agentMs = Date.now() - t1;

  return { scenario, routerMs, agentMs, totalMs: Date.now() - t0 };
}

async function runOneSerial(
  scenario: string,
  history: AgentMessage[]
): Promise<Measurement> {
  const t0 = Date.now();
  await classifyIntent(history);
  const routerMs = Date.now() - t0;

  const t1 = Date.now();
  for await (const _ of runAnalytics(history)) { /* consume */ }
  for await (const _ of runSecurity(history)) { /* consume */ }
  const agentMs = Date.now() - t1;

  return { scenario, routerMs, agentMs, totalMs: Date.now() - t0 };
}

function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const n = s.length;
  return {
    p50: s[Math.floor(n * 0.5)],
    p95: s[Math.floor(n * 0.95)],
    p99: s[Math.floor(n * 0.99)],
    mean: s.reduce((a, b) => a + b, 0) / n,
    min: s[0],
    max: s[n - 1],
  };
}

async function main() {
  const RUNS = 20;

  const h1: AgentMessage[] = [{ role: "user", content: "What's the current TVL in the pool?" }];
  const h2: AgentMessage[] = [{ role: "user", content: "Swap 100 TKNA for TKNB" }];
  const h3: AgentMessage[] = [{ role: "user", content: "Check pool stats and evaluate risk" }];

  console.log(`Running all ${RUNS * 3} measurements in parallel...\n`);
  const t0 = Date.now();

  // Fire all 60 runs simultaneously
  const [s1, s2, s3] = await Promise.all([
    Promise.all(Array.from({ length: RUNS }, () => runOne("Analytics", h1, runAnalytics))),
    Promise.all(Array.from({ length: RUNS }, () => runOne("Trading", h2, runTrading))),
    Promise.all(Array.from({ length: RUNS }, () => runOneSerial("Analytics+Security Serial", h3))),
  ]);

  console.log(`All done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const scenarios = [
    { name: "Scenario 1: Single Agent (Analytics)", results: s1 },
    { name: "Scenario 2: Single Agent (Trading)", results: s2 },
    { name: "Scenario 3: Two Agents Serial (Analytics + Security)", results: s3 },
  ];

  for (const { name, results } of scenarios) {
    const rt = stats(results.map(r => r.routerMs));
    const ag = stats(results.map(r => r.agentMs));
    const tt = stats(results.map(r => r.totalMs));
    console.log(`${name}`);
    console.log(`  Router  p50=${rt.p50}ms  p95=${rt.p95}ms  mean=${rt.mean.toFixed(0)}ms`);
    console.log(`  Agent   p50=${ag.p50}ms  p95=${ag.p95}ms  mean=${ag.mean.toFixed(0)}ms`);
    console.log(`  Total   p50=${tt.p50}ms  p95=${tt.p95}ms  mean=${tt.mean.toFixed(0)}ms  min=${tt.min}ms  max=${tt.max}ms\n`);
  }

  const md = buildMarkdown(scenarios);
  const { writeFile, mkdir } = await import("fs/promises");
  await mkdir("docs", { recursive: true });
  await writeFile("docs/BASELINE.md", md);
  console.log("Written to docs/BASELINE.md");
}

function buildMarkdown(scenarios: Array<{ name: string; results: Measurement[] }>): string {
  const ts = new Date().toISOString();
  const [s1, s2, s3] = scenarios;

  const tt1 = stats(s1.results.map(r => r.totalMs));
  const tt2 = stats(s2.results.map(r => r.totalMs));
  const tt3 = stats(s3.results.map(r => r.totalMs));
  const ag1 = stats(s1.results.map(r => r.agentMs));
  const ag3 = stats(s3.results.map(r => r.agentMs));

  // Theoretical parallel time for S3: router + max(analytics, security)
  // We don't have separate security timing, but S3 agent = analytics + security
  // Estimate: each agent ~= S1 agent time, so parallel ~= router + S1 agent
  const rt3 = stats(s3.results.map(r => r.routerMs));
  const parallelEstimate = Math.round(rt3.p50 + ag1.p50);
  const saving = tt3.p50 - parallelEstimate;
  const savingPct = ((saving / tt3.p50) * 100).toFixed(1);

  let md = `# Baseline Performance Measurement\n\n`;
  md += `**Measured:** ${ts}  \n`;
  md += `**Runs per scenario:** 20 (all 60 runs fired in parallel)  \n`;
  md += `**Provider:** ${process.env.DEEPSEEK_API_KEY ? "DeepSeek" : "Anthropic"}  \n`;
  md += `**Model:** ${process.env.MODEL_ANALYTICS ?? "default"}  \n\n`;
  md += `---\n\n`;

  for (const { name, results } of scenarios) {
    const rt = stats(results.map(r => r.routerMs));
    const ag = stats(results.map(r => r.agentMs));
    const tt = stats(results.map(r => r.totalMs));

    md += `## ${name}\n\n`;
    md += `| | p50 | p95 | p99 | mean | min | max |\n`;
    md += `|---|---|---|---|---|---|---|\n`;
    md += `| Router | ${rt.p50} | ${rt.p95} | ${rt.p99} | ${rt.mean.toFixed(0)} | ${rt.min} | ${rt.max} |\n`;
    md += `| Agent | ${ag.p50} | ${ag.p95} | ${ag.p99} | ${ag.mean.toFixed(0)} | ${ag.min} | ${ag.max} |\n`;
    md += `| **Total** | **${tt.p50}** | **${tt.p95}** | **${tt.p99}** | **${tt.mean.toFixed(0)}** | **${tt.min}** | **${tt.max}** |\n\n`;
    md += `*(all values in ms)*\n\n`;

    md += `<details><summary>Raw runs</summary>\n\n\`\`\`\n`;
    results.forEach((r, i) => {
      md += `Run ${String(i + 1).padStart(2)}: router=${r.routerMs}ms  agent=${r.agentMs}ms  total=${r.totalMs}ms\n`;
    });
    md += `\`\`\`\n</details>\n\n`;
  }

  md += `---\n\n`;
  md += `## Key Findings\n\n`;
  md += `| Scenario | p50 total | p95 total |\n`;
  md += `|---|---|---|\n`;
  md += `| S1 Analytics | ${tt1.p50}ms | ${tt1.p95}ms |\n`;
  md += `| S2 Trading | ${tt2.p50}ms | ${tt2.p95}ms |\n`;
  md += `| S3 Analytics+Security (serial) | ${tt3.p50}ms | ${tt3.p95}ms |\n\n`;

  md += `**Parallelization opportunity (S3):**\n`;
  md += `- Current serial: ${tt3.p50}ms (p50)\n`;
  md += `- Estimated parallel: ~${parallelEstimate}ms (router + max agent)\n`;
  md += `- Potential saving: ~${saving}ms (~${savingPct}%)\n\n`;

  md += `---\n\n`;
  md += `*This is the pre-optimization baseline. Next step: implement Intent Graph Dispatcher (single + parallel modes).*\n`;

  return md;
}

main().catch(console.error);
