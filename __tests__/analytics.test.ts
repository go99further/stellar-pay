import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/agent/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  getOpenAIClient: vi.fn(),
  hasDeepSeekKey: vi.fn(() => false),
  getModelAnalytics: vi.fn(() => "claude-sonnet-test"),
  MODEL_ANALYTICS: "claude-sonnet-test",
  PROVIDER: "anthropic",
}));

vi.mock("../lib/agent/openai-adapter", () => ({
  convertAnthropicToOpenAI: vi.fn((msgs) => msgs),
  convertAnthropicToolsToOpenAI: vi.fn((tools) => tools),
}));

vi.mock("../lib/agent/tools", () => ({
  analyticsTools: [{ name: "get_pool_stats", description: "test", input_schema: { type: "object", properties: {} } }],
  tradingTools: [],
  securityTools: [],
  runTool: vi.fn(),
}));

import { runAnalytics, collectAnalyticsSummary } from "../lib/agent/analytics";
import { getAnthropicClient, getOpenAIClient, hasDeepSeekKey } from "../lib/agent/anthropic";
import { runTool } from "../lib/agent/tools";
import type { AgentMessage } from "../lib/agent/types";

function makeHistory(content: string): AgentMessage[] {
  return [{ role: "user", content }];
}

function makeAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined as unknown as T, done: true };
        },
      };
    },
  };
}

function makeStreamWithFinal(
  events: object[],
  finalMessage: object
) {
  const iterable = makeAsyncIterable(events);
  return {
    ...iterable,
    [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
}

describe("analytics agent", () => {
  beforeEach(() => {
    vi.mocked(hasDeepSeekKey).mockReturnValue(false);
    vi.mocked(runTool).mockResolvedValue({ result: "ok" });
  });

  describe("Anthropic path", () => {
    it("should yield text delta events", async () => {
      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("What is TVL?"))) {
        events.push(e);
      }

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect((textEvents[0] as { type: string; delta: string }).delta).toBe("Hello");
    });

    it("should yield usage event", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 100, output_tokens: 50 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      const usageEvent = events.find((e) => e.type === "usage") as { type: string; inputTokens: number; outputTokens: number; agent: string } | undefined;
      expect(usageEvent).toBeDefined();
      expect(usageEvent!.inputTokens).toBe(100);
      expect(usageEvent!.outputTokens).toBe(50);
      expect(usageEvent!.agent).toBe("analytics");
    });

    it("should yield done event at end", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool and yield tool_use + tool_result events", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "get_pool_stats", input: {} };
      const stream1 = makeStreamWithFinal(
        [],
        { stop_reason: "tool_use", content: [toolUseBlock], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const stream2 = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Pool stats: ..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 20, output_tokens: 10 } }
      );

      const mockStream = vi.fn()
        .mockReturnValueOnce(stream1)
        .mockReturnValueOnce(stream2);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);
      vi.mocked(runTool).mockResolvedValue({ tokenA: "TKNA", tokenB: "TKNB" });

      const events = [];
      for await (const e of runAnalytics(makeHistory("What is TVL?"))) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(vi.mocked(runTool)).toHaveBeenCalledWith("get_pool_stats", {});
    });

    it("should yield tool_result with isError=true when tool throws", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "get_pool_stats", input: {} };
      const stream1 = makeStreamWithFinal(
        [],
        { stop_reason: "tool_use", content: [toolUseBlock], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const stream2 = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 20, output_tokens: 10 } }
      );

      const mockStream = vi.fn()
        .mockReturnValueOnce(stream1)
        .mockReturnValueOnce(stream2);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);
      vi.mocked(runTool).mockRejectedValue(new Error("contract error"));

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
    });

    it("should ignore non-text-delta content block events", async () => {
      const stream = makeStreamWithFinal(
        [
          { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } },
          { type: "content_block_start", content_block: { type: "text", text: "" } },
        ],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      expect(events.filter((e) => e.type === "text")).toHaveLength(0);
    });
  });

  describe("OpenAI/DeepSeek path", () => {
    beforeEach(() => {
      vi.mocked(hasDeepSeekKey).mockReturnValue(true);
    });

    it("should yield text delta events via OpenAI path", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Pool " }, finish_reason: null }] },
        { choices: [{ delta: { content: "stats" }, finish_reason: "stop" }] },
      ];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("What is TVL?"))) {
        events.push(e);
      }

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("should yield done event via OpenAI path", async () => {
      const chunks = [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool via OpenAI path and yield tool_use + tool_result", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_pool_stats", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          }],
        },
      ];
      const chunks2 = [
        { choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] },
      ];

      const mockCreate = vi.fn()
        .mockResolvedValueOnce(makeAsyncIterable(chunks1))
        .mockResolvedValueOnce(makeAsyncIterable(chunks2));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);
      vi.mocked(runTool).mockResolvedValue({ tokenA: "TKNA" });

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
    });

    it("should handle tool error via OpenAI path", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_pool_stats", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          }],
        },
      ];
      const chunks2 = [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }];

      const mockCreate = vi.fn()
        .mockResolvedValueOnce(makeAsyncIterable(chunks1))
        .mockResolvedValueOnce(makeAsyncIterable(chunks2));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);
      vi.mocked(runTool).mockRejectedValue(new Error("tool failed"));

      const events = [];
      for await (const e of runAnalytics(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
    });
  });
});

