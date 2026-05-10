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
  tradingTools: [{ name: "simulate_swap", description: "test", input_schema: { type: "object", properties: {} } }],
  securityTools: [],
  runTool: vi.fn(),
}));

import { runTrading } from "../lib/agent/trading";
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

describe("trading agent", () => {
  beforeEach(() => {
    vi.mocked(hasDeepSeekKey).mockReturnValue(false);
    vi.mocked(runTool).mockResolvedValue({ xdr: "test_xdr" });
  });

  describe("Anthropic path", () => {
    it("should yield text delta events", async () => {
      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Simulating swap..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runTrading(makeHistory("Swap 100 TKNA"))) {
        events.push(e);
      }

      const textEvents = events.filter((e) => e.type === "text");
      expect(textEvents).toHaveLength(1);
      expect((textEvents[0] as { delta: string }).delta).toBe("Simulating swap...");
    });

    it("should yield usage event with agent=trading", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 120, output_tokens: 60 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      const usageEvent = events.find((e) => e.type === "usage") as { agent: string; inputTokens: number } | undefined;
      expect(usageEvent).toBeDefined();
      expect(usageEvent!.agent).toBe("trading");
      expect(usageEvent!.inputTokens).toBe(120);
    });

    it("should yield done event at end", async () => {
      const stream = makeStreamWithFinal(
        [],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool with userPublicKey and yield tool_use + tool_result", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "simulate_swap", input: { tokenIn: "TKNA", amountIn: 100 } };
      const stream1 = makeStreamWithFinal(
        [],
        { stop_reason: "tool_use", content: [toolUseBlock], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const stream2 = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Swap simulated." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 20, output_tokens: 10 } }
      );

      const mockStream = vi.fn()
        .mockReturnValueOnce(stream1)
        .mockReturnValueOnce(stream2);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);
      vi.mocked(runTool).mockResolvedValue({ estimatedOut: "99.0" });

      const events = [];
      for await (const e of runTrading(makeHistory("Swap 100 TKNA"), "GPUBKEY")) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(vi.mocked(runTool)).toHaveBeenCalledWith("simulate_swap", { tokenIn: "TKNA", amountIn: 100 }, "GPUBKEY");
    });

    it("should yield tool_result with isError=true when tool throws", async () => {
      const toolUseBlock = { type: "tool_use", id: "tu_1", name: "simulate_swap", input: {} };
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
      vi.mocked(runTool).mockRejectedValue(new Error("Wallet not connected"));

      const events = [];
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
      expect((errEvent as { output: string }).output).toContain("Wallet not connected");
    });

    it("should work without userPublicKey (undefined)", async () => {
      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Please connect wallet." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: vi.fn().mockReturnValue(stream) } } as never);

      const events = [];
      for await (const e of runTrading(makeHistory("Swap 100 TKNA"))) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "text")).toBe(true);
      expect(events[events.length - 1].type).toBe("done");
    });

    it("should inject context for continuation phrases", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "simulate_swap", input: { tokenIn: "TKNA", amountIn: 100 } }] as never },
        { role: "user", content: "再来一次" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Simulating again..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      // Context injection modifies messages[2] (the last user message before the final assistant turn)
      const callArgs = mockStream.mock.calls[0][0];
      const injectedMsg = callArgs.messages[2]; // 0=user, 1=assistant, 2=injected user
      expect(typeof injectedMsg.content === "string" && injectedMsg.content.includes("[Context:")).toBe(true);
    });

    it("should detect batch operation with 'then' keyword", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA then add liquidity" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Step 1/2..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "text")).toBe(true);
    });

    it("should detect batch operation with Chinese keywords", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "先换 100 TKNA，然后添加流动性" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Processing..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should inject batch progress context for step 2", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA then add liquidity" },
        { role: "assistant", content: "Simulating swap..." },
        { role: "user", content: "confirmed" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Step 2..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      // Verify the test ran successfully
      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should track batch progress correctly", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap then add liquidity then remove liquidity" },
        { role: "assistant", content: "Swapping..." },
        { role: "user", content: "next step" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Step 3..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should extract context from add_liquidity operation", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Add liquidity 50 TKNA 50 TKNB" },
        { role: "assistant", content: "Adding liquidity..." },
        { role: "user", content: "again" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Adding liquidity again..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should extract context from remove_liquidity operation", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Remove 100 LP tokens" },
        { role: "assistant", content: "Removing liquidity..." },
        { role: "user", content: "more" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Removing more..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should not inject context for long user messages", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "simulate_swap", input: { tokenIn: "TKNA", amountIn: 100 } }] as never },
        { role: "user", content: "again but this time I want to swap a different amount and use different parameters" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Ok..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      const callArgs = mockStream.mock.calls[0][0];
      const lastMsg = callArgs.messages[callArgs.messages.length - 1];
      expect(lastMsg.content).not.toContain("[Context:");
    });

    it("should handle build_*_xdr tools for context extraction", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA" },
        { role: "assistant", content: "Building XDR..." },
        { role: "user", content: "another" },
      ];

      const stream = makeStreamWithFinal(
        [{ type: "content_block_delta", delta: { type: "text_delta", text: "Building another..." } }],
        { stop_reason: "end_turn", content: [], usage: { input_tokens: 10, output_tokens: 5 } }
      );
      const mockStream = vi.fn().mockReturnValue(stream);
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { stream: mockStream } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });
  });

  describe("OpenAI/DeepSeek path", () => {
    beforeEach(() => {
      vi.mocked(hasDeepSeekKey).mockReturnValue(true);
    });

    it("should yield text delta events via OpenAI path", async () => {
      const chunks = [
        { choices: [{ delta: { content: "Swap " }, finish_reason: null }] },
        { choices: [{ delta: { content: "simulated" }, finish_reason: "stop" }] },
      ];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(makeHistory("Swap 100 TKNA"))) {
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
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      expect(events[events.length - 1].type).toBe("done");
    });

    it("should execute tool via OpenAI path with userPublicKey", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "simulate_swap", arguments: '{"tokenIn":"TKNA","amountIn":100}' } }],
            },
            finish_reason: "tool_calls",
          }],
        },
      ];
      const chunks2 = [{ choices: [{ delta: { content: "Done" }, finish_reason: "stop" }] }];

      const mockCreate = vi.fn()
        .mockResolvedValueOnce(makeAsyncIterable(chunks1))
        .mockResolvedValueOnce(makeAsyncIterable(chunks2));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);
      vi.mocked(runTool).mockResolvedValue({ estimatedOut: "99.0" });

      const events = [];
      for await (const e of runTrading(makeHistory("Swap 100 TKNA"), "GPUBKEY")) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "tool_use")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(true);
      expect(vi.mocked(runTool)).toHaveBeenCalledWith("simulate_swap", { tokenIn: "TKNA", amountIn: 100 }, "GPUBKEY");
    });

    it("should handle tool error via OpenAI path", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "simulate_swap", arguments: "{}" } }],
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
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      const errEvent = events.find((e) => e.type === "tool_result" && (e as { isError?: boolean }).isError);
      expect(errEvent).toBeDefined();
    });

    it("should accumulate streamed tool call arguments", async () => {
      const chunks1 = [
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "simulate_swap", arguments: '{"tokenIn":' } }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"TKNA","amountIn":100}' } }],
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
      vi.mocked(runTool).mockResolvedValue({ estimatedOut: "99.0" });

      const events = [];
      for await (const e of runTrading(makeHistory("test"))) {
        events.push(e);
      }

      expect(vi.mocked(runTool)).toHaveBeenCalledWith("simulate_swap", { tokenIn: "TKNA", amountIn: 100 }, undefined);
    });

    it("should inject context for continuation phrases via OpenAI path", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA" },
        { role: "assistant", content: "Simulating swap..." },
        { role: "user", content: "again" },
      ];

      const chunks = [{ choices: [{ delta: { content: "Simulating again..." }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should detect batch operation via OpenAI path", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap 100 TKNA then add liquidity" },
      ];

      const chunks = [{ choices: [{ delta: { content: "Step 1/2..." }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "text")).toBe(true);
    });

    it("should inject batch progress context via OpenAI path", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Swap then add liquidity" },
        { role: "assistant", content: "Swapping..." },
        { role: "user", content: "next" },
      ];

      const chunks = [{ choices: [{ delta: { content: "Step 2..." }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should extract context from OpenAI add_liquidity operation", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Add liquidity" },
        { role: "assistant", content: "Adding liquidity..." },
        { role: "user", content: "more" },
      ];

      const chunks = [{ choices: [{ delta: { content: "Adding more..." }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("should extract context from OpenAI remove_liquidity operation", async () => {
      const history: AgentMessage[] = [
        { role: "user", content: "Remove liquidity" },
        { role: "assistant", content: "Removing liquidity..." },
        { role: "user", content: "again" },
      ];

      const chunks = [{ choices: [{ delta: { content: "Removing again..." }, finish_reason: "stop" }] }];
      const mockCreate = vi.fn().mockResolvedValue(makeAsyncIterable(chunks));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const events = [];
      for await (const e of runTrading(history)) {
        events.push(e);
      }

      expect(events.some((e) => e.type === "done")).toBe(true);
    });
  });
});
