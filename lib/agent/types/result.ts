/**
 * Discriminated Error Union
 *
 * Inspired by Plandex's type-safe error handling:
 * - Result<T, E> type instead of exceptions
 * - Discriminated union for error types
 * - Exhaustive error handling
 * - Composable error chains
 *
 * Pattern: Result<T, E> = Ok<T> | Err<E>
 */

// ── Core Result Type ──────────────────────────────────────────────────────────

export type Result<T, E = AgentError> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const Ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const Err = <E>(error: E): Err<E> => ({ ok: false, error });

// ── Agent Error Types ─────────────────────────────────────────────────────────

export type AgentError =
  | ValidationError
  | NetworkError
  | ContractError
  | UserError
  | SystemError
  | TimeoutError
  | RateLimitError;

export interface ValidationError {
  readonly kind: "validation";
  readonly field: string;
  readonly message: string;
  readonly suggestion?: string;
}

export interface NetworkError {
  readonly kind: "network";
  readonly code?: number;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ContractError {
  readonly kind: "contract";
  readonly contractId: string;
  readonly method: string;
  readonly message: string;
  readonly panicCode?: string;
}

export interface UserError {
  readonly kind: "user";
  readonly action: string;
  readonly message: string;
}

export interface SystemError {
  readonly kind: "system";
  readonly component: string;
  readonly message: string;
  readonly fatal: boolean;
}

export interface TimeoutError {
  readonly kind: "timeout";
  readonly operation: string;
  readonly timeoutMs: number;
}

export interface RateLimitError {
  readonly kind: "rate_limit";
  readonly service: string;
  readonly retryAfterMs: number;
}

// ── Error Constructors ────────────────────────────────────────────────────────

export const AgentErrors = {
  validation: (field: string, message: string, suggestion?: string): ValidationError => ({
    kind: "validation",
    field,
    message,
    suggestion,
  }),

  network: (message: string, retryable: boolean, code?: number): NetworkError => ({
    kind: "network",
    code,
    message,
    retryable,
  }),

  contract: (contractId: string, method: string, message: string, panicCode?: string): ContractError => ({
    kind: "contract",
    contractId,
    method,
    message,
    panicCode,
  }),

  user: (action: string, message: string): UserError => ({
    kind: "user",
    action,
    message,
  }),

  system: (component: string, message: string, fatal: boolean = false): SystemError => ({
    kind: "system",
    component,
    message,
    fatal,
  }),

  timeout: (operation: string, timeoutMs: number): TimeoutError => ({
    kind: "timeout",
    operation,
    timeoutMs,
  }),

  rateLimit: (service: string, retryAfterMs: number): RateLimitError => ({
    kind: "rate_limit",
    service,
    retryAfterMs,
  }),
};

// ── Result Utilities ──────────────────────────────────────────────────────────

/**
 * Map over Ok value
 */
export function mapOk<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return Ok(fn(result.value));
  }
  return result;
}

/**
 * Map over Err value
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  if (!result.ok) {
    return Err(fn(result.error));
  }
  return result;
}

/**
 * Chain results (flatMap)
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Unwrap value or throw
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Unwrap failed: ${JSON.stringify(result.error)}`);
}

/**
 * Unwrap value or return default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Combine multiple results
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];

  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }

  return Ok(values);
}

/**
 * Wrap async function to return Result
 */
export async function tryAsync<T>(
  fn: () => Promise<T>
): Promise<Result<T, AgentError>> {
  try {
    const value = await fn();
    return Ok(value);
  } catch (error) {
    return Err(classifyError(error));
  }
}

/**
 * Wrap sync function to return Result
 */
export function trySync<T>(fn: () => T): Result<T, AgentError> {
  try {
    const value = fn();
    return Ok(value);
  } catch (error) {
    return Err(classifyError(error));
  }
}

/**
 * Classify unknown error into AgentError
 */
