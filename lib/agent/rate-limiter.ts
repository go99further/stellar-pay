/**
 * Rate Limiter
 *
 * Token bucket algorithm for rate limiting:
 * - Prevent API rate limit errors
 * - Fair resource allocation
 * - Burst handling
 * - Multiple limit tiers
 *
 * Pattern: Request → Check Tokens → Consume → Allow/Deny
 */

export interface RateLimitConfig {
  maxTokens: number; // Maximum tokens in bucket
  refillRate: number; // Tokens per second
  refillInterval: number; // Milliseconds between refills
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  retryAfter?: number; // Milliseconds to wait
  resetAt: number; // Timestamp when bucket will be full
}

export interface RateLimitStats {
  totalRequests: number;
  allowedRequests: number;
  deniedRequests: number;
  currentTokens: number;
  maxTokens: number;
}

/**
 * Rate Limiter
 * Token bucket algorithm implementation
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private tokens: number;
  private lastRefill: number;
  private stats = {
    totalRequests: 0,
    allowedRequests: 0,
    deniedRequests: 0,
  };

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxTokens: 100,
      refillRate: 10, // 10 tokens per second
      refillInterval: 100, // Refill every 100ms
      ...config,
    };

    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();

    // Start refill timer
    this.startRefillTimer();
  }

  /**
   * Try to consume tokens
   */
  tryConsume(tokens: number = 1): RateLimitResult {
    this.stats.totalRequests++;

    // Refill tokens based on time passed
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.stats.allowedRequests++;

      return {
        allowed: true,
        remainingTokens: this.tokens,
        resetAt: this.calculateResetTime(),
      };
    } else {
      this.stats.deniedRequests++;

      // Calculate retry after time
      const tokensNeeded = tokens - this.tokens;
      const retryAfter = (tokensNeeded / this.config.refillRate) * 1000;

      return {
        allowed: false,
        remainingTokens: this.tokens,
        retryAfter: Math.ceil(retryAfter),
        resetAt: this.calculateResetTime(),
      };
    }
  }

  /**
   * Wait until tokens are available
   */
  async waitForTokens(tokens: number = 1): Promise<void> {
    const result = this.tryConsume(tokens);

    if (result.allowed) {
      return;
    }

    // Wait for retry after time
    await this.sleep(result.retryAfter!);

    // Try again recursively
    return this.waitForTokens(tokens);
  }

  /**
   * Execute function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>, tokens: number = 1): Promise<T> {
    await this.waitForTokens(tokens);
    return fn();
  }

  /**
   * Refill tokens based on time passed
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;

    if (timePassed >= this.config.refillInterval) {
      const tokensToAdd = (timePassed / 1000) * this.config.refillRate;
      this.tokens = Math.min(this.tokens + tokensToAdd, this.config.maxTokens);
      this.lastRefill = now;
    }
  }

  /**
   * Start automatic refill timer
   */
  private startRefillTimer(): void {
    setInterval(() => {
      this.refill();
    }, this.config.refillInterval);
  }

  /**
   * Calculate when bucket will be full
   */
  private calculateResetTime(): number {
    const tokensNeeded = this.config.maxTokens - this.tokens;
    const timeNeeded = (tokensNeeded / this.config.refillRate) * 1000;
    return Date.now() + timeNeeded;
  }

  /**
   * Get current statistics
   */
  getStats(): RateLimitStats {
    this.refill(); // Update tokens before returning stats

    return {
      ...this.stats,
      currentTokens: this.tokens,
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Reset rate limiter
   */
  reset(): void {
    this.tokens = this.config.maxTokens;
    this.lastRefill = Date.now();
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      deniedRequests: 0,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Multi-tier Rate Limiter
 * Supports different limits for different operations
 */
export class MultiTierRateLimiter {
  private limiters: Map<string, RateLimiter> = new Map();

  /**
   * Add a rate limit tier
   */
  addTier(name: string, config: Partial<RateLimitConfig>): void {
    this.limiters.set(name, new RateLimiter(config));
  }

  /**
   * Try to consume from a specific tier
   */
  tryConsume(tier: string, tokens: number = 1): RateLimitResult {
    const limiter = this.limiters.get(tier);

    if (!limiter) {
      throw new Error(`Rate limit tier "${tier}" not found`);
    }

    return limiter.tryConsume(tokens);
  }

  /**
   * Execute with rate limiting on specific tier
   */
  async execute<T>(tier: string, fn: () => Promise<T>, tokens: number = 1): Promise<T> {
    const limiter = this.limiters.get(tier);

    if (!limiter) {
      throw new Error(`Rate limit tier "${tier}" not found`);
    }

    return limiter.execute(fn, tokens);
  }

  /**
   * Get statistics for all tiers
   */
  getAllStats(): Record<string, RateLimitStats> {
    const stats: Record<string, RateLimitStats> = {};

    for (const [name, limiter] of this.limiters.entries()) {
      stats[name] = limiter.getStats();
    }

    return stats;
  }

  /**
   * Reset all tiers
   */
  resetAll(): void {
    for (const limiter of this.limiters.values()) {
      limiter.reset();
    }
  }
}

/**
 * Global rate limiters for different services
 */
export const rateLimiters = new MultiTierRateLimiter();

// Configure default tiers
rateLimiters.addTier("rpc", {
  maxTokens: 100,
  refillRate: 10, // 10 requests per second
  refillInterval: 100,
});

rateLimiters.addTier("api", {
  maxTokens: 50,
  refillRate: 5, // 5 requests per second
  refillInterval: 100,
});

rateLimiters.addTier("heavy", {
  maxTokens: 10,
  refillRate: 1, // 1 request per second
  refillInterval: 100,
});

/**
 * Decorator for rate-limited methods
 */
export function rateLimit(tier: string, tokens: number = 1) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return rateLimiters.execute(tier, () => originalMethod.apply(this, args), tokens);
    };

    return descriptor;
  };
}

/**
 * Usage example:
 *
 * // Basic usage
 * const limiter = new RateLimiter({
 *   maxTokens: 100,
 *   refillRate: 10,
 * });
 *
 * const result = limiter.tryConsume(1);
 * if (result.allowed) {
 *   await makeApiCall();
 * } else {
 *   console.log("Rate limited, retry after:", result.retryAfter);
 * }
 *
 * // Wait for tokens
 * await limiter.waitForTokens(5);
 * await makeExpensiveCall();
 *
 * // Execute with automatic waiting
 * const data = await limiter.execute(async () => {
 *   return await fetchData();
 * });
 *
 * // Multi-tier usage
 * await rateLimiters.execute("rpc", async () => {
 *   return await stellarClient.loadAccount(address);
 * });
 *
 * // Decorator usage
 * class ApiClient {
 *   @rateLimit("api", 1)
 *   async fetchData() {
 *     return await fetch("/api/data");
 *   }
 *
 *   @rateLimit("heavy", 5)
 *   async heavyOperation() {
 *     return await processLargeDataset();
 *   }
 * }
 */
