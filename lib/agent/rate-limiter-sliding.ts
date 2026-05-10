/**
 * Sliding Window Rate Limiter — precise request rate control
 *
 * Inspired by production API gateway patterns:
 * - Sliding window counter (vs fixed window)
 * - Per-key isolation
 * - Burst allowance
 * - Distributed-ready (pluggable store)
 * - Request cost weighting
 */

export interface SlidingWindowOptions {
  windowMs: number;
  maxRequests: number;
  burstFactor?: number;
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

interface RequestRecord {
  timestamp: number;
  cost: number;
}

export class SlidingWindowLimiter {
  private windows = new Map<string, RequestRecord[]>();
  private windowMs: number;
  private maxRequests: number;
  private burstMax: number;

  constructor(options: SlidingWindowOptions) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
    this.burstMax = Math.floor(options.maxRequests * (options.burstFactor ?? 1));
  }

  consume(key: string, cost = 1): LimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.windows.has(key)) this.windows.set(key, []);
    const records = this.windows.get(key)!;

    // Evict expired records
    const active = records.filter((r) => r.timestamp > windowStart);
    this.windows.set(key, active);

    const used = active.reduce((sum, r) => sum + r.cost, 0);
    const limit = this.burstMax;

    if (used + cost > limit) {
      const oldest = active[0];
      const retryAfter = oldest ? oldest.timestamp + this.windowMs - now : this.windowMs;
      return {
        allowed: false,
        remaining: Math.max(0, limit - used),
        resetAt: now + retryAfter,
        retryAfter,
      };
    }

    active.push({ timestamp: now, cost });
    return {
      allowed: true,
      remaining: limit - used - cost,
      resetAt: now + this.windowMs,
    };
  }

  peek(key: string): LimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const records = (this.windows.get(key) ?? []).filter((r) => r.timestamp > windowStart);
    const used = records.reduce((sum, r) => sum + r.cost, 0);
    return {
      allowed: used < this.burstMax,
      remaining: Math.max(0, this.burstMax - used),
      resetAt: now + this.windowMs,
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  resetAll(): void {
    this.windows.clear();
  }

  getUsage(key: string): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    return (this.windows.get(key) ?? [])
      .filter((r) => r.timestamp > windowStart)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  get activeKeys(): number { return this.windows.size; }
}
