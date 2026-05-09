import type Anthropic from "@anthropic-ai/sdk";
import {
  getAnthropicClient,
  getOpenAIClient,
  hasDeepSeekKey,
  MODEL_ROUTER,
  PROVIDER,
} from "./anthropic";
import type { AgentMessage, RouterOutput, RouterIntent } from "./types";
import {
  convertAnthropicToOpenAI,
  convertAnthropicToolsToOpenAI,
  buildFinalMessageFromOpenAI,
} from "./openai-adapter";

const ROUTE_TOOL: Anthropic.Tool = {
  name: "route_intent",
  description:
    "Emit the classified intent for the user's latest message. Always call this tool exactly once.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: ["analytics", "trading", "security", "clarify"],
        description:
          "analytics = read-only questions about pool, metrics, or events. trading = intent to swap / add / remove liquidity. security = wallet safety, contract audit, risk questions. clarify = ambiguous or off-topic.",
      },
      reason: {
        type: "string",
        description: "One short sentence explaining the classification.",
      },
    },
    required: ["intent", "reason"],
  },
};

const SYSTEM_PROMPT = `You are the router for a Stellar AMM assistant. Classify the user's latest message into one of four intents and always call the route_intent tool exactly once. Pick "clarify" when the message is ambiguous, empty, or unrelated to the AMM.

Examples:
- "What's the current TVL in the pool?" -> analytics
- "Show me the last 10 swaps" -> analytics
- "Swap 100 TKNA for TKNB" -> trading
- "Is the AMM contract safe to use?" -> security
- "hi" -> clarify`;

const VALID_INTENTS: RouterIntent[] = ["analytics", "trading", "security", "clarify"];

function toAnthropicMessages(history: AgentMessage[]): Anthropic.MessageParam[] {
  return history.map((m) => ({ role: m.role, content: m.content }));
}

export async function classifyIntent(history: AgentMessage[]): Promise<RouterOutput> {
  try {
    if (hasDeepSeekKey()) {
      return await classifyIntentOpenAI(history);
    }
    return await classifyIntentAnthropic(history);
  } catch (err) {
    return {
      intent: "clarify",
      reason: err instanceof Error ? `router error: ${err.message}` : "router error",
    };
  }
}

async function classifyIntentAnthropic(history: AgentMessage[]): Promise<RouterOutput> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL_ROUTER,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [ROUTE_TOOL],
    tool_choice: { type: "tool", name: "route_intent" },
    messages: toAnthropicMessages(history),
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    return { intent: "clarify", reason: "router produced no tool call" };
  }

  const parsed = toolUse.input as { intent?: string; reason?: string };
  const intent = VALID_INTENTS.includes(parsed.intent as RouterIntent)
    ? (parsed.intent as RouterIntent)
    : "clarify";
  const reason =
    typeof parsed.reason === "string" && parsed.reason.length > 0
      ? parsed.reason
      : "no reason provided";
  return { intent, reason };
}

async function classifyIntentOpenAI(history: AgentMessage[]): Promise<RouterOutput> {
  const client = getOpenAIClient();
  const messages = convertAnthropicToOpenAI(toAnthropicMessages(history));
  const tools = convertAnthropicToolsToOpenAI([ROUTE_TOOL]);

  const response = await client.chat.completions.create({
    model: MODEL_ROUTER,
    max_tokens: 256,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    tools,
    tool_choice: { type: "function", function: { name: "route_intent" } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") {
    return { intent: "clarify", reason: "router produced no tool call" };
  }

  const parsed = JSON.parse(toolCall.function.arguments) as {
    intent?: string;
    reason?: string;
  };
  const intent = VALID_INTENTS.includes(parsed.intent as RouterIntent)
    ? (parsed.intent as RouterIntent)
    : "clarify";
  const reason =
    typeof parsed.reason === "string" && parsed.reason.length > 0
      ? parsed.reason
      : "no reason provided";
  return { intent, reason };
}
