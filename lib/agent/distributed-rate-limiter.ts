/**
 * Distributed rate limiter with Vercel KV / Upstash Redis backend.
 *
 * Background: a vanilla MultiTierRateLimiter holds bucket state in process
 * memory. On Vercel's serverless runtime each cold-started function instance
 * gets its own buckets, so a per-IP cap is effectively multiplied by the
 * fan-out factor. This wrapper centralizes state in a shared KV store when
 * KV_REST_API_URL + KV_REST_API_TOKEN are configured, falling back to the
 * in-memory limiter otherwise (local dev, no-KV deployments).
 *
 * Algorithm: simple sliding-window counter per (key, tier).
 *  - GET stored count for key
 *  - if undefined: SET to 1 with EX = window seconds, allow
 *  - if < limit: INCR, allow
 *  - else: deny with retryAfter = TTL
 *
 * This is *good enough* for a public demo. A production-grade KV limiter
 * would use atomic Lua scripts to prevent the GET → INCR race, and a token
 * bucket for smooth bursting rather than fixed-window counters. Documented
 * in docs/LIMITATIONS.md.
 */

import { MultiTierRateLimiter, type RateLimitResult } from "./token-bucket";

export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}

export interface DistributedRateLimiterOptions {
  perSecond: number;
  perMinute: number;
  /** Override for tests; defaults to env-derived REST client. */
  kv?: KvClient | null;
  /** Override for tests; defaults to in-memory MultiTierRateLimiter fallback. */
  fallback?: MultiTierRateLimiter;
}

export class DistributedRateLimiter {
  private kv: KvClient | null;
  private fallback: MultiTierRateLimiter;
  private perSecond: number;
  private perMinute: number;

  constructor(opts: DistributedRateLimiterOptions) {
    this.kv = opts.kv ?? null;
    this.fallback = opts.fallback ?? new MultiTierRateLimiter(opts.perSecond, opts.perMinute);
    this.perSecond = opts.perSecond;
    this.perMinute = opts.perMinute;
  }

  /** True iff KV backend is active. Useful for /health diagnostics. */
  isDistributed(): boolean {
    return this.kv !== null;
  }

  async consume(ipKey: string): Promise<RateLimitResult> {
    if (!this.kv) {
      return this.fallback.consume(ipKey);
    }
    return this.consumeKv(ipKey);
  }

  private async consumeKv(ipKey: string): Promise<RateLimitResult> {
    // Two windows checked sequentially: per-second first (fail-fast), then per-minute.
    const secondCheck = await this.consumeWindow(`rl:s:${ipKey}`, 1, this.perSecond);
    if (!secondCheck.allowed) return secondCheck;

    const minuteCheck = await this.consumeWindow(`rl:m:${ipKey}`, 60, this.perMinute);
    return minuteCheck;
  }

  private async consumeWindow(
    key: string,
    windowSeconds: number,
    limit: number
  ): Promise<RateLimitResult> {
    const kv = this.kv!;
    let count: number;
    try {
      const existing = await kv.get(key);
      if (existing === null) {
        await kv.set(key, "1", { ex: windowSeconds });
        count = 1;
      } else {
        count = await kv.incr(key);
      }
    } catch {
      // KV unavailable mid-flight — degrade gracefully to fallback.
      // Don't throw: a rate limiter outage shouldn't take down the API.
      return this.fallback.consume(key);
    }

    const ttlSec = await this.safeTtl(key);
    const resetAt = Date.now() + ttlSec * 1000;

    if (count > limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: ttlSec * 1000,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }

  private async safeTtl(key: string): Promise<number> {
    try {
      const t = await this.kv!.ttl(key);
      return t > 0 ? t : 1;
    } catch {
      return 1;
    }
  }
}

/**
 * Build a KV client from Vercel/Upstash env vars. Returns null if env not set,
 * which triggers the in-memory fallback.
 *
 * We don't take a hard dependency on @upstash/redis — instead we hit the REST
 * API directly with fetch. This keeps the bundle smaller and avoids breaking
 * deployments that don't have the addon.
 */
export function kvFromEnv(): KvClient | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  async function call(parts: string[]): Promise<unknown> {
    const res = await fetch(`${url}/${parts.map(encodeURIComponent).join("/")}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`KV ${parts[0]} failed: ${res.status}`);
    const body = (await res.json()) as { result: unknown };
    return body.result;
  }

  return {
    async get(key) {
      const r = await call(["get", key]);
      return r === null || r === undefined ? null : String(r);
    },
    async set(key, value, opts) {
      const args = ["set", key, value];
      if (opts?.ex !== undefined) {
        args.push("ex", String(opts.ex));
      }
      return call(args);
    },
    async incr(key) {
      const r = await call(["incr", key]);
      return typeof r === "number" ? r : parseInt(String(r), 10);
    },
    async ttl(key) {
      const r = await call(["ttl", key]);
      return typeof r === "number" ? r : parseInt(String(r), 10);
    },
  };
}
