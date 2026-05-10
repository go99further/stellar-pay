import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/agent/analytics", () => ({
  runAnalytics: vi.fn(),
}));

vi.mock("../lib/agent/trading", () => ({
  runTrading: vi.fn(),
}));

vi.mock("../lib/agent/security", () => ({
  runSecurity: vi.fn(),
}));

import { dispatch } from "../lib/agent/dispatcher";
import { runAnalytics } from "../lib/agent/analytics";
import { runTrading } from "../lib/agent/trading";
import { runSecurity } from "../lib/agent/security";
import type { AgentMessage, AgentStreamEvent } from "../lib/agent/types";

function makeHistory(content: string): AgentMessage[] {
  return [{ role: "user", content }];
}

async function* makeGen(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  for (const e of events) yield e;
}

async function collect(gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("dispatch", () => {
  const history = makeHistory("test");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes analytics intent to runAnalytics", async () => {
    const events: AgentStreamEvent[] = [
      { type: "text", delta: "pool TVL is 1000" },
      { type: "done" },
    ];
    vi.mocked(runAnalytics).mockReturnValue(makeGen(events));

    const result = await collect(dispatch("analytics", history));
    expect(result).toEqual(events);
    expect(runAnalytics).toHaveBeenCalledWith(history);
    expect(runTrading).not.toHaveBeenCalled();
    expect(runSecurity).not.toHaveBeenCalled();
  });

  it("routes trading intent to runTrading", async () => {
    const events: AgentStreamEvent[] = [
      { type: "text", delta: "simulating swap..." },
      { type: "done" },
    ];
    vi.mocked(runTrading).mockReturnValue(makeGen(events));

    const result = await collect(dispatch("trading", history, "GADDR"));
    expect(result).toEqual(events);
    expect(runTrading).toHaveBeenCalledWith(history, "GADDR");
  });

  it("routes security intent to runSecurity", async () => {
    const events: AgentStreamEvent[] = [
      { type: "text", delta: "risk: low" },
      { type: "done" },
    ];
    vi.mocked(runSecurity).mockReturnValue(makeGen(events));

    const result = await collect(dispatch("security", history));
    expect(result).toEqual(events);
    expect(runSecurity).toHaveBeenCalledWith(history);
  });

  it("clarify yields text + done without calling any agent", async () => {
    const result = await collect(dispatch("clarify", history));
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("done");
    expect(runAnalytics).not.toHaveBeenCalled();
    expect(runTrading).not.toHaveBeenCalled();
    expect(runSecurity).not.toHaveBeenCalled();
  });

  it("analytics_security runs both agents in parallel and merges events", async () => {
    const analyticsEvents: AgentStreamEvent[] = [
      { type: "text", delta: "TVL: 1000" },
      { type: "done" },
    ];
    const securityEvents: AgentStreamEvent[] = [
      { type: "text", delta: "risk: low" },
      { type: "done" },
    ];
    vi.mocked(runAnalytics).mockReturnValue(makeGen(analyticsEvents));
    vi.mocked(runSecurity).mockReturnValue(makeGen(securityEvents));

    const result = await collect(dispatch("analytics_security", history));

    // Both agents must have been called
    expect(runAnalytics).toHaveBeenCalledWith(history);
    expect(runSecurity).toHaveBeenCalledWith(history);
    expect(runTrading).not.toHaveBeenCalled();

    // All events from both generators must appear in the merged output
    const textDeltas = result.filter(e => e.type === "text").map(e => (e as { type: "text"; delta: string }).delta);
    expect(textDeltas).toContain("TVL: 1000");
    expect(textDeltas).toContain("risk: low");
    expect(result.filter(e => e.type === "done")).toHaveLength(2);
  });

  it("analytics_security parallel: events from faster agent arrive before slower agent finishes", async () => {
    let resolveAnalytics!: () => void;
    let resolveSecurity!: () => void;

    async function* slowAnalytics(): AsyncGenerator<AgentStreamEvent> {
      yield { type: "text", delta: "analytics-1" };
      await new Promise<void>(r => { resolveAnalytics = r; });
      yield { type: "text", delta: "analytics-2" };
      yield { type: "done" };
    }

    async function* fastSecurity(): AsyncGenerator<AgentStreamEvent> {
      yield { type: "text", delta: "security-1" };
      yield { type: "done" };
      resolveAnalytics?.();
    }

    vi.mocked(runAnalytics).mockReturnValue(slowAnalytics());
    vi.mocked(runSecurity).mockReturnValue(fastSecurity());

    const result = await collect(dispatch("analytics_security", history));
    const deltas = result.filter(e => e.type === "text").map(e => (e as { type: "text"; delta: string }).delta);

    expect(deltas).toContain("analytics-1");
    expect(deltas).toContain("analytics-2");
    expect(deltas).toContain("security-1");
  });
});
