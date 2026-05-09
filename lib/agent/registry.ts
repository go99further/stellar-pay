import type { AgentMessage, AgentStreamEvent, RouterIntent } from "./types";
import { runAnalytics } from "./analytics";
import { runTrading } from "./trading";
import { runSecurity } from "./security";

export interface AgentDefinition {
  readonly name: RouterIntent;
  readonly description: string;
  readonly run: (history: AgentMessage[], userPublicKey?: string) => AsyncGenerator<AgentStreamEvent>;
}

export interface AgentRegistry {
  readonly agents: readonly AgentDefinition[];
  get(intent: RouterIntent): AgentDefinition | undefined;
}

function buildRegistry(agents: AgentDefinition[]): AgentRegistry {
  const map = new Map<RouterIntent, AgentDefinition>(agents.map((a) => [a.name, a]));
  return {
    agents,
    get(intent) { return map.get(intent); },
  };
}

export const defaultRegistry: AgentRegistry = buildRegistry([
  { name: "analytics", description: "Read-only pool stats, metrics, events", run: (h) => runAnalytics(h) },
  { name: "trading",   description: "Swap, add/remove liquidity",            run: (h, pk) => runTrading(h, pk) },
  { name: "security",  description: "Risk analysis, anomaly detection",       run: (h) => runSecurity(h) },
]);