describe("collectAnalyticsSummary", () => {
  beforeEach(() => {
    vi.mocked(hasDeepSeekKey).mockReturnValue(false);
  });

  it("collects all text deltas into a single trimmed string", async () => {
    const stream = makeStreamWithFinal(
      [
        { type: "content_block_delta", delta: { type: "text_delta", text: "TVL is " } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "1000 TKNA" } },
      ],
      { content: [{ type: "text", text: "TVL is 1000 TKNA" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }
    );
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: () => stream } } as never);

    const { summary } = await collectAnalyticsSummary(makeHistory("What is TVL?"));
    expect(summary).toBe("TVL is 1000 TKNA");
  });

  it("returns empty string when no text events are emitted", async () => {
    const stream = makeStreamWithFinal(
      [],
      { content: [], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 0 } }
    );
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: () => stream } } as never);

    const { summary } = await collectAnalyticsSummary(makeHistory("test"));
    expect(summary).toBe("");
  });

  it("trims leading and trailing whitespace from collected text", async () => {
    const stream = makeStreamWithFinal(
      [
        { type: "content_block_delta", delta: { type: "text_delta", text: "  pool stats  " } },
      ],
      { content: [{ type: "text", text: "  pool stats  " }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }
    );
    vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: () => stream } } as never);

    const { summary } = await collectAnalyticsSummary(makeHistory("test"));
    expect(summary).toBe("pool stats");
  });

  it("captures tool_use events alongside text", async () => {
    const stream = makeStreamWithFinal(
      [
        { type: "content_block_delta", delta: { type: "text_delta", text: "Price: 2.0" } },
      ],
      {
        content: [
          { type: "tool_use", id: "tu_1", name: "get_pool_stats", input: {} },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      }
    );
    // Second turn: end_turn with no text
    const stream2 = makeStreamWithFinal(
      [],
      { content: [{ type: "text", text: "Price: 2.0" }], stop_reason: "end_turn", usage: { input_tokens: 15, output_tokens: 3 } }
    );
    vi.mocked(runTool).mockResolvedValue({ price: "2.0" });
    vi.mocked(getAnthropicClient).mockReturnValue({
      messages: { stream: vi.fn().mockReturnValueOnce(stream).mockReturnValueOnce(stream2) },
    } as never);

    const { summary, events } = await collectAnalyticsSummary(makeHistory("What is the price?"));
    expect(summary).toBe("Price: 2.0");
    expect(events.some(e => e.type === "tool_use" && e.name === "get_pool_stats")).toBe(true);
  });
});
