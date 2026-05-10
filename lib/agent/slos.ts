/**
 * Agent Service Level Objectives (SLOs)
 *
 * Defines and tracks SLO targets for agent performance:
 * - Latency percentiles (p50, p95, p99)
 * - Success rates
 * - Cache hit rates
 *
 * SLO targets are based on production requirements and user experience expectations.
 *
 * @example
 * ```typescript
 * import { recordLatency, recordToolCall, checkSLOs } from './slos';
 *
 * // Record agent latency
 * const startTime = Date.now();
 * await routerAgent.process(message);
 * recordLatency('router', Date.now() - startTime);
 *
 * // Record tool call result
 * try {
 *   const result = await executeTool('get-balance');
 *   recordToolCall('get-balance', true);
 * } catch (error) {
 *   recordToolCall('get-balance', false);
 * }
 *
 * // Check SLO compliance
 * const violations = checkSLOs();
 * if (violations.length > 0) {
 *   alertOncall(violations);
 * }
 * ```
 */

export type AgentType = "router" | "analytics" | "trading" | "security";

export interface SLOTarget {
  /** Target name for identification */
  name: string;
  /** Target value (e.g., latency in ms, percentage as decimal) */
  target: number;
  /** Current measured value */
  current: number;
  /** Whether the SLO is being met */
  met: boolean;
  /** Severity if violated: warning or critical */
  severity: "warning" | "critical";
}

export interface SLOViolation {
  /** SLO target that was violated */
  target: SLOTarget;
  /** Timestamp of violation detection */
  timestamp: string;
  /** Human-readable description */
  message: string;
}

// SLO Targets (production values)
const SLO_TARGETS = {
  // Latency targets (p95 in milliseconds)
  latency: {
    router: { p95: 500, severity: "critical" as const },
    analytics: { p95: 800, severity: "warning" as const },
    trading: { p95: 1500, severity: "warning" as const },
    security: { p95: 600, severity: "critical" as const },
  },
  // First token latency (p95 in milliseconds) - time to first streaming response
  firstToken: {
    router: { p95: 300, severity: "warning" as const },
    analytics: { p95: 800, severity: "warning" as const },
    trading: { p95: 1000, severity: "warning" as const },
    security: { p95: 500, severity: "warning" as const },
  },
  // Success rates (minimum percentage as decimal)
  toolCallSuccessRate: { min: 0.99, severity: "critical" as const },
  // Cache hit rates (minimum percentage as decimal)
  cacheHitRate: { min: 0.7, severity: "warning" as const },
} as const;

// In-memory metrics storage (in production, use Redis or similar)
interface MetricsStore {
  latencies: Map<AgentType, number[]>;
  firstTokenLatencies: Map<AgentType, number[]>;
  toolCalls: { success: number; failure: number };
  cacheHits: { hits: number; misses: number };
  lastReset: number;
}

const metrics: MetricsStore = {
  latencies: new Map([
    ["router", []],
    ["analytics", []],
    ["trading", []],
    ["security", []],
  ]),
  firstTokenLatencies: new Map([
    ["router", []],
    ["analytics", []],
    ["trading", []],
    ["security", []],
  ]),
  toolCalls: { success: 0, failure: 0 },
  cacheHits: { hits: 0, misses: 0 },
  lastReset: Date.now(),
};

// Maximum samples to keep in memory (rolling window)
const MAX_SAMPLES = 1000;

/**
 * Record agent latency for SLO tracking
 *
 * @param agent - Agent type
 * @param latencyMs - Latency in milliseconds
 */
export function recordLatency(agent: AgentType, latencyMs: number): void {
  const latencies = metrics.latencies.get(agent);
  if (latencies) {
    latencies.push(latencyMs);
    // Keep only recent samples
    if (latencies.length > MAX_SAMPLES) {
      latencies.shift();
    }
  }
}

/**
 * Record first token latency (time to first streaming response)
 *
 * @param agent - Agent type
 * @param latencyMs - Latency in milliseconds
 */
export function recordFirstTokenLatency(agent: AgentType, latencyMs: number): void {
  const latencies = metrics.firstTokenLatencies.get(agent);
  if (latencies) {
    latencies.push(latencyMs);
    if (latencies.length > MAX_SAMPLES) {
      latencies.shift();
    }
  }
}

