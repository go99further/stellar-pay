import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/agent/analytics", () => ({
  runAnalytics: vi.fn(),
  collectAnalyticsSummary: vi.fn(),
}));

vi.mock("../lib/agent/trading", () => ({
  runTrading: vi.fn(),
}));

vi.mock("../lib/agent/security", () => ({
  runSecurity: vi.fn(),
}));

vi.mock("../lib/agent/slos", () => ({
  checkSLOs: vi.fn(() => []),
  alertOnViolations: vi.fn(),
  recordLatency: vi.fn(),
}));

import { dispatch } from "../lib/agent/dispatcher";
import { runAnalytics, collectAnalyticsSummary } from "../lib/agent/analytics";
import { runTrading } from "../lib/agent/trading";
import { runSecurity } from "../lib/agent/security";
import { checkSLOs, alertOnViolations, recordLatency } from "../lib/agent/slos";
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
    vi.mocked(checkSLOs).mockReturnValue([]);
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

    expect(runAnalytics).toHaveBeenCalledWith(history);
    expect(runSecurity).toHaveBeenCalledWith(history);
    expect(runTrading).not.toHaveBeenCalled();

    const textDeltas = result.filter(e => e.type === "text").map(e => (e as { type: "text"; delta: string }).delta);
    expect(textDeltas).toContain("TVL: 1000");
    expect(textDeltas).toContain("risk: low");
    expect(result.filter(e => e.type === "done")).toHaveLength(2);
  });

  it("analytics_security parallel: events from faster agent arrive before slower agent finishes", async () => {
    let resolveAnalytics!: () => void;

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

  describe("analytics_then_trading (sequential)", () => {
    it("runs analytics first, then passes summary as context to trading", async () => {
      const summary = "Pool TVL: 2000 TKNA / 4000 TKNB. Price: 2.0.";
      vi.mocked(collectAnalyticsSummary).mockResolvedValue(summary);

      const tradingEvents: AgentStreamEvent[] = [
        { type: "text", delta: "swap ready" },
        { type: "done" },
      ];
      vi.mocked(runTrading).mockReturnValue(makeGen(tradingEvents));

      const result = await collect(dispatch("analytics_then_trading", history, "GADDR"));

      expect(collectAnalyticsSummary).toHaveBeenCalledWith(history);

      // Trading must receive enriched history with analytics context injected
      const tradingCall = vi.mocked(runTrading).mock.calls[0];
      const enrichedHistory = tradingCall[0] as AgentMessage[];
      expect(enrichedHistory.length).toBe(history.length + 1);
      const injected = enrichedHistory[enrichedHistory.length - 1];
      expect(injected.role).toBe("assistant");
      expect(injected.content).toContain(summary);

      expect(tradingCall[1]).toBe("GADDR");

      // Output includes agent_start/complete bookmarks + trading events
      const types = result.map(e => e.type);
      expect(types).toContain("agent_start");
      expect(types).toContain("agent_complete");
      expect(types).toContain("text");
      expect(types).toContain("done");
    });

    it("emits agent_start for analytics before trading events", async () => {
      vi.mocked(collectAnalyticsSummary).mockResolvedValue("summary");
      vi.mocked(runTrading).mockReturnValue(makeGen([{ type: "done" }]));

      const result = await collect(dispatch("analytics_then_trading", history));
      const agentStarts = result
        .filter(e => e.type === "agent_start")
        .map(e => (e as { type: "agent_start"; agent: string }).agent);

      expect(agentStarts).toContain("analytics");
      expect(agentStarts).toContain("trading");
    });
  });

  describe("SLO integration", () => {
    it("records latency after analytics completes", async () => {
      vi.mocked(runAnalytics).mockReturnValue(makeGen([{ type: "done" }]));
      await collect(dispatch("analytics", history));
      expect(recordLatency).toHaveBeenCalledWith("analytics", expect.any(Number));
    });

    it("records latency after trading completes", async () => {
      vi.mocked(runTrading).mockReturnValue(makeGen([{ type: "done" }]));
      await collect(dispatch("trading", history));
      expect(recordLatency).toHaveBeenCalledWith("trading", expect.any(Number));
    });

    it("calls alertOnViolations when SLO violations exist", async () => {
      const violation = {
        target: { name: "router_latency_p95", target: 500, current: 9999, met: false, severity: "critical" as const },
        timestamp: new Date().toISOString(),
        message: "router_latency_p95 exceeded",
      };
      vi.mocked(checkSLOs).mockReturnValue([violation]);
      vi.mocked(runAnalytics).mockReturnValue(makeGen([{ type: "done" }]));

      await collect(dispatch("analytics", history));
      expect(alertOnViolations).toHaveBeenCalledWith([violation]);
    });

    it("does not call alertOnViolations when no violations", async () => {
      vi.mocked(checkSLOs).mockReturnValue([]);
      vi.mocked(runAnalytics).mockReturnValue(makeGen([{ type: "done" }]));

      await collect(dispatch("analytics", history));
      expect(alertOnViolations).not.toHaveBeenCalled();
    });
  });
});
