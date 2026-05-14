import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MultiTierRateLimiter } from "@/lib/agent/token-bucket";

describe("MultiTierRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within per-second cap", () => {
    const limiter = new MultiTierRateLimiter(5, 100);
    for (let i = 0; i < 5; i++) {
      const result = limiter.consume("ip-a");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks 6th request within same second", () => {
    const limiter = new MultiTierRateLimiter(5, 100);
    for (let i = 0; i < 5; i++) {
      limiter.consume("ip-b");
    }
    const result = limiter.consume("ip-b");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("different IPs have independent buckets", () => {
    const limiter = new MultiTierRateLimiter(5, 100);
    // Exhaust ip-c
    for (let i = 0; i < 5; i++) {
      limiter.consume("ip-c");
    }
    expect(limiter.consume("ip-c").allowed).toBe(false);
    // ip-d is untouched — should still be allowed
    expect(limiter.consume("ip-d").allowed).toBe(true);
  });

  it("tokens refill over time (second tier)", () => {
    const limiter = new MultiTierRateLimiter(5, 100);
    // Exhaust the per-second bucket
    for (let i = 0; i < 5; i++) {
      limiter.consume("ip-e");
    }
    expect(limiter.consume("ip-e").allowed).toBe(false);

    // Advance 1 second — per-second bucket refills at 5 tokens/sec
    vi.advanceTimersByTime(1000);

    const result = limiter.consume("ip-e");
    expect(result.allowed).toBe(true);
  });

  it("minute-tier cap blocks even if second-tier has budget", () => {
    // perSecond=100 so the second tier never blocks; perMinute=3 so it blocks fast
    const limiter = new MultiTierRateLimiter(100, 3);
    expect(limiter.consume("ip-f").allowed).toBe(true);
    expect(limiter.consume("ip-f").allowed).toBe(true);
    expect(limiter.consume("ip-f").allowed).toBe(true);
    // 4th request — minute bucket exhausted, second bucket still has plenty
    const result = limiter.consume("ip-f");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("remaining count decreases with each allowed request", () => {
    const limiter = new MultiTierRateLimiter(5, 100);
    const first = limiter.consume("ip-g");
    const second = limiter.consume("ip-g");
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBeLessThan(first.remaining);
  });
});
