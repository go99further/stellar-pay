/**
 * Production Patterns Integration Example
 *
 * This file demonstrates how to integrate Circuit Breaker, Structured Logging,
 * and SLO tracking patterns into the agent system.
 *
 * DO NOT import this file in production code - it's for reference only.
 */

import { CircuitBreaker, createProductionCircuitBreaker } from "./circuit-breaker";
import {
  withRequestContext,
  log,
  createAgentLogger,
  generateRequestId,
  measureTime,
  logError,
} from "./logger";
import {
  recordLatency,
  recordFirstTokenLatency,
  recordToolCall,
  recordCacheEvent,
  checkSLOs,
  alertOnViolations,
  withLatencyTracking,
  getMetricsSummary,
} from "./slos";
import type { AgentMessage, RouterOutput } from "./types";

// ---------------------------------------------------------------------------
// Example 1: Circuit Breaker for External API Calls
// ---------------------------------------------------------------------------

// Create circuit breakers for different services
const stellarHorizonBreaker = createProductionCircuitBreaker("stellar-horizon", {
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds for external APIs
});

const contractCallBreaker = createProductionCircuitBreaker("contract-call", {
  failureThreshold: 5,
  resetTimeout: 60000,
});

/**
 * Example: Fetch pool data with circuit breaker protection
 */
async function fetchPoolDataWithCircuitBreaker(poolId: string) {
  return stellarHorizonBreaker.execute(async () => {
    const response = await fetch(`https://horizon.stellar.org/pools/${poolId}`);
    if (!response.ok) {
      throw new Error(`Horizon API error: ${response.status}`);
    }
    return response.json();
  });
}

/**
 * Example: Contract call with circuit breaker
 */
async function callContractWithCircuitBreaker(contractId: string, method: string) {
  return contractCallBreaker.execute(async () => {
    // Simulate contract call
    const result = await simulateContractCall(contractId, method);
    return result;
  });
}

async function simulateContractCall(contractId: string, method: string) {
  // Placeholder for actual contract call
  return { success: true, data: {} };
}

// ---------------------------------------------------------------------------
// Example 2: Structured Logging with Request Context
// ---------------------------------------------------------------------------

/**
 * Example: API handler with request context
 */
async function handleChatRequest(
  userId: string,
  message: string
): Promise<{ response: string; tokensUsed: number }> {
  const requestId = generateRequestId();

  return withRequestContext({ requestId, userId }, async () => {
    log("info", "Chat request received", { messageLength: message.length });

    try {
      // Process the chat request
      const result = await processChat(message);

      log("info", "Chat request completed", {
        tokensUsed: result.tokensUsed,
        responseLength: result.response.length,
      });

      return result;
    } catch (error) {
      logError("Chat request failed", error, { message });
      throw error;
    }
  });
}

async function processChat(
  message: string
): Promise<{ response: string; tokensUsed: number }> {
  // This function automatically inherits the request context
  log("debug", "Starting LLM call");

  // Simulate LLM call
  await new Promise((resolve) => setTimeout(resolve, 100));

  log("debug", "LLM call completed");

  return {
    response: "Simulated response",
    tokensUsed: 150,
  };
}

// ---------------------------------------------------------------------------
// Example 3: Agent-Specific Logger
// ---------------------------------------------------------------------------

const routerLogger = createAgentLogger("router");
const tradingLogger = createAgentLogger("trading");
const analyticsLogger = createAgentLogger("analytics");

async function routerAgentExample(history: AgentMessage[]) {
  routerLogger.info("Classifying user intent", { historyLength: history.length });

  try {
    const intent = await classifyIntent(history);
    routerLogger.info("Intent classified", { intent: intent.intent });
    return intent;
  } catch (error) {
    routerLogger.error("Intent classification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function classifyIntent(history: AgentMessage[]): Promise<RouterOutput> {
  // Placeholder
  return { intent: "analytics", reason: "User asked about pool stats" };
}

// ---------------------------------------------------------------------------
// Example 4: SLO Tracking
// ---------------------------------------------------------------------------

/**
 * Example: Router agent with SLO tracking
 */
async function routerWithSLOTracking(history: AgentMessage[]): Promise<RouterOutput> {
  const startTime = Date.now();
  let firstTokenTime: number | null = null;

  try {
    // Simulate first token
    await new Promise((resolve) => setTimeout(resolve, 50));
    firstTokenTime = Date.now();
    recordFirstTokenLatency("router", firstTokenTime - startTime);

    // Complete the request
    const result = await classifyIntent(history);

    // Record total latency
    recordLatency("router", Date.now() - startTime);

    return result;
  } catch (error) {
    recordLatency("router", Date.now() - startTime);
    throw error;
  }
}

/**
 * Example: Tool call with success tracking
 */
async function executeToolWithTracking(toolName: string, input: unknown) {
  try {
    const result = await executeTool(toolName, input);
    recordToolCall(toolName, true);
    return result;
  } catch (error) {
    recordToolCall(toolName, false);
    throw error;
  }
}

async function executeTool(toolName: string, input: unknown) {
  // Placeholder
  return { success: true };
}

/**
 * Example: Cache hit/miss tracking
 */
async function getCachedData<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    recordCacheEvent(true);
    return cached as T;
  }

  recordCacheEvent(false);
  const data = await fetchFn();
  cache.set(key, data);
  return data;
}