/**
 * Record tool call result for success rate tracking
 *
 * @param toolName - Name of the tool
 * @param success - Whether the tool call succeeded
 */
export function recordToolCall(toolName: string, success: boolean): void {
  if (success) {
    metrics.toolCalls.success++;
  } else {
    metrics.toolCalls.failure++;
  }
}

/**
 * Record cache hit or miss for cache hit rate tracking
 *
 * @param hit - Whether it was a cache hit
 */
export function recordCacheEvent(hit: boolean): void {
  if (hit) {
    metrics.cacheHits.hits++;
  } else {
    metrics.cacheHits.misses++;
  }
}

/**
 * Calculate percentile from sorted array
 *
 * @param sortedValues - Sorted array of values
 * @param percentile - Percentile to calculate (0-1)
 * @returns Percentile value or null if insufficient data
 */
function calculatePercentile(sortedValues: number[], percentile: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.ceil(sortedValues.length * percentile) - 1;
  return sortedValues[Math.max(0, index)];
}

/**
 * Get current SLO metrics
 *
 * @returns Array of SLO targets with current values
 */
export function getSLOMetrics(): SLOTarget[] {
  const targets: SLOTarget[] = [];

  // Latency SLOs
  for (const [agent, target] of Object.entries(SLO_TARGETS.latency)) {
    const latencies = metrics.latencies.get(agent as AgentType) || [];
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = calculatePercentile(sorted, 0.95);

    targets.push({
      name: `${agent}_latency_p95`,
      target: target.p95,
      current: p95 ?? 0,
      met: p95 === null || p95 <= target.p95,
      severity: target.severity,
    });
  }

  // First token latency SLOs
  for (const [agent, target] of Object.entries(SLO_TARGETS.firstToken)) {
    const latencies = metrics.firstTokenLatencies.get(agent as AgentType) || [];
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = calculatePercentile(sorted, 0.95);

    targets.push({
      name: `${agent}_first_token_p95`,
      target: target.p95,
      current: p95 ?? 0,
      met: p95 === null || p95 <= target.p95,
      severity: target.severity,
    });
  }

  // Tool call success rate SLO
  const totalToolCalls = metrics.toolCalls.success + metrics.toolCalls.failure;
  const toolSuccessRate =
    totalToolCalls > 0 ? metrics.toolCalls.success / totalToolCalls : 1;

  targets.push({
    name: "tool_call_success_rate",
    target: SLO_TARGETS.toolCallSuccessRate.min,
    current: toolSuccessRate,
    met: toolSuccessRate >= SLO_TARGETS.toolCallSuccessRate.min,
    severity: SLO_TARGETS.toolCallSuccessRate.severity,
  });

  // Cache hit rate SLO
  const totalCacheEvents = metrics.cacheHits.hits + metrics.cacheHits.misses;
  const cacheHitRate =
    totalCacheEvents > 0 ? metrics.cacheHits.hits / totalCacheEvents : 1;

  targets.push({
    name: "cache_hit_rate",
    target: SLO_TARGETS.cacheHitRate.min,
    current: cacheHitRate,
    met: cacheHitRate >= SLO_TARGETS.cacheHitRate.min,
    severity: SLO_TARGETS.cacheHitRate.severity,
  });

  return targets;
}

/**
 * Check for SLO violations
 *
 * @returns Array of SLO violations
 */
export function checkSLOs(): SLOViolation[] {
  const targets = getSLOMetrics();
  const violations: SLOViolation[] = [];

  for (const target of targets) {
    if (!target.met) {
      violations.push({
        target,
        timestamp: new Date().toISOString(),
        message: formatViolationMessage(target),
      });
    }
  }

  return violations;
}

/**
 * Format a human-readable violation message
 */
function formatViolationMessage(target: SLOTarget): string {
  if (target.name.includes("latency") || target.name.includes("first_token")) {
    return `${target.name}: ${target.current.toFixed(0)}ms exceeds target of ${target.target}ms`;
  } else {
    const currentPercent = (target.current * 100).toFixed(2);
    const targetPercent = (target.target * 100).toFixed(2);
    return `${target.name}: ${currentPercent}% below target of ${targetPercent}%`;
  }
}

/**
 * Reset all metrics (useful for testing or periodic resets)
 */
