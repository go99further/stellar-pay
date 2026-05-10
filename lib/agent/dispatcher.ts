import { runAnalytics } from "./analytics";
import { runTrading } from "./trading";
import { runSecurity } from "./security";
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
 *   single           — one agent handles the request
 *   parallel         — analytics + security run concurrently (analytics_security intent)
 */
export async function* dispatch(
  intent: RouterIntent,
  history: AgentMessage[],
  walletAddress?: string
): AsyncGenerator<AgentStreamEvent> {
  switch (intent) {
    case "analytics":
      yield* runAnalytics(history);
      break;

    case "trading":
      yield* runTrading(history, walletAddress);
      break;

    case "security":
      yield* runSecurity(history);
      break;

    case "analytics_security":
      yield* mergeAsyncGenerators([
        runAnalytics(history),
        runSecurity(history),
      ]);
      break;

    case "clarify":
      yield { type: "text", delta: "请重述您的问题 — 我可以分析 AMM 池状态、执行交换、管理流动性或评估风险。" };
      yield { type: "done" };
      break;
  }
}
