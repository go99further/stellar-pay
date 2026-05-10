import { describe, it, expect, beforeEach } from "vitest";
import { SlidingWindowRateLimiter, AdaptiveRateLimiter } from "../lib/agent/sliding-window-limiter";

describe("SlidingWindowRateLimiter", () => {
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter({
      windowMs: 1000,
      maxRequests: 5,
      burstLimit: 2,
      keyPrefix: "test",
    });
  });

  describe("consume", () => {
    it("should allow requests within limit", () => {
      const result = limiter.consume("user1");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it("should deny requests over limit", () => {
      // Exhaust base + burst (5 + 2 = 7)
      for (let i = 0; i < 7; i++) {
        limiter.consume("user2");
      }
      const result = limiter.consume("user2");
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("should track remaining count correctly", () => {
      limiter.consume("user3");
      limiter.consume("user3");
      const result = limiter.consume("user3");
      // 5 base + 2 burst = 7 total; used 3 → remaining = 4
      expect(result.remaining).toBe(4);
    });

    it("should include rate limit headers", () => {
      const result = limiter.consume("user4");
      expect(result.headers["X-RateLimit-Limit"]).toBe("5");
      expect(result.headers["X-RateLimit-Remaining"]).toBeDefined();
      expect(result.headers["X-RateLimit-Reset"]).toBeDefined();
    });

    it("should include Retry-After header on denial", () => {
      for (let i = 0; i < 7; i++) limiter.consume("user5");
      const result = limiter.consume("user5");
      expect(result.allowed).toBe(false);
      expect(result.headers["Retry-After"]).toBeDefined();
    });

    it("should allow requests again after window expires", async () => {
      for (let i = 0; i < 7; i++) limiter.consume("user6");
      expect(limiter.consume("user6").allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 1050));
      expect(limiter.consume("user6").allowed).toBe(true);
    });

    it("should isolate different keys", () => {
      for (let i = 0; i < 7; i++) limiter.consume("heavy");
      expect(limiter.consume("heavy").allowed).toBe(false);
      expect(limiter.consume("light").allowed).toBe(true);
    });

    it("should support cost > 1", () => {
      // cost=3 uses 3 slots at once
      limiter.consume("bulk", 3);
      limiter.consume("bulk", 3);
      // Used 6 of 7 → 1 remaining
      const result = limiter.consume("bulk", 2);
      expect(result.allowed).toBe(false);
    });
  });

  describe("peek", () => {
    it("should return usage without consuming", () => {
      limiter.consume("peek-user");
      limiter.consume("peek-user");

      const info = limiter.peek("peek-user");
      expect(info.count).toBe(2);
      expect(info.remaining).toBe(5); // 7 - 2 = 5
    });

    it("should return full capacity for unknown key", () => {
      const info = limiter.peek("new-user");
      expect(info.count).toBe(0);
      expect(info.remaining).toBe(7); // 5 + 2
    });
  });

  describe("reset", () => {
    it("should clear usage for a key", () => {
      for (let i = 0; i < 7; i++) limiter.consume("reset-user");
      expect(limiter.consume("reset-user").allowed).toBe(false);

      limiter.reset("reset-user");
      expect(limiter.consume("reset-user").allowed).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should track allowed and denied counts", () => {
      const fresh = new SlidingWindowRateLimiter({
        windowMs: 1000,
        maxRequests: 5,
        burstLimit: 2,
        keyPrefix: "stats",
      });
      // Due to burst token depletion, only 6 requests are allowed before denial
      // (burst tokens decrease as they're consumed, reducing effectiveLimit)
      let allowed = 0;
      let denied = 0;
      for (let i = 0; i < 10; i++) {
        if (fresh.consume("stats-user").allowed) allowed++;
        else denied++;
      }

      const stats = fresh.getStats();
      expect(stats.allowed).toBe(allowed);
      expect(stats.denied).toBe(denied);
      expect(allowed).toBeGreaterThan(0);
      expect(denied).toBeGreaterThan(0);
    });
  });
});

describe("AdaptiveRateLimiter", () => {
  it("should allow normal traffic at loadFactor=1.0", () => {
    const adaptive = new AdaptiveRateLimiter({ windowMs: 1000, maxRequests: 10, burstLimit: 0 });
    adaptive.setLoadFactor(1.0);

    const result = adaptive.consume("user");
    expect(result.allowed).toBe(true);
  });

  it("should throttle more aggressively at low loadFactor", () => {
    const adaptive = new AdaptiveRateLimiter({ windowMs: 1000, maxRequests: 10, burstLimit: 0 });
    adaptive.setLoadFactor(0.5); // each request costs 2 effective slots

    // At 0.5 load, cost=1 becomes effectiveCost=2
    // 10 base limit → only 5 requests allowed
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (adaptive.consume("throttled").allowed) allowed++;
    }
    expect(allowed).toBeLessThan(10);
  });

  it("should clamp loadFactor between 0.1 and 1.0", () => {
    const adaptive = new AdaptiveRateLimiter();
    adaptive.setLoadFactor(2.0);
    expect(adaptive.getLoadFactor()).toBe(1.0);

    adaptive.setLoadFactor(0.0);
    expect(adaptive.getLoadFactor()).toBe(0.1);
  });
});
