/**
 * Production Patterns Quick Reference
 *
 * This file provides a quick reference for the three production-ready patterns
 * implemented for the Stellar-Pay agent system.
 */

// =============================================================================
// 1. CIRCUIT BREAKER PATTERN
// =============================================================================

/*
PURPOSE:
Prevent cascading failures by temporarily blocking requests to failing services.

WHEN TO USE:
- External API calls (Stellar Horizon, price feeds)
- Contract invocations
- Database queries
- Any operation that can fail repeatedly

STATES:
- CLOSED: Normal operation, requests pass through
- OPEN: Service is failing, requests are rejected immediately
- HALF_OPEN: Testing if service has recovered

EXAMPLE:
```typescript
import { createProductionCircuitBreaker } from './circuit-breaker';

const horizonBreaker = createProductionCircuitBreaker('stellar-horizon', {
  failureThreshold: 5,    // Open after 5 failures
  resetTimeout: 60000,    // Try again after 60s
  successThreshold: 2     // Close after 2 successes
});

async function fetchPoolData(poolId: string) {
  return horizonBreaker.execute(async () => {
    const response = await fetch(`https://horizon.stellar.org/pools/${poolId}`);
    if (!response.ok) throw new Error('API error');
    return response.json();
  });
}
```

KEY METHODS:
- execute<T>(fn: () => Promise<T>): Promise<T> - Execute with protection
- getStats(): CircuitBreakerStats - Get current statistics
- reset(): void - Manually reset to CLOSED state
- getState(): CircuitState - Get current state
*/

// =============================================================================
// 2. STRUCTURED LOGGING WITH CORRELATION IDS
// =============================================================================

/*
PURPOSE:
Enable distributed tracing across async operations with automatic context propagation.

WHEN TO USE:
- All API request handlers
- Agent processing functions
- Tool executions
- Any operation that needs to be traced

FEATURES:
- Automatic requestId and userId propagation
- JSON-formatted logs for log aggregation systems
- Agent-specific loggers
- Execution time measurement

EXAMPLE:
```typescript
import { withRequestContext, log, createAgentLogger, generateRequestId } from './logger';

// In API handler
async function handleRequest(req, res) {
  await withRequestContext(
    { requestId: generateRequestId(), userId: req.user.id },
    async () => {
      log('info', 'Processing request', { endpoint: req.path });
      const result = await processRequest(req.body);
      res.json(result);
    }
  );
}

// In nested functions - context is automatic
async function processRequest(data) {
  log('debug', 'Starting processing'); // Includes requestId/userId automatically
  return await doWork(data);
}

// Agent-specific logger
const tradingLogger = createAgentLogger('trading');
tradingLogger.info('Trade executed', { amount: 1000, token: 'USDC' });
```

KEY FUNCTIONS:
- withRequestContext<T>(context, fn): Promise<T> - Execute with context
- log(level, message, metadata) - Log with automatic context
- createAgentLogger(agentName) - Create agent-specific logger
- generateRequestId(): string - Generate unique request ID
- measureTime<T>(label, fn): Promise<T> - Measure execution time
- logError(message, error, metadata) - Log errors with stack traces
*/

// =============================================================================
// 3. AGENT SLOs (SERVICE LEVEL OBJECTIVES)
// =============================================================================

