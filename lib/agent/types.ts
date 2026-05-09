export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export type RouterIntent = "analytics" | "trading" | "security" | "clarify";

export interface RouterOutput {
  intent: RouterIntent;
  reason: string;
}

export type AgentStreamEvent =
  | { type: "router"; output: RouterOutput }
  | { type: "text"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError?: boolean }
  | { type: "done" }
  | { type: "error"; message: string };
