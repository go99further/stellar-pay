/**
 * Token Bucket Rate Limiter (Advanced)
 *
 * Inspired by production API gateway patterns:
 * - Per-key rate limiting (per user, per IP, per endpoint)
 * - Sliding window algorithm
 * - Burst allowance
 * - Rate limit headers (X-RateLimit-*)
 * - Distributed-ready (pluggable storage)
 *
 * Pattern: Request → Check → Allow/Deny → Track → Report
 */

export interface WindowEntry {
  timestamps: number[];
  burstTokens: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number; // ms until next allowed request
  headers: Record<string, string>;
}

export interface SlidingWindowConfig {
  windowMs: number;     // window size in ms
  maxRequests: number;  // max requests per window
  burstLimit: number;   // extra burst tokens above maxRequests
  keyPrefix: string;
}

/**
 * Sliding Window Rate Limiter
 * More accurate than token bucket for bursty traffic
 */
export class SlidingWindowRateLimiter {
  private store: Map<string, WindowEntry> = new Map();
  private config: SlidingWindowConfig;
  private stats = { allowed: 0, denied: 0 };

  constructor(config: Partial<SlidingWindowConfig> = {}) {
    this.config = {
      windowMs: 60000,
      maxRequests: 100,
      burstLimit: 20,
      keyPrefix: "rl",
      ...config,
    };
  }

  /**
   * Check and consume a rate limit token
   */
  consume(key: string, cost = 1): RateLimitResult {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.store.get(fullKey);
    if (!entry) {
      entry = { timestamps: [], burstTokens: this.config.burstLimit };
      this.store.set(fullKey, entry);
    }

    // Evict old timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    const currentCount = entry.timestamps.length;
    const effectiveLimit = this.config.maxRequests + entry.burstTokens;

    if (currentCount + cost > effectiveLimit) {
      this.stats.denied++;
      const oldestInWindow = entry.timestamps[0] ?? now;
      const resetAt = oldestInWindow + this.config.windowMs;
      const retryAfter = resetAt - now;

      return {
        allowed: false,
        remaining: Math.max(0, effectiveLimit - currentCount),
        resetAt,
        retryAfter,
        headers: this.buildHeaders(false, effectiveLimit - currentCount, resetAt, retryAfter),
      };
    }

    // Consume burst tokens first if over base limit
    if (currentCount + cost > this.config.maxRequests) {
      const overflow = (currentCount + cost) - this.config.maxRequests;
      entry.burstTokens = Math.max(0, entry.burstTokens - overflow);
    }

    for (let i = 0; i < cost; i++) {
      entry.timestamps.push(now);
    }

    this.stats.allowed++;
    const remaining = effectiveLimit - entry.timestamps.length;
    const resetAt = (entry.timestamps[0] ?? now) + this.config.windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
      headers: this.buildHeaders(true, remaining, resetAt),
    };
  }

  /**
   * Peek at current usage without consuming
   */
  peek(key: string): { count: number; remaining: number; resetAt: number } {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const entry = this.store.get(fullKey);
    if (!entry) {
      return {
        count: 0,
        remaining: this.config.maxRequests + this.config.burstLimit,
        resetAt: now + this.config.windowMs,
      };
    }

    const active = entry.timestamps.filter((t) => t > windowStart);
    const effectiveLimit = this.config.maxRequests + entry.burstTokens;
    return {
      count: active.length,
      remaining: Math.max(0, effectiveLimit - active.length),
      resetAt: (active[0] ?? now) + this.config.windowMs,
    };
  }

  /**
   * Reset a specific key
   */
  reset(key: string): void {
    this.store.delete(`${this.config.keyPrefix}:${key}`);
  }

  /**
   * Get statistics
   */
  getStats(): { allowed: number; denied: number; keys: number } {
    return { ...this.stats, keys: this.store.size };
  }

  private buildHeaders(
    allowed: boolean,
    remaining: number,
    resetAt: number,
    retryAfter?: number
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": String(this.config.maxRequests),
      "X-RateLimit-Remaining": String(Math.max(0, remaining)),
      "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
    };
    if (!allowed && retryAfter !== undefined) {
      headers["Retry-After"] = String(Math.ceil(retryAfter / 1000));
    }
    return headers;
  }
}

/**
 * Adaptive Rate Limiter
 * Adjusts limits based on system load
 */
export class AdaptiveRateLimiter {
  private base: SlidingWindowRateLimiter;
  private loadFactor = 1.0; // 1.0 = normal, <1.0 = throttled

  constructor(config: Partial<SlidingWindowConfig> = {}) {
    this.base = new SlidingWindowRateLimiter(config);
  }

  /**
   * Update load factor (0.1 = 10% of normal capacity, 1.0 = full)
   */
  setLoadFactor(factor: number): void {
    this.loadFactor = Math.max(0.1, Math.min(1.0, factor));
  }

  consume(key: string, cost = 1): RateLimitResult {
    // Under high load, increase effective cost
    const effectiveCost = Math.ceil(cost / this.loadFactor);
    return this.base.consume(key, effectiveCost);
  }

  getLoadFactor(): number {
    return this.loadFactor;
  }

  getStats() {
    return this.base.getStats();
  }
}
