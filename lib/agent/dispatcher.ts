import { runAnalytics, collectAnalyticsSummary } from "./analytics";
import { runTrading } from "./trading";
import { runSecurity } from "./security";
import { checkSLOs, alertOnViolations, recordLatency } from "./slos";
import type { AgentMessage, AgentStreamEvent, RouterIntent } from "./types";

/**
 * Merge multiple async generators into a single stream.
 * Events from all generators are interleaved as they arrive.
 * Uses a shared queue + notification pattern — no race conditions.
 */
async function* mergeAsyncGenerators(
  generators: AsyncGenerator<AgentStreamEvent>[]
): AsyncGenerator<AgentStreamEvent> {
  if (generators.length === 0) return;
  if (generators.length === 1) { yield* generators[0]; return; }

  const queue: AgentStreamEvent[] = [];
  let finished = 0;
  let notify: (() => void) | null = null;

  const push = (v: AgentStreamEvent) => {
    queue.push(v);
    const n = notify;
    notify = null;
    n?.();
  };

  const finish = () => {
    finished++;
    const n = notify;
    notify = null;
    n?.();
  };

  for (const gen of generators) {
    (async () => {
      try {
        for await (const v of gen) push(v);
      } finally {
        finish();
      }
    })();
  }

  while (finished < generators.length || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      await new Promise<void>(r => { notify = r; });
    }
  }
}

/**
 * Intent Graph Dispatcher — routes an intent to one or more agents.
 *
 * Modes:
 *   single                — one agent handles the request
 *   parallel              — analytics + security run concurrently (analytics_security)
 *   sequential            — analytics runs first, its summary is injected into trading (analytics_then_trading)
 */
export async function* dispatch(
  intent: RouterIntent,
  history: AgentMessage[],
  walletAddress?: string
): AsyncGenerator<AgentStreamEvent> {
  const start = Date.now();

  switch (intent) {
    case "analytics":
      yield* withSLO("analytics", runAnalytics(history), start);
      break;

    case "trading":
      yield* withSLO("trading", runTrading(history, walletAddress), start);
      break;

    case "security":
      yield* withSLO("security", runSecurity(history), start);
      break;

    case "analytics_security":
      yield* mergeAsyncGenerators([
        runAnalytics(history),
        runSecurity(history),
      ]);
      break;

    case "analytics_then_trading": {
      // Phase 1: run analytics and stream its output
      yield { type: "agent_start", agent: "analytics" };
      const analyticsSummary = await collectAnalyticsSummary(history);
      yield { type: "agent_complete", agent: "analytics", elapsedMs: Date.now() - start };

      // Phase 2: inject analytics summary as context for trading
      const enrichedHistory: AgentMessage[] = [
        ...history,
        {
          role: "assistant",
          content: `[Analytics context]\n${analyticsSummary}`,
        },
      ];
      yield { type: "agent_start", agent: "trading" };
      yield* runTrading(enrichedHistory, walletAddress);
      break;
    }

    case "clarify":
      yield { type: "text", delta: "请重述您的问题 — 我可以分析 AMM 池状态、执行交换、管理流动性或评估风险。" };
      yield { type: "done" };
      break;
  }
}

/**
 * Wrap an agent generator: record latency and fire SLO alerts on completion.
 */
async function* withSLO(
  agent: "analytics" | "trading" | "security" | "router",
  gen: AsyncGenerator<AgentStreamEvent>,
  startMs: number
): AsyncGenerator<AgentStreamEvent> {
  try {
    yield* gen;
  } finally {
    recordLatency(agent, Date.now() - startMs);
    const violations = checkSLOs();
    if (violations.length > 0) alertOnViolations(violations);
  }
}
