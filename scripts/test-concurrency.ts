#!/usr/bin/env tsx
import { readFileSync } from "fs";
import { resolve } from "path";

const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
envContent.split("\n").forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

import { runAnalytics } from "../lib/agent/analytics";
import type { AgentMessage } from "../lib/agent/types";

const CONCURRENCY_LEVELS = [1, 5, 10, 20, 50, 100, 200];

async function testConcurrency(level: number): Promise<{ success: number; failed: number; avgMs: number }> {
  const history: AgentMessage[] = [
    { role: "user", content: "What's the current pool liquidity?" },
  ];

  const promises = Array.from({ length: level }, async (_, i) => {
    const runStart = Date.now();
    try {
      for await (const event of runAnalytics(history)) {
        // consume stream
      }
      return { success: true, duration: Date.now() - runStart };
    } catch (error) {
      console.error(`  [${i + 1}] Error:`, error instanceof Error ? error.message : String(error));
      return { success: false, duration: Date.now() - runStart };
    }
  });

  const results = await Promise.all(promises);
  const success = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const avgMs = success > 0
    ? Math.round(results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / success)
    : 0;

  return { success, failed, avgMs };
}

async function main() {
  console.log("DeepSeek Concurrency Test\n");
  console.log("Testing concurrency levels:", CONCURRENCY_LEVELS.join(", "));
  console.log("=".repeat(60));

  for (const level of CONCURRENCY_LEVELS) {
    process.stdout.write(`\nTesting ${level} concurrent requests... `);
    const result = await testConcurrency(level);

    if (result.failed > 0) {
      console.log(`FAILED: ${result.success}/${level} succeeded, ${result.failed} failed`);
      const prevLevel = CONCURRENCY_LEVELS[CONCURRENCY_LEVELS.indexOf(level) - 1] ?? 1;
      console.log(`Max safe concurrency: ${prevLevel}`);
      break;
    } else {
      console.log(`OK: ${result.success}/${level}, avg ${result.avgMs}ms`);
    }
  }
}

main().catch(console.error);
