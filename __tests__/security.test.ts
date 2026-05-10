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
  analyticsTools: [],
  tradingTools: [],
  securityTools: [{ name: "check_price_impact", description: "test", input_schema: { type: "object", properties: {} } }],
  runTool: vi.fn(),
}));

import { runSecurity } from "../lib/agent/security";
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

function makeStreamWithFinal(events: object[], finalMessage: object) {
  const iterable = makeAsyncIterable(events);
  return {
    ...iterable,
    [Symbol.asyncIterator]: () => iterable[Symbol.asyncIterator](),
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
}

describe("security agent", () => {
  beforeEach(() => {
    vi.mocked(hasDeepSeekKey).mockReturnValue(false);
    vi.mocked(runTool).mockResolvedValue({ riskLevel: "low" });
  });

  describe("Anthropic path", () => {
    it("should yield text delta events", async () => {
      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Risk: low" } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runSecurity(makeHistory("Is this safe?"))) {
        events.push(e);
      }

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect((textEvents[0] as { delta: string }).delta).toBe("Risk: low");
    });

    it("should yield usage event with agent=security", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 80, output_tokens: 40 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runSecurity(makeHistory("test"))) {
        events.push(e);
      }

      const usageEvent = events.find((e) => e.type === "usage") as { agent: string; inputTokens: number } | undefined;
      expect(usageEvent).toBeDefined();
      expect(usageEvent!.agent).toBe("security");
      expect(usageEvent!.inputTokens).toBe(80);
    });

    it("should yield done event at end", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runSecurity(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool and yield tool_use + tool_result", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "check_price_impact", input: { tokenIn: "TKNA", amountIn: 100 } };
      const stream1 = makeStreamWithFinal(
        [],
        { stop_reason: "tool_use", content: [toolUseBlock], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const stream2 = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Low risk." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 20, output_tokens: 10 } }
      );

      const mockStream = vi.fn()
        .mockReturnValueOnce(stream1)
        .mockReturnValueOnce(stream2);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);
      vi.mocked(runTool).mockResolvedValue({ riskLevel: "low", priceImpactPct: "0.01" });

      const events = [];
      for await (const e of runSecurity(makeHistory("Check price impact"))) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(vi.mocked(runTool)).toHaveBeenCalledWith("check_price_impact", { tokenIn: "TKNA", amountIn: 100 });
    });

    it("should yield tool_result with isError=true when tool throws", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "check_price_impact", input: {} };
      const stream1 = makeStreamWithFinal(
        [],
        { stop_reason: "tool_use", content: [toolUseBlock], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const stream2 = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 20, output_tokens: 10 } }
      );

      vi.mocked(getAnthropicClient).mockReturnValue({
        messages: { stream: vi.fn().mockReturnValueOnce(stream1).mockReturnValueOnce(stream2) },
      } as never);
      vi.mocked(runTool).mockRejectedValue(new Error("contract error"));

      const events = [];
      for await (const e of runSecurity(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
    });

    it("should skip non-text-delta events", async () => {
      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runSecurity(makeHistory("test"))) {
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
        { choices: [{ delta: { content: "Risk " }, finish_reason: null }] },
        { choices: [{ delta: { content: "is low" }, finish_reason: "stop" }] },
      ];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runSecurity(makeHistory("Is this safe?"))) {
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
      for await (const e of runSecurity(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool via OpenAI path", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "check_price_impact", arguments: '{"tokenIn":"TKNA","amountIn":100}' } }],
            },
            finish_reason: "tool_calls",
          }],
        },
      ];
      const chunks2 = [{ choices: [{ delta: { content: "Low risk." }, finish_reason: "stop" }] }];

      const mockCreate = vi.fn()
        .mockResolvedValueOnce(makeAsyncIterable(chunks1))
        .mockResolvedValueOnce(makeAsyncIterable(chunks2));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);
      vi.mocked(runTool).mockResolvedValue({ riskLevel: "low" });

      const events = [];
      for await (const e of runSecurity(makeHistory("test"))) {
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
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "check_price_impact", arguments: "{}" } }],
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
      for await (const e of runSecurity(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
    });
  });
});