const cache = new Map<string, unknown>();

/**
 * Example: Periodic SLO checking
 */
function startSLOMonitoring(intervalMs: number = 60000) {
  setInterval(() => {
    const violations = checkSLOs();
    if (violations.length > 0) {
      alertOnViolations(violations);
    }

    // Log metrics summary
    const summary = getMetricsSummary();
    log("info", "SLO metrics summary", summary);
  }, intervalMs);
}

// ---------------------------------------------------------------------------
// Example 5: Complete Integration - Router Agent
// ---------------------------------------------------------------------------

/**
 * Production-ready router agent with all patterns integrated
 */
export async function productionRouterAgent(
  userId: string,
  history: AgentMessage[]
): Promise<RouterOutput> {
  const requestId = generateRequestId();

  return withRequestContext({ requestId, userId, agentName: "router" }, async () => {
    return withLatencyTracking("router", async () => {
      const logger = createAgentLogger("router");

      logger.info("Router agent started", { historyLength: history.length });

      try {
        // Measure time to first token
        const result = await measureTime("classify_intent", async () => {
          return await classifyIntent(history);
        });

        logger.info("Router agent completed", { intent: result.intent });
        return result;
      } catch (error) {
        logError("Router agent failed", error);
        return {
          intent: "clarify",
          reason: "Router error occurred",
        };
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Example 6: Trading Agent with Circuit Breaker + SLO
// ---------------------------------------------------------------------------

/**
 * Production-ready trading agent with circuit breaker and SLO tracking
 */
export async function productionTradingAgent(
  userId: string,
  operation: "swap" | "add_liquidity" | "remove_liquidity",
  params: unknown
): Promise<{ success: boolean; txHash?: string }> {
  const requestId = generateRequestId();

  return withRequestContext({ requestId, userId, agentName: "trading" }, async () => {
    return withLatencyTracking("trading", async () => {
      const logger = createAgentLogger("trading");

      logger.info("Trading agent started", { operation });

      try {
        // Use circuit breaker for contract calls
        const result = await contractCallBreaker.execute(async () => {
          return await executeTradeOperation(operation, params);
        });

        // Record successful tool call
        recordToolCall(`trading_${operation}`, true);

        logger.info("Trading agent completed", { txHash: result.txHash });
        return result;
      } catch (error) {
        // Record failed tool call
        recordToolCall(`trading_${operation}`, false);

        logError("Trading agent failed", error, { operation });
        return { success: false };
      }
    });
  });
}

async function executeTradeOperation(
  operation: string,
  params: unknown
): Promise<{ success: boolean; txHash: string }> {
  // Placeholder
  return { success: true, txHash: "0x123..." };
}

// ---------------------------------------------------------------------------
// Example 7: Monitoring Dashboard Data
// ---------------------------------------------------------------------------

/**
 * Get comprehensive monitoring data for dashboards
 */
export function getMonitoringData() {
  return {
    circuitBreakers: {
      stellarHorizon: stellarHorizonBreaker.getStats(),
      contractCall: contractCallBreaker.getStats(),
    },
    slos: getMetricsSummary(),
  };
}

// ---------------------------------------------------------------------------
// Usage Summary
// ---------------------------------------------------------------------------

/*
INTEGRATION CHECKLIST:

1. Circuit Breaker:
   - Create breakers for external APIs and contract calls
   - Wrap risky operations with breaker.execute()
   - Monitor breaker state in dashboards

2. Structured Logging:
   - Wrap request handlers with withRequestContext()
   - Use log() or createAgentLogger() for all logging
   - Include relevant metadata in log calls

3. SLO Tracking:
   - Record latency for all agent calls
   - Record first token latency for streaming responses
   - Record tool call success/failure
   - Record cache hits/misses
   - Run periodic SLO checks
   - Alert on violations

4. Integration:
   - Combine all three patterns in production agents
   - Use withLatencyTracking() wrapper for automatic SLO recording
   - Use measureTime() for operation-level timing
   - Export monitoring data for dashboards
*/
