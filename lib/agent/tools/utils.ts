/**
 * withRetry — RPC retry helper for Stellar testnet calls.
 *
 * We chose linear over exponential backoff because Stellar testnet's median
 * outage is 1-2s; exponential backoff overshoots and degrades p95 latency.
 * A flat 500 ms step gets us back on the happy path in 1-2 retries without
 * piling up wait time when the node recovers quickly.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms between attempts. Default: 500 */
  baseDelayMs?: number;
  /** Backoff strategy. Default: "linear" */
  backoff?: "linear" | "exponential";
  /** Return true to retry, false to rethrow immediately. Default: network/timeout/5xx matcher */
  shouldRetry?: (err: unknown) => boolean;
  /** Called before each retry with the attempt index (1-based) and the error. */
  onRetry?: (attempt: number, err: unknown) => void;
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof Error) {
    return /timeout|ECONN|ETIMEDOUT|fetch failed|503|502|504|network/i.test(err.message);
  }
  return false;
}

function delayMs(attempt: number, baseDelayMs: number, backoff: "linear" | "exponential"): number {
  if (backoff === "exponential") {
    return baseDelayMs * Math.pow(2, attempt - 1);
  }
  return baseDelayMs * attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelay = opts?.baseDelayMs ?? 500;
  const backoff = opts?.backoff ?? "linear";
  const shouldRetry = opts?.shouldRetry ?? defaultShouldRetry;
  const onRetry = opts?.onRetry;

  function attempt(remaining: number, attemptNumber: number): Promise<T> {
    return fn().then(
      (value) => value,
      (err: unknown) => {
        if (remaining <= 1 || !shouldRetry(err)) {
          return Promise.reject(err);
        }
        onRetry?.(attemptNumber, err);
        return sleep(delayMs(attemptNumber, baseDelay, backoff)).then(() =>
          attempt(remaining - 1, attemptNumber + 1)
        );
      }
    );
  }

  return attempt(maxAttempts, 1);
}
