import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Convert Anthropic message format to OpenAI format
 */
export function convertAnthropicToOpenAI(
  messages: Anthropic.MessageParam[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return {
        role: msg.role as "user" | "assistant",
        content: msg.content,
      };
    }

    // Handle complex content blocks
    const textBlocks = msg.content.filter((block) => block.type === "text");
    const content = textBlocks.map((block) => (block as any).text).join("\n");

    return {
      role: msg.role as "user" | "assistant",
      content,
    };
  });
}

/**
 * Convert Anthropic tools to OpenAI function format
 */
export function convertAnthropicToolsToOpenAI(
  tools: Anthropic.Tool[]
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
}

/**
 * Convert OpenAI streaming response to Anthropic-like events
 */
export async function* streamOpenAIToAnthropic(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<{
  type: string;
  delta?: { type: string; text?: string };
  content_block?: { type: string; id: string; name?: string };
  index?: number;
}> {
  let toolCallBuffer: Map<
    number,
    { id: string; name: string; arguments: string }
  > = new Map();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Handle text content
    if (delta.content) {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: delta.content },
        index: 0,
      };
    }

    // Handle tool calls
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        const index = toolCall.index;
        const existing = toolCallBuffer.get(index);

        if (!existing) {
          // Start new tool call
          toolCallBuffer.set(index, {
            id: toolCall.id || `tool_${index}`,
            name: toolCall.function?.name || "",
            arguments: toolCall.function?.arguments || "",
          });

          yield {
            type: "content_block_start",
            content_block: {
              type: "tool_use",
              id: toolCall.id || `tool_${index}`,
              name: toolCall.function?.name || "",
            },
            index,
          };
        } else {
          // Append to existing tool call
          if (toolCall.function?.arguments) {
            existing.arguments += toolCall.function.arguments;
          }

          yield {
            type: "content_block_delta",
            delta: {
              type: "input_json_delta",
              partial_json: toolCall.function?.arguments || "",
            } as any,
            index,
          };
        }
      }
    }

    // Handle finish reason
    if (choice.finish_reason) {
      yield {
        type: "message_delta",
        delta: {
          stop_reason:
            choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        } as any,
      };
    }
  }
}

/**
 * Build final message from OpenAI response
 */
export function buildFinalMessageFromOpenAI(
  response: OpenAI.Chat.Completions.ChatCompletion,
  toolCallBuffer: Map<number, { id: string; name: string; arguments: string }>
): {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
} {
  const content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: any;
  }> = [];

  const choice = response.choices[0];
  if (!choice) {
    return { content: [], stop_reason: null };
  }

  // Add text content
  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
    });
  }

  // Add tool calls
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type === "function") {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        });
      }
    }
  }

  return {
    content,
    stop_reason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
        }
      : undefined,
  };
}
