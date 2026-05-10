import { describe, it, expect, beforeEach } from "vitest";
import { TokenBucketLimiter, MultiTierRateLimiter } from "../lib/agent/token-bucket";

describe("TokenBucketLimiter", () => {
  let limiter: TokenBucketLimiter;

  beforeEach(() => {
    limiter = new TokenBucketLimiter({ capacity: 5, refillRate: 1 });
  });

  describe("consume", () => {
    it("should allow requests within capacity", () => {
      const result = limiter.consume("user1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should deny when tokens exhausted", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      const result = limiter.consume("user1");
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should track remaining tokens correctly", () => {
      limiter.consume("user1");
      limiter.consume("user1");
      const result = limiter.consume("user1");
      expect(result.remaining).toBe(2);
    });

    it("should isolate buckets per key", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      const result = limiter.consume("user2");
      expect(result.allowed).toBe(true);
    });

    it("should consume multiple tokens at once", () => {
      const result = limiter.consume("user1", 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it("should deny if not enough tokens for bulk consume", () => {
      limiter.consume("user1", 4);
      const result = limiter.consume("user1", 3);
      expect(result.allowed).toBe(false);
    });

    it("should refill tokens over time", async () => {
      // Exhaust all tokens
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      // Wait for refill (1 token/sec, wait 1.1s)
      await new Promise((r) => setTimeout(r, 1100));
      const result = limiter.consume("user1");
      expect(result.allowed).toBe(true);
    });

    it("should not exceed capacity on refill", async () => {
      // Wait a long time — should cap at capacity
      await new Promise((r) => setTimeout(r, 200));
      const result = limiter.consume("user1");
      expect(result.remaining).toBeLessThanOrEqual(4); // consumed 1, max was 5
    });

    it("should provide retryAfter when denied", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      const result = limiter.consume("user1");
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should provide resetAt timestamp", () => {
      const before = Date.now();
      const result = limiter.consume("user1");
      expect(result.resetAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("peek", () => {
    it("should return current state without consuming", () => {
      const before = limiter.peek("user1");
      const after = limiter.peek("user1");
      expect(before.remaining).toBe(after.remaining);
    });

    it("should show allowed=false when exhausted", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      const result = limiter.peek("user1");
      expect(result.allowed).toBe(false);
    });
  });

  describe("applyPenalty", () => {
    it("should increase retryAfter by penalty amount", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      limiter.applyPenalty("user1", 5000);
      const result = limiter.consume("user1");
      expect(result.retryAfter).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("reset", () => {
    it("should reset a specific key", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      limiter.reset("user1");
      const result = limiter.consume("user1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should not affect other keys", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      for (let i = 0; i < 5; i++) limiter.consume("user2");
      limiter.reset("user1");
      const result = limiter.consume("user2");
      expect(result.allowed).toBe(false);
    });

    it("should reset all keys", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      for (let i = 0; i < 5; i++) limiter.consume("user2");
      limiter.resetAll();
      expect(limiter.consume("user1").allowed).toBe(true);
      expect(limiter.consume("user2").allowed).toBe(true);
    });
  });

  describe("getHeaders", () => {
    it("should return correct rate limit headers on success", () => {
      const result = limiter.consume("user1");
      const headers = limiter.getHeaders(result);
      expect(headers["X-RateLimit-Limit"]).toBe(5);
      expect(headers["X-RateLimit-Remaining"]).toBe(4);
      expect(headers["X-RateLimit-Reset"]).toBeGreaterThan(0);
      expect(headers["Retry-After"]).toBeUndefined();
    });

    it("should include Retry-After header on denial", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      const result = limiter.consume("user1");
      const headers = limiter.getHeaders(result);
      expect(headers["Retry-After"]).toBeGreaterThan(0);
    });
  });

  describe("getStats", () => {
    it("should track number of active keys", () => {
      limiter.consume("a");
      limiter.consume("b");
      limiter.consume("c");
      expect(limiter.getStats().keys).toBe(3);
    });
  });
});

describe("MultiTierRateLimiter", () => {
  it("should allow within both tiers", () => {
    const limiter = new MultiTierRateLimiter(10, 100);
    const result = limiter.consume("user1");
    expect(result.allowed).toBe(true);
  });

  it("should deny when per-second limit exceeded", () => {
    const limiter = new MultiTierRateLimiter(3, 100);
    limiter.consume("user1");
    limiter.consume("user1");
    limiter.consume("user1");
    const result = limiter.consume("user1");
    expect(result.allowed).toBe(false);
  });

  it("should deny when per-minute limit exceeded", () => {
    const limiter = new MultiTierRateLimiter(100, 3);
    limiter.consume("user1");
    limiter.consume("user1");
    limiter.consume("user1");
    const result = limiter.consume("user1");
    expect(result.allowed).toBe(false);
  });

  it("should isolate keys", () => {
    const limiter = new MultiTierRateLimiter(2, 10);
    limiter.consume("a");
    limiter.consume("a");
    const result = limiter.consume("b");
    expect(result.allowed).toBe(true);
  });

  it("should reset both tiers", () => {
    const limiter = new MultiTierRateLimiter(2, 10);
    limiter.consume("user1");
    limiter.consume("user1");
    limiter.reset("user1");
    expect(limiter.consume("user1").allowed).toBe(true);
  });
});
