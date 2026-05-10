export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export type RouterIntent = "analytics" | "trading" | "security" | "clarify" | "analytics_security";
export type ExecutionMode = "single" | "parallel";

export interface RouterOutput {
  intent: RouterIntent;
  reason: string;
}

export type AgentStreamEvent =
  | { type: "router"; output: RouterOutput }
  | { type: "agent_start"; agent: string }
  | { type: "agent_complete"; agent: string; elapsedMs: number }
  | { type: "text"; delta: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown; isError?: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; agent: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface BatchOperation {
  step: number;
  total: number;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  description: string;
  completed: boolean;
}

export interface BatchOperationState {
  operations: BatchOperation[];
  currentStep: number;
}
