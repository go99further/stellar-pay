import { describe, it, expect } from "vitest";
import {
  convertAnthropicToOpenAI,
  convertAnthropicToolsToOpenAI,
  buildFinalMessageFromOpenAI,
} from "../lib/agent/openai-adapter";
import type Anthropic from "@anthropic-ai/sdk";

describe("openai-adapter", () => {
  describe("convertAnthropicToOpenAI", () => {
    it("should convert string content messages", () => {
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ];
      const result = convertAnthropicToOpenAI(messages);
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("hello");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("hi there");
    });

    it("should extract text from complex content blocks", () => {
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      ];
      const result = convertAnthropicToOpenAI(messages);
      expect(result[0].content).toBe("first\nsecond");
    });

    it("should skip non-text blocks in complex content", () => {
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "question" },
            { type: "tool_result", tool_use_id: "1", content: "result" } as unknown as Anthropic.ContentBlockParam,
          ],
        },
      ];
      const result = convertAnthropicToOpenAI(messages);
      expect(result[0].content).toBe("question");
    });

    it("should return empty array for empty input", () => {
      expect(convertAnthropicToOpenAI([])).toHaveLength(0);
    });

    it("should handle empty complex content (no text blocks)", () => {
      const messages: Anthropic.MessageParam[] = [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "1", content: "r" } as unknown as Anthropic.ContentBlockParam,
          ],
        },
      ];
      const result = convertAnthropicToOpenAI(messages);
      expect(result[0].content).toBe("");
    });
  });

  describe("convertAnthropicToolsToOpenAI", () => {
    it("should convert a tool to OpenAI function format", () => {
      const tools: Anthropic.Tool[] = [
        {
          name: "get_balance",
          description: "Get wallet balance",
          input_schema: {
            type: "object",
            properties: { address: { type: "string" } },
            required: ["address"],
          },
        },
      ];
      const result = convertAnthropicToolsToOpenAI(tools);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("function");
      expect((result[0] as any).function.name).toBe("get_balance");
      expect((result[0] as any).function.description).toBe("Get wallet balance");
      expect((result[0] as any).function.parameters).toEqual(tools[0].input_schema);
    });

    it("should use empty string for missing description", () => {
      const tools: Anthropic.Tool[] = [
        {
          name: "no_desc",
          input_schema: { type: "object", properties: {} },
        },
      ];
      const result = convertAnthropicToolsToOpenAI(tools);
      expect((result[0] as any).function.description).toBe("");
    });

    it("should convert multiple tools", () => {
      const tools: Anthropic.Tool[] = [
        { name: "tool_a", input_schema: { type: "object", properties: {} } },
        { name: "tool_b", input_schema: { type: "object", properties: {} } },
      ];
      expect(convertAnthropicToolsToOpenAI(tools)).toHaveLength(2);
    });

    it("should return empty array for empty input", () => {
      expect(convertAnthropicToolsToOpenAI([])).toHaveLength(0);
    });
  });

  describe("buildFinalMessageFromOpenAI", () => {
    it("should extract text content from response", () => {
      const response = {
        choices: [{
          message: { content: "hello world", tool_calls: undefined },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any;

      const result = buildFinalMessageFromOpenAI(response, new Map());
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe("hello world");
      expect(result.stop_reason).toBe("end_turn");
    });

    it("should extract tool calls from response", () => {
      const response = {
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "get_balance", arguments: '{"address":"GXXX"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      } as any;

      const result = buildFinalMessageFromOpenAI(response, new Map());
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("tool_use");
      expect(result.content[0].name).toBe("get_balance");
      expect(result.content[0].input).toEqual({ address: "GXXX" });
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should return empty content for empty choices", () => {
      const response = {
        choices: [],
        usage: undefined,
      } as any;

      const result = buildFinalMessageFromOpenAI(response, new Map());
      expect(result.content).toHaveLength(0);
      expect(result.stop_reason).toBeNull();
    });

    it("should include usage when present", () => {
      const response = {
        choices: [{
          message: { content: "hi", tool_calls: undefined },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      } as any;

      const result = buildFinalMessageFromOpenAI(response, new Map());
      expect(result.usage).toBeDefined();
      expect(result.usage!.input_tokens).toBe(15);
      expect(result.usage!.output_tokens).toBe(8);
    });

    it("should omit usage when not present", () => {
      const response = {
        choices: [{
          message: { content: "hi", tool_calls: undefined },
          finish_reason: "stop",
        }],
        usage: undefined,
      } as any;

      const result = buildFinalMessageFromOpenAI(response, new Map());
      expect(result.usage).toBeUndefined();
    });
  });
});
