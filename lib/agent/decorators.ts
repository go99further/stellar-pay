/**
 * Decorator Pattern (functional)
 *
 * Inspired by AOP / middleware patterns:
 * - Function decorators (logging, timing, caching, validation)
 * - Class method decorators
 * - Composable decorator chains
 * - Async-aware decorators
 *
 * Pattern: Wrap → Intercept → Execute → Post-process
 */

export type AnyFn = (...args: any[]) => any;

// --- timing decorator ---
export function withTiming<T extends AnyFn>(
  fn: T,
  onResult?: (name: string, durationMs: number) => void,
  name = fn.name || "anonymous"
): T {
  return (async (...args: unknown[]) => {
    const start = Date.now();
    try {
      return await fn(...args);
    } finally {
      onResult?.(name, Date.now() - start);
    }
  }) as unknown as T;
}

// --- logging decorator ---
export function withLogging<T extends AnyFn>(
  fn: T,
  logger: { log: (msg: string) => void },
  name = fn.name || "anonymous"
): T {
  return (async (...args: unknown[]) => {
    logger.log(`[${name}] called with ${args.length} args`);
    try {
      const result = await fn(...args);
      logger.log(`[${name}] succeeded`);
      return result;
    } catch (err) {
      logger.log(`[${name}] failed: ${err}`);
      throw err;
    }
  }) as unknown as T;
}

// --- memoize decorator ---
export function withMemo<T extends AnyFn>(
  fn: T,
  keyFn: (...args: Parameters<T>) => string = (...args) => JSON.stringify(args)
): T & { cache: Map<string, unknown>; clear: () => void } {
  const cache = new Map<string, unknown>();
  const wrapped = (async (...args: unknown[]) => {
    const key = keyFn(...(args as Parameters<T>));
    if (cache.has(key)) return cache.get(key);
    const result = await fn(...args);
    cache.set(key, result);
    return result;
  }) as T & { cache: Map<string, unknown>; clear: () => void };
  wrapped.cache = cache;
  wrapped.clear = () => cache.clear();
  return wrapped;
}

// --- retry decorator ---
export function withRetry<T extends AnyFn>(
  fn: T,
  maxAttempts = 3,
  delayMs = 100
): T {
  return (async (...args: unknown[]) => {
    let lastErr: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastErr = err;
        if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }) as unknown as T;
}

// --- timeout decorator ---
export function withTimeout<T extends AnyFn>(fn: T, timeoutMs: number): T {
  return (async (...args: unknown[]) => {
    return Promise.race([
      fn(...args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }) as unknown as T;
}

// --- validation decorator ---
export function withValidation<T extends AnyFn>(
  fn: T,
  validate: (...args: Parameters<T>) => string | null
): T {
  return (async (...args: unknown[]) => {
    const error = validate(...(args as Parameters<T>));
    if (error) throw new Error(`Validation failed: ${error}`);
    return fn(...args);
  }) as unknown as T;
}

// --- rate limit decorator ---
export function withRateLimit<T extends AnyFn>(fn: T, maxPerSecond: number): T {
  let tokens = maxPerSecond;
  let lastRefill = Date.now();

  return (async (...args: unknown[]) => {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(maxPerSecond, tokens + elapsed * maxPerSecond);
    lastRefill = now;

    if (tokens < 1) throw new Error("Rate limit exceeded");
    tokens--;
    return fn(...args);
  }) as unknown as T;
}

// --- compose decorators ---
export function compose<T extends AnyFn>(...decorators: Array<(fn: T) => T>): (fn: T) => T {
  return (fn: T) => decorators.reduceRight((acc, dec) => dec(acc), fn);
}

// --- tap decorator (side-effect without changing result) ---
export function withTap<T extends AnyFn>(
  fn: T,
  tap: (result: Awaited<ReturnType<T>>, args: Parameters<T>) => void
): T {
  return (async (...args: unknown[]) => {
    const result = await fn(...args);
    tap(result as Awaited<ReturnType<T>>, args as Parameters<T>);
    return result;
  }) as unknown as T;
}

// --- fallback decorator ---
export function withFallback<T extends AnyFn>(fn: T, fallback: (...args: Parameters<T>) => ReturnType<T>): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch {
      return fallback(...(args as Parameters<T>));
    }
  }) as unknown as T;
}
