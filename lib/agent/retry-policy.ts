/**
 * Retry Policy
 *
 * Inspired by Polly/.NET and resilience4j patterns:
 * - Exponential backoff with jitter
 * - Fixed delay retry
 * - Linear backoff
 * - Max attempts + timeout
 * - Retry on specific error types
 * - onRetry callback for observability
 *
 * Pattern: Execute → Fail → Classify → Backoff → Retry → Give Up
 */

export type BackoffStrategy = "fixed" | "linear" | "exponential" | "exponential-jitter";

export interface RetryOptions<T = unknown> {
  maxAttempts: number;
  delay: number;                          // base delay in ms
  strategy: BackoffStrategy;
  maxDelay?: number;                      // cap for exponential
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  timeout?: number;                       // per-attempt timeout in ms
}

export interface RetryResult<T> {
  value?: T;
  attempts: number;
  totalTime: number;
  success: boolean;
  lastError?: unknown;
}

function computeDelay(attempt: number, opts: RetryOptions): number {
  const base = opts.delay;
  const max = opts.maxDelay ?? Infinity;
  let delay: number;

  switch (opts.strategy) {
    case "fixed":
      delay = base;
      break;
    case "linear":
      delay = base * attempt;
      break;
    case "exponential":
      delay = base * Math.pow(2, attempt - 1);
      break;
    case "exponential-jitter":
      delay = base * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
      break;
    default:
      delay = base;
  }

  return Math.min(delay, max);
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions<T>
): Promise<RetryResult<T>> {
  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      let value: T;

      if (options.timeout) {
        value = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Attempt ${attempt} timed out`)), options.timeout)
          ),
        ]);
      } else {
        value = await fn();
      }

      return { value, attempts: attempt, totalTime: Date.now() - start, success: true };
    } catch (err) {
      lastError = err;

      const shouldRetry = options.shouldRetry ? options.shouldRetry(err, attempt) : true;
      if (!shouldRetry || attempt === options.maxAttempts) break;

      const delayMs = computeDelay(attempt, options);
      options.onRetry?.(err, attempt, delayMs);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    attempts: options.maxAttempts,
    totalTime: Date.now() - start,
    success: false,
    lastError,
  };
}

/**
 * RetryPolicy — reusable policy object
 */
export class RetryPolicy<T = unknown> {
  constructor(private opts: RetryOptions<T>) {}

  async execute(fn: () => Promise<T>): Promise<RetryResult<T>> {
    return retry(fn, this.opts);
  }

  withMaxAttempts(n: number): RetryPolicy<T> {
    return new RetryPolicy({ ...this.opts, maxAttempts: n });
  }

  withDelay(ms: number): RetryPolicy<T> {
    return new RetryPolicy({ ...this.opts, delay: ms });
  }

  withStrategy(strategy: BackoffStrategy): RetryPolicy<T> {
    return new RetryPolicy({ ...this.opts, strategy });
  }

  withShouldRetry(fn: (err: unknown, attempt: number) => boolean): RetryPolicy<T> {
    return new RetryPolicy({ ...this.opts, shouldRetry: fn });
  }

  withOnRetry(fn: (err: unknown, attempt: number, delay: number) => void): RetryPolicy<T> {
    return new RetryPolicy({ ...this.opts, onRetry: fn });
  }
}

export function createRetryPolicy<T>(opts: Partial<RetryOptions<T>> = {}): RetryPolicy<T> {
  return new RetryPolicy<T>({
    maxAttempts: 3,
    delay: 100,
    strategy: "exponential",
    ...opts,
  });
}