export function resetMetrics(): void {
  for (const latencies of Array.from(metrics.latencies.values())) {
    latencies.length = 0;
  }
  for (const latencies of Array.from(metrics.firstTokenLatencies.values())) {
    latencies.length = 0;
  }
  metrics.toolCalls = { success: 0, failure: 0 };
  metrics.cacheHits = { hits: 0, misses: 0 };
  metrics.lastReset = Date.now();
}

/**
 * Get metrics summary for monitoring dashboards
 *
 * @returns Summary object with key metrics
 */
export function getMetricsSummary() {
  const targets = getSLOMetrics();
  const violations = checkSLOs();

  return {
    timestamp: new Date().toISOString(),
    lastReset: new Date(metrics.lastReset).toISOString(),
    sampleCounts: {
      router: metrics.latencies.get("router")?.length ?? 0,
      analytics: metrics.latencies.get("analytics")?.length ?? 0,
      trading: metrics.latencies.get("trading")?.length ?? 0,
      security: metrics.latencies.get("security")?.length ?? 0,
    },
    toolCalls: {
      total: metrics.toolCalls.success + metrics.toolCalls.failure,
      success: metrics.toolCalls.success,
      failure: metrics.toolCalls.failure,
    },
    cache: {
      total: metrics.cacheHits.hits + metrics.cacheHits.misses,
      hits: metrics.cacheHits.hits,
      misses: metrics.cacheHits.misses,
    },
    slos: targets,
    violations,
  };
}

export interface AlertWebhookConfig {
  /** Webhook URL to POST violation payloads to */
  url: string;
  /** Optional Bearer token for Authorization header */
  token?: string;
  /** Only fire for this severity level or above ("warning" fires for both; "critical" fires only for critical) */
  minSeverity?: "warning" | "critical";
}

/** Registered webhook configs — set via configureAlertWebhooks() */
let _webhooks: AlertWebhookConfig[] = [];

/** Register webhook endpoints for SLO violation alerts */
export function configureAlertWebhooks(configs: AlertWebhookConfig[]): void {
  _webhooks = configs;
}

/** Clear all registered webhooks (useful in tests) */
export function clearAlertWebhooks(): void {
  _webhooks = [];
}

async function postWebhook(
  config: AlertWebhookConfig,
  payload: object
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;
  try {
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook delivery failures must not crash the agent
  }
}

/**
 * Alert on SLO violations.
 * Logs to console and fires any registered webhooks.
 */
export function alertOnViolations(violations: SLOViolation[]): void {
  if (violations.length === 0) return;

  const critical = violations.filter((v) => v.target.severity === "critical");
  const warnings = violations.filter((v) => v.target.severity === "warning");

  if (critical.length > 0) {
    console.error("[SLO CRITICAL]", {
      count: critical.length,
      violations: critical.map((v) => v.message),
    });
  }

  if (warnings.length > 0) {
    console.warn("[SLO WARNING]", {
      count: warnings.length,
      violations: warnings.map((v) => v.message),
    });
  }

  if (_webhooks.length === 0) return;

  const payload = {
    timestamp: new Date().toISOString(),
    critical: critical.map((v) => ({ name: v.target.name, message: v.message, current: v.target.current, target: v.target.target })),
    warnings: warnings.map((v) => ({ name: v.target.name, message: v.message, current: v.target.current, target: v.target.target })),
  };

  for (const cfg of _webhooks) {
    const minSev = cfg.minSeverity ?? "warning";
    const shouldFire =
      (minSev === "warning" && violations.length > 0) ||
      (minSev === "critical" && critical.length > 0);
    if (shouldFire) {
      postWebhook(cfg, payload);
    }
  }
}

/**
 * Middleware to automatically track request latency
 *
 * @param agent - Agent type
 * @param fn - Async function to execute and measure
 * @returns Promise resolving to the function's return value
 *
 * @example
 * ```typescript
 * const result = await withLatencyTracking('router', async () => {
 *   return await processRouterRequest(message);
 * });
 * ```
 */
export async function withLatencyTracking<T>(
  agent: AgentType,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    recordLatency(agent, Date.now() - startTime);
    return result;
  } catch (error) {
    recordLatency(agent, Date.now() - startTime);
    throw error;
  }
}