/*
PURPOSE:
Track and alert on agent performance metrics to ensure production quality.

WHEN TO USE:
- All agent invocations
- Tool executions
- Cache operations
- Any performance-critical operation

SLO TARGETS:
- Router latency (p95) < 500ms [CRITICAL]
- Analytics first token (p95) < 800ms [WARNING]
- Trading simulation (p95) < 1.5s [WARNING]
- Security latency (p95) < 600ms [CRITICAL]
- Tool call success rate > 99% [CRITICAL]
- Cache hit rate > 70% [WARNING]

EXAMPLE:
```typescript
import {
  recordLatency,
  recordFirstTokenLatency,
  recordToolCall,
  recordCacheEvent,
  checkSLOs,
  alertOnViolations,
  withLatencyTracking
} from './slos';

// Manual tracking
const startTime = Date.now();
await processRequest();
recordLatency('router', Date.now() - startTime);

// Automatic tracking with wrapper
const result = await withLatencyTracking('router', async () => {
  return await processRequest();
});

// Tool call tracking
try {
  const result = await executeTool('get-balance');
  recordToolCall('get-balance', true);
} catch (error) {
  recordToolCall('get-balance', false);
}

// Cache tracking
const cached = cache.get(key);
recordCacheEvent(cached !== undefined);

// Periodic SLO checking
setInterval(() => {
  const violations = checkSLOs();
  if (violations.length > 0) {
    alertOnViolations(violations);
  }
}, 60000);
```

KEY FUNCTIONS:
- recordLatency(agent, latencyMs) - Record agent latency
- recordFirstTokenLatency(agent, latencyMs) - Record streaming latency
- recordToolCall(toolName, success) - Record tool success/failure
- recordCacheEvent(hit) - Record cache hit/miss
- checkSLOs(): SLOViolation[] - Check for violations
- alertOnViolations(violations) - Alert on violations
- withLatencyTracking<T>(agent, fn): Promise<T> - Auto-track latency
- getSLOMetrics(): SLOTarget[] - Get current metrics
- getMetricsSummary() - Get comprehensive summary
*/

// =============================================================================
// INTEGRATION PATTERN
// =============================================================================

/*
RECOMMENDED PATTERN:
Combine all three patterns for production-ready agents.

```typescript
import { createProductionCircuitBreaker } from './circuit-breaker';
import { withRequestContext, createAgentLogger, generateRequestId, logError } from './logger';
import { withLatencyTracking, recordToolCall } from './slos';

const contractBreaker = createProductionCircuitBreaker('contract-call');

export async function productionAgent(userId: string, input: unknown) {
  const requestId = generateRequestId();

  return withRequestContext({ requestId, userId, agentName: 'trading' }, async () => {
    return withLatencyTracking('trading', async () => {
      const logger = createAgentLogger('trading');

      logger.info('Agent started', { input });

      try {
        // Use circuit breaker for risky operations
        const result = await contractBreaker.execute(async () => {
          return await executeOperation(input);
        });

        recordToolCall('trading_operation', true);
        logger.info('Agent completed', { result });
        return result;

      } catch (error) {
        recordToolCall('trading_operation', false);
        logError('Agent failed', error, { input });
        throw error;
      }
    });
  });
}
```

BENEFITS:
✓ Automatic failure isolation (Circuit Breaker)
✓ Full request tracing (Structured Logging)
✓ Performance monitoring (SLO Tracking)
✓ Production-ready error handling
✓ Observable and debuggable
*/

// =============================================================================
// MONITORING & ALERTING
// =============================================================================

/*
DASHBOARD METRICS:
1. Circuit Breaker Health
   - State (CLOSED/OPEN/HALF_OPEN)
   - Failure count
   - Success rate
   - Last failure time

2. Request Traces
   - Filter by requestId
   - Filter by userId
   - Filter by agentName
   - View full execution timeline

3. SLO Compliance
   - Latency percentiles (p50, p95, p99)
   - Success rates
   - Cache hit rates
   - Violation alerts

ALERTING RULES:
- CRITICAL: Circuit breaker OPEN for > 5 minutes
- CRITICAL: Tool call success rate < 99%
- CRITICAL: Router/Security latency p95 > target
- WARNING: Cache hit rate < 70%
- WARNING: Analytics/Trading latency p95 > target

EXAMPLE MONITORING ENDPOINT:
```typescript
import { getMonitoringData } from './production-patterns-example';

app.get('/api/monitoring', (req, res) => {
  res.json(getMonitoringData());
});
```
*/

export {};
