import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, MODEL_ANALYTICS } from "./anthropic";
import { analyticsTools, runTool } from "./tools";
import type { AgentMessage, AgentStreamEvent } from "./types";

const SYSTEM_PROMPT = `You are the Analytics agent for a Stellar AMM on testnet. You answer read-only questions about pool state, swap metrics, and recent events by calling tools. Rules:
- Always base numeric answers on tool output, never on memory.
- Prefer get_metrics for aggregated stats, get_pool_stats for current reserves, get_recent_events for per-event detail.
- If the user asks about trading actions, write transactions, or private keys, explain that Week 1 is read-only and decline politely.
- Keep answers concise; show numbers with units (TKNA / TKNB).`;

function toAnthropicMessages(
  history: AgentMessage[]
): Anthropic.MessageParam[] {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

interface ToolUseAccumulator {
  id: string;
  name: string;
  jsonInput: string;
}

export async function* runAnalytics(
  history: AgentMessage[]
): AsyncGenerator<AgentStreamEvent> {
  const client = getAnthropicClient();
  const messages: Anthropic.MessageParam[] = toAnthropicMessages(history);

  for (let turn = 0; turn < 5; turn++) {
    const assistantBlocks: Anthropic.ContentBlock[] = [];
    const toolAcc = new Map<number, ToolUseAccumulator>();
    let stopReason: string | null = null;

    const stream = client.messages.stream({
      model: MODEL_ANALYTICS,
      max_tokens: 1024,
      system: [
        {
          type: "text" as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: analyticsTools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          toolAcc.set(event.index, {
            id: block.id,
            name: block.name,
            jsonInput: "",
          });
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text", delta: delta.text };
        } else if (delta.type === "input_json_delta") {
          const acc = toolAcc.get(event.index);
          if (acc) acc.jsonInput += delta.partial_json;
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
      }
    }

    const finalMessage = await stream.finalMessage();
    assistantBlocks.push(...finalMessage.content);

    if (turn === 3) {
      messages.push({
        role: "user",
        content: "You have called 4 tools. Please summarize with the data you have. Do not call any more tools.",
      });
    }

    messages.push({ role: "assistant", content: finalMessage.content });

    if (stopReason !== "tool_use") {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of finalMessage.content) {
      if (block.type !== "tool_use") continue;
      yield { type: "tool_use", name: block.name, input: block.input };
      try {
        const output = await runTool(block.name, block.input);
        yield { type: "tool_result", name: block.name, output };
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        yield { type: "tool_result", name: block.name, output: message, isError: true };
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: message,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield { type: "done" };
}
