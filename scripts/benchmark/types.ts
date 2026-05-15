/**
 * Benchmark types — shared across dataset, runner, scorer, reporter.
 */

import type { RouterIntent, AgentMessage } from "../../lib/agent/types";

export type BenchmarkCategory =
  | "single_analytics"
  | "single_trading"
  | "single_security"
  | "single_clarify"
  | "complex_params_missing"
  | "complex_multi_tool"
  | "complex_boundary"
  | "complex_adversarial"
  | "multi_parallel"
  | "multi_sequential"
  | "multi_cross_agent"
  | "multi_gated";

export interface BenchmarkCase {
  id: string;
  level: 1 | 2 | 3;
  category: BenchmarkCategory;
  userMessage: string;
  conversationHistory?: AgentMessage[];

  // Router 层
  expectedIntent: RouterIntent;
  acceptableIntents?: RouterIntent[];

  // Agent 层
  expectedTools: string[];
  forbiddenTools?: string[];

  // 输出
  mustContain?: string[];
  mustNotContain?: string[];

  // 性能
  maxTurns?: number;

  difficulty: "easy" | "medium" | "hard";
  tags: string[];
}

export interface CaseResult {
  caseId: string;
  level: 1 | 2 | 3;

  actualIntent: RouterIntent;
  routerLatencyMs: number;

  actualTools: string[];
  actualTurns: number;
  agentLatencyMs: number;
  totalLatencyMs: number;

  inputTokens: number;
  outputTokens: number;

  responseText: string;
  error?: string;
}

export interface MetricsReport {
  routerAccuracy: {
    strict: number;
    lenient: number;
    correctStrict: number;
    correctLenient: number;
    total: number;
    confusion: Record<string, Record<string, number>>;
  };
  toolRecall: {
    overall: number;
    cases: number;
    recalled: number;
    misses: { caseId: string; expected: string[]; actual: string[] }[];
  };
  toolPrecision: {
    overall: number;
    cases: number;
    clean: number;
    violations: { caseId: string; forbiddenCalled: string[] }[];
  };
  safetyRejectRate: {
    total: number;
    rejected: number;
    rate: number;
    failures: { caseId: string; userMessage: string; reason: string }[];
  };
  contentMatch: {
    mustContainPass: number;
    mustNotContainPass: number;
    total: number;
  };
  efficiency: {
    routerLatencyP50: number;
    routerLatencyP95: number;
    agentLatencyP50: number;
    agentLatencyP95: number;
    totalLatencyP50: number;
    totalLatencyP95: number;
    avgTurns: number;
    avgInputTokens: number;
    avgOutputTokens: number;
  };
  byLevel: {
    L1: { cases: number; routerStrict: number; toolRecall: number };
    L2: { cases: number; routerStrict: number; toolRecall: number; safetyRate: number };
    L3: { cases: number; routerStrict: number; toolRecall: number };
  };
}

export interface ScoreReport {
  timestamp: string;
  mode: "real" | "mock";
  modelRouter: string;
  modelAgent: string;
  totalCases: number;
  durationMs: number;
  metrics: MetricsReport;
  results: CaseResult[];
}
