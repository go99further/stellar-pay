import { describe, it, expect, beforeEach } from "vitest";
import { RateLimiter, MultiTierRateLimiter } from "../lib/agent/rate-limiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 10,
      refillInterval: 100,
    });
  });

  describe("tryConsume", () => {
    it("should allow consumption when tokens available", () => {
      const result = limiter.tryConsume(5);
      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(5);
    });

    it("should deny consumption when insufficient tokens", () => {
      limiter.tryConsume(8);
      const result = limiter.tryConsume(5);
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should track statistics", () => {
      limiter.tryConsume(3);
      limiter.tryConsume(3);
      limiter.tryConsume(10); // Should be denied

      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.deniedRequests).toBe(1);
    });
  });

  describe("waitForTokens", () => {
    it("should wait for tokens to become available", async () => {
      limiter.tryConsume(10); // Consume all tokens

      const start = Date.now();
      await limiter.waitForTokens(1);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThan(50); // Should have waited
    });
  });

  describe("execute", () => {
    it("should execute function with rate limiting", async () => {
      let executed = false;
      await limiter.execute(async () => {
        executed = true;
        return "done";
      });

      expect(executed).toBe(true);
    });
  });
});

describe("MultiTierRateLimiter", () => {
  let multiLimiter: MultiTierRateLimiter;

  beforeEach(() => {
    multiLimiter = new MultiTierRateLimiter();
    multiLimiter.addTier("fast", { maxTokens: 100, refillRate: 10 });
    multiLimiter.addTier("slow", { maxTokens: 10, refillRate: 1 });
  });

  it("should manage multiple tiers independently", () => {
    const fastResult = multiLimiter.tryConsume("fast", 50);
    const slowResult = multiLimiter.tryConsume("slow", 5);

    expect(fastResult.allowed).toBe(true);
    expect(slowResult.allowed).toBe(true);
  });

  it("should throw error for unknown tier", () => {
    expect(() => multiLimiter.tryConsume("unknown", 1)).toThrow();
  });

  it("should get statistics for all tiers", () => {
    multiLimiter.tryConsume("fast", 10);
    multiLimiter.tryConsume("slow", 5);

    const stats = multiLimiter.getAllStats();
    expect(stats.fast).toBeDefined();
    expect(stats.slow).toBeDefined();
  });

  it("should execute function on a tier", async () => {
    let ran = false;
    await multiLimiter.execute("fast", async () => { ran = true; return "ok"; });
    expect(ran).toBe(true);
  });

  it("should throw for unknown tier in execute", async () => {
    await expect(multiLimiter.execute("unknown", async () => "x")).rejects.toThrow();
  });

  it("should resetAll tiers", () => {
    multiLimiter.tryConsume("fast", 50);
    multiLimiter.tryConsume("slow", 5);
    multiLimiter.resetAll();
    const stats = multiLimiter.getAllStats();
    expect(stats.fast.totalRequests).toBe(0);
    expect(stats.slow.totalRequests).toBe(0);
  });
});

describe("RateLimiter — additional coverage", () => {
  it("should reset stats and tokens", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillInterval: 100 });
    limiter.tryConsume(5);
    limiter.reset();
    const stats = limiter.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.currentTokens).toBe(10);
  });

  it("should return currentTokens and maxTokens in getStats", () => {
    const limiter = new RateLimiter({ maxTokens: 20, refillRate: 10, refillInterval: 100 });
    limiter.tryConsume(7);
    const stats = limiter.getStats();
    expect(stats.maxTokens).toBe(20);
    expect(stats.currentTokens).toBe(13);
  });

  it("should updateConfig and apply new maxTokens", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillInterval: 100 });
    limiter.updateConfig({ maxTokens: 50 });
    const stats = limiter.getStats();
    expect(stats.maxTokens).toBe(50);
  });

  it("should include resetAt in tryConsume result", () => {
    const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10, refillInterval: 100 });
    const result = limiter.tryConsume(1);
    expect(result.resetAt).toBeGreaterThanOrEqual(Date.now());
  });
});
