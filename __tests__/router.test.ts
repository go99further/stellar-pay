import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/agent/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  getOpenAIClient: vi.fn(),
  hasDeepSeekKey: vi.fn(() => false),
  getModelRouter: vi.fn(() => "claude-haiku-test"),
  MODEL_ROUTER: "claude-haiku-test",
  PROVIDER: "anthropic",
}));

vi.mock("../lib/agent/openai-adapter", () => ({
  convertAnthropicToOpenAI: vi.fn((msgs) => msgs),
  convertAnthropicToolsToOpenAI: vi.fn((tools) => tools),
  buildFinalMessageFromOpenAI: vi.fn(),
}));

import { classifyIntent } from "../lib/agent/router";
import { getAnthropicClient, getOpenAIClient, hasDeepSeekKey } from "../lib/agent/anthropic";
import type { AgentMessage } from "../lib/agent/types";

function makeHistory(content: string): AgentMessage[] {
  return [{ role: "user", content }];
}

function makeAnthropicResponse(intent: string, reason: string) {
  return {
    content: [
      {
        type: "tool_use",
        id: "tu_1",
        name: "route_intent",
        input: { intent, reason },
      },
    ],
    stop_reason: "tool_use",
  };
}

function makeOpenAIResponse(intent: string, reason: string) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "route_intent",
                arguments: JSON.stringify({ intent, reason }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

describe("router — classifyIntent", () => {
  beforeEach(() => {
    vi.mocked(hasDeepSeekKey).mockReturnValue(false);
  });

  describe("Anthropic path", () => {
    it("should return analytics intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("analytics", "pool stats question"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("What is the TVL?"));
      expect(result.intent).toBe("analytics");
      expect(result.reason).toBe("pool stats question");
    });

    it("should return trading intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("trading", "swap request"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("Swap 100 TKNA for TKNB"));
      expect(result.intent).toBe("trading");
    });

    it("should return security intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("security", "risk question"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("Is the contract safe?"));
      expect(result.intent).toBe("security");
    });

    it("should return clarify intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("clarify", "ambiguous"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("hi"));
      expect(result.intent).toBe("clarify");
    });

    it("should fall back to clarify when no tool call in response", async () => {
      const mockCreate = vi.fn().mockResolvedValue({ content: [], stop_reason: "end_turn" });
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("hello"));
      expect(result.intent).toBe("clarify");
      expect(result.reason).toContain("no tool call");
    });

    it("should return analytics_security intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("analytics_security", "needs both"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("Check pool stats and evaluate risk"));
      expect(result.intent).toBe("analytics_security");
    });

    it("should return analytics_then_trading intent", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("analytics_then_trading", "check then trade"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("Check the pool stats and then swap 100 TKNA"));
      expect(result.intent).toBe("analytics_then_trading");
    });

    it("should fall back to clarify for invalid intent value", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("invalid_intent", "bad"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.intent).toBe("clarify");
    });

    it("should fall back to clarify on API error", async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error("API timeout"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.intent).toBe("clarify");
      expect(result.reason).toContain("router error");
    });

    it("should use default reason when reason is empty string", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("analytics", ""));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.reason).toBe("no reason provided");
    });
  });

  describe("OpenAI/DeepSeek path", () => {
    beforeEach(() => {
      vi.mocked(hasDeepSeekKey).mockReturnValue(true);
    });

    it("should return analytics intent via OpenAI path", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeOpenAIResponse("analytics", "pool question"));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const result = await classifyIntent(makeHistory("What is the TVL?"));
      expect(result.intent).toBe("analytics");
      expect(result.reason).toBe("pool question");
    });

    it("should return trading intent via OpenAI path", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeOpenAIResponse("trading", "swap"));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const result = await classifyIntent(makeHistory("Swap tokens"));
      expect(result.intent).toBe("trading");
    });

    it("should fall back to clarify when no tool call in OpenAI response", async () => {
      const mockCreate = vi.fn().mockResolvedValue({ choices: [{ message: { tool_calls: [] }, finish_reason: "stop" }] });
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.intent).toBe("clarify");
    });

    it("should fall back to clarify for invalid intent via OpenAI path", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeOpenAIResponse("bad_intent", "reason"));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.intent).toBe("clarify");
    });

    it("should fall back to clarify on OpenAI API error", async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error("rate limit"));
      vi.mocked(getOpenAIClient).mockReturnValue({ chat: { completions: { create: mockCreate } } } as never);

      const result = await classifyIntent(makeHistory("test"));
      expect(result.intent).toBe("clarify");
      expect(result.reason).toContain("router error");
    });
  });

  describe("edge cases", () => {
    it("should handle empty history", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("clarify", "empty"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const result = await classifyIntent([]);
      expect(result.intent).toBe("clarify");
    });

    it("should handle multi-turn history", async () => {
      const mockCreate = vi.fn().mockResolvedValue(makeAnthropicResponse("analytics", "follow-up"));
      vi.mocked(getAnthropicClient).mockReturnValue({ messages: { create: mockCreate } } as never);

      const history: AgentMessage[] = [
        { role: "user", content: "What is TVL?" },
        { role: "assistant", content: "TVL is 1M" },
        { role: "user", content: "And the volume?" },
      ];
      const result = await classifyIntent(history);
      expect(result.intent).toBe("analytics");
    });
  });
});