function classifyError(error: unknown): AgentError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("timeout")) {
      return AgentErrors.timeout("unknown", 30000);
    }

    if (msg.includes("rate limit") || msg.includes("429")) {
      return AgentErrors.rateLimit("api", 5000);
    }

    if (msg.includes("network") || msg.includes("connection")) {
      return AgentErrors.network(error.message, true);
    }

    if (msg.includes("contract") || msg.includes("panic")) {
      return AgentErrors.contract("unknown", "unknown", error.message);
    }

    if (msg.includes("invalid") || msg.includes("validation")) {
      return AgentErrors.validation("unknown", error.message);
    }

    return AgentErrors.system("unknown", error.message);
  }

  return AgentErrors.system("unknown", String(error));
}

/**
 * Exhaustive error handler
 * TypeScript will error if not all cases are handled
 */
export function handleError(error: AgentError): string {
  switch (error.kind) {
    case "validation":
      return `Validation error on ${error.field}: ${error.message}${error.suggestion ? ` (${error.suggestion})` : ""}`;

    case "network":
      return `Network error${error.code ? ` (${error.code})` : ""}: ${error.message}${error.retryable ? " (retryable)" : ""}`;

    case "contract":
      return `Contract error in ${error.contractId}.${error.method}: ${error.message}${error.panicCode ? ` [${error.panicCode}]` : ""}`;

    case "user":
      return `User action "${error.action}" failed: ${error.message}`;

    case "system":
      return `System error in ${error.component}: ${error.message}${error.fatal ? " (FATAL)" : ""}`;

    case "timeout":
      return `Operation "${error.operation}" timed out after ${error.timeoutMs}ms`;

    case "rate_limit":
      return `Rate limited by ${error.service}, retry after ${error.retryAfterMs}ms`;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = error;
      return `Unknown error: ${JSON.stringify(_exhaustive)}`;
    }
  }
}

/**
 * Check if error is retryable
 */
export function isRetryable(error: AgentError): boolean {
  switch (error.kind) {
    case "network":
      return error.retryable;
    case "rate_limit":
      return true;
    case "timeout":
      return true;
    case "validation":
    case "user":
    case "contract":
    case "system":
      return false;
    default:
      return false;
  }
}

/**
 * Get retry delay for error
 */
export function getRetryDelay(error: AgentError): number {
  switch (error.kind) {
    case "rate_limit":
      return error.retryAfterMs;
    case "timeout":
      return 1000;
    case "network":
      return 2000;
    default:
      return 0;
  }
}

/**
 * Usage example:
 *
 * // Basic usage
 * async function fetchPoolReserves(): Promise<Result<PoolReserves, AgentError>> {
 *   return tryAsync(async () => {
 *     const response = await stellarClient.loadAccount(contractId);
 *     return parseReserves(response);
 *   });
 * }
 *
 * const result = await fetchPoolReserves();
 *
 * if (result.ok) {
 *   console.log("Reserves:", result.value);
 * } else {
 *   console.error("Error:", handleError(result.error));
 *
 *   if (isRetryable(result.error)) {
 *     const delay = getRetryDelay(result.error);
 *     await sleep(delay);
 *     // retry...
 *   }
 * }
 *
 * // Chaining results
 * const finalResult = await fetchPoolReserves()
 *   .then(r => andThen(r, reserves => calculateSwap(reserves, amountIn)))
 *   .then(r => andThen(r, swap => buildXdr(swap)));
 *
 * // Combining results
 * const [reservesResult, balanceResult] = await Promise.all([
 *   fetchPoolReserves(),
 *   fetchUserBalance(address),
 * ]);
 *
 * const combined = combine([reservesResult, balanceResult]);
 * if (combined.ok) {
 *   const [reserves, balance] = combined.value;
 * }
 *
 * // Explicit error construction
 * function validateAmount(amount: bigint): Result<bigint, AgentError> {
 *   if (amount <= 0n) {
 *     return Err(AgentErrors.validation("amount", "Amount must be positive", "Enter a value > 0"));
 *   }
 *   return Ok(amount);
 * }
 */
