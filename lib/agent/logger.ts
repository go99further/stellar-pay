/**
 * Structured Logging with Correlation IDs
 *
 * Provides request-scoped context using AsyncLocalStorage for distributed tracing.
 * All logs include requestId and userId when available, enabling correlation across
 * multiple services and async operations.
 *
 * @example
 * ```typescript
 * import { withRequestContext, log } from './logger';
 *
 * // In your API handler
 * app.post('/api/chat', async (req, res) => {
 *   await withRequestContext(
 *     { requestId: req.id, userId: req.user?.id },
 *     async () => {
 *       log('info', 'Processing chat request', { message: req.body.message });
 *       const result = await processChat(req.body);
 *       log('info', 'Chat request completed', { tokensUsed: result.tokens });
 *       res.json(result);
 *     }
 *   );
 * });
 *
 * // In nested functions - context is automatically propagated
 * async function processChat(input: string) {
 *   log('debug', 'Starting LLM call'); // Includes requestId/userId automatically
 *   const response = await callLLM(input);
 *   return response;
 * }
 * ```
 */

import { AsyncLocalStorage } from "async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestContext {
  requestId: string;
  userId?: string;
  agentName?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  agentName?: string;
  [key: string]: unknown;
}

// AsyncLocalStorage for request-scoped context
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Execute a function within a request context
 *
 * All log calls within this context (including nested async calls) will
 * automatically include the requestId and userId.
 *
 * @param context - Request context containing requestId and optional userId
 * @param fn - Async function to execute within the context
 * @returns Promise resolving to the function's return value
 */
export async function withRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request context
 *
 * @returns Current request context or undefined if not in a context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Log a structured message with automatic context injection
 *
 * @param level - Log level (debug, info, warn, error)
 * @param message - Human-readable log message
 * @param metadata - Additional structured data to include in the log
 */
export function log(
  level: LogLevel,
  message: string,
  metadata: Record<string, unknown> = {}
): void {
  const context = getRequestContext();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
    ...metadata,
  };

  // Output as JSON for structured logging systems (e.g., CloudWatch, Datadog)
  const output = JSON.stringify(entry);

  // Route to appropriate console method
  switch (level) {
    case "debug":
      console.debug(output);
      break;
    case "info":
      console.info(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "error":
      console.error(output);
      break;
  }
}

/**
 * Create a logger instance bound to a specific agent
 *
 * Useful for agent-specific logging where you want to automatically
 * include the agent name in all logs.
 *
 * @param agentName - Name of the agent (e.g., "router", "trading", "analytics")
 * @returns Logger functions bound to the agent name
 *
 * @example
 * ```typescript
 * const logger = createAgentLogger('trading');
 * logger.info('Starting trade simulation', { amount: 1000 });
 * // Output includes: { agentName: "trading", message: "Starting trade simulation", ... }
 * ```
 */
export function createAgentLogger(agentName: string) {
  return {
    debug: (message: string, metadata?: Record<string, unknown>) =>
      log("debug", message, { agentName, ...metadata }),
    info: (message: string, metadata?: Record<string, unknown>) =>
      log("info", message, { agentName, ...metadata }),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      log("warn", message, { agentName, ...metadata }),
    error: (message: string, metadata?: Record<string, unknown>) =>
      log("error", message, { agentName, ...metadata }),
  };
}

/**
 * Generate a unique request ID
 *
 * Uses timestamp + random string for uniqueness.
 * Format: req_<timestamp>_<random>
 *
 * @returns Unique request ID string
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `req_${timestamp}_${random}`;
}

/**
 * Measure and log execution time of an async function
 *
 * @param label - Label for the operation being measured
 * @param fn - Async function to measure
 * @returns Promise resolving to the function's return value
 *
 * @example
 * ```typescript
 * const result = await measureTime('LLM call', async () => {
 *   return await anthropic.messages.create({ ... });
 * });
 * // Logs: { message: "LLM call completed", durationMs: 1234 }
 * ```
 */
export async function measureTime<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - startTime;
    log("info", `${label} completed`, { durationMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    log("error", `${label} failed`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Log an error with full stack trace and context
 *
 * @param message - Error description
 * @param error - Error object
 * @param metadata - Additional context
 */
export function logError(
  message: string,
  error: unknown,
  metadata: Record<string, unknown> = {}
): void {
  const errorDetails =
    error instanceof Error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : { error: String(error) };

  log("error", message, {
    ...errorDetails,
    ...metadata,
  });
}
