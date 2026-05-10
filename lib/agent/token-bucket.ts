/**
 * Token Bucket Rate Limiter
 *
 * Inspired by production rate limiting patterns:
 * - Token bucket algorithm (smooth bursting)
 * - Per-key rate limiting (multi-tenant)
 * - Distributed-ready (pluggable storage)
 * - Penalty system for abuse
 * - Rate limit headers (X-RateLimit-*)
 *
 * Pattern: Request → Check Bucket → Consume Token → Allow/Deny
 */

export interface TokenBucketOptions {
  capacity: number;       // max tokens
  refillRate: number;     // tokens per second
  initialTokens?: number; // defaults to capacity
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;        // epoch ms when bucket is full
  retryAfter?: number;    // ms to wait if denied
}

export interface RateLimitHeaders {
  "X-RateLimit-Limit": number;
  "X-RateLimit-Remaining": number;
  "X-RateLimit-Reset": number;
  "Retry-After"?: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  penalty: number; // extra ms delay
}

export class TokenBucketLimiter {
  private buckets: Map<string, BucketState> = new Map();
  private opts: Required<TokenBucketOptions>;

  constructor(options: TokenBucketOptions) {
    this.opts = {
      initialTokens: options.capacity,
      ...options,
    };
  }

  consume(key: string, tokens = 1): RateLimitResult {
    const now = Date.now();
    const bucket = this.getOrCreate(key, now);

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.opts.capacity,
      bucket.tokens + elapsed * this.opts.refillRate
    );
    bucket.lastRefill = now;

    const resetAt = now + ((this.opts.capacity - bucket.tokens) / this.opts.refillRate) * 1000;

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt,
      };
    }

    const retryAfter = Math.ceil(((tokens - bucket.tokens) / this.opts.refillRate) * 1000) + bucket.penalty;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  peek(key: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.getOrCreate(key, now);
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokens = Math.min(this.opts.capacity, bucket.tokens + elapsed * this.opts.refillRate);
    const resetAt = now + ((this.opts.capacity - tokens) / this.opts.refillRate) * 1000;
    return {
      allowed: tokens >= 1,
      remaining: Math.floor(tokens),
      resetAt,
    };
  }

  applyPenalty(key: string, penaltyMs: number): void {
    const bucket = this.getOrCreate(key, Date.now());
    bucket.penalty += penaltyMs;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }

  getHeaders(result: RateLimitResult): RateLimitHeaders {
    const headers: RateLimitHeaders = {
      "X-RateLimit-Limit": this.opts.capacity,
      "X-RateLimit-Remaining": result.remaining,
      "X-RateLimit-Reset": Math.ceil(result.resetAt / 1000),
    };
    if (!result.allowed && result.retryAfter !== undefined) {
      headers["Retry-After"] = Math.ceil(result.retryAfter / 1000);
    }
    return headers;
  }

  getStats(): { keys: number; totalTokens: number } {
    let totalTokens = 0;
    for (const b of this.buckets.values()) totalTokens += b.tokens;
    return { keys: this.buckets.size, totalTokens };
  }

  private getOrCreate(key: string, now: number): BucketState {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.opts.initialTokens,
        lastRefill: now,
        penalty: 0,
      });
    }
    return this.buckets.get(key)!;
  }
}

/**
 * MultiTierRateLimiter — per-second AND per-minute limits
 */
export class MultiTierRateLimiter {
  private second: TokenBucketLimiter;
  private minute: TokenBucketLimiter;

  constructor(perSecond: number, perMinute: number) {
    this.second = new TokenBucketLimiter({ capacity: perSecond, refillRate: perSecond });
    this.minute = new TokenBucketLimiter({ capacity: perMinute, refillRate: perMinute / 60 });
  }

  consume(key: string): RateLimitResult {
    const s = this.second.consume(key);
    if (!s.allowed) return s;
    const m = this.minute.consume(key);
    if (!m.allowed) {
      // Refund second-tier token
      this.second.reset(key);
      return m;
    }
    return { allowed: true, remaining: Math.min(s.remaining, m.remaining), resetAt: Math.max(s.resetAt, m.resetAt) };
  }

  reset(key: string): void {
    this.second.reset(key);
    this.minute.reset(key);
  }
}
