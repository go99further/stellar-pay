import { describe, it, expect, beforeEach } from "vitest";
import { SlidingWindowLimiter } from "../lib/agent/rate-limiter-sliding";

describe("SlidingWindowLimiter", () => {
  let limiter: SlidingWindowLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowLimiter({ windowMs: 1000, maxRequests: 5 });
  });

  describe("consume", () => {
    it("should allow requests within limit", () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.consume("user1").allowed).toBe(true);
      }
    });

    it("should deny when limit exceeded", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      expect(limiter.consume("user1").allowed).toBe(false);
    });

    it("should track remaining count", () => {
      limiter.consume("user1");
      limiter.consume("user1");
      const result = limiter.consume("user1");
      expect(result.remaining).toBe(2);
    });

    it("should isolate keys", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      expect(limiter.consume("user2").allowed).toBe(true);
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

    it("should support weighted cost", () => {
      limiter.consume("user1", 3);
      const result = limiter.consume("user1", 3);
      expect(result.allowed).toBe(false);
    });

    it("should allow after window expires", async () => {
      const fast = new SlidingWindowLimiter({ windowMs: 50, maxRequests: 2 });
      fast.consume("u");
      fast.consume("u");
      expect(fast.consume("u").allowed).toBe(false);
      await new Promise((r) => setTimeout(r, 60));
      expect(fast.consume("u").allowed).toBe(true);
    });
  });

  describe("peek", () => {
    it("should return current state without consuming", () => {
      limiter.consume("user1");
      const before = limiter.peek("user1").remaining;
      limiter.peek("user1");
      expect(limiter.peek("user1").remaining).toBe(before);
    });

    it("should show allowed=false when exhausted", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      expect(limiter.peek("user1").allowed).toBe(false);
    });

    it("should show allowed=true for fresh key", () => {
      expect(limiter.peek("new-user").allowed).toBe(true);
    });
  });

  describe("burst factor", () => {
    it("should allow burst above base limit", () => {
      const burst = new SlidingWindowLimiter({ windowMs: 1000, maxRequests: 5, burstFactor: 2 });
      for (let i = 0; i < 10; i++) {
        expect(burst.consume("u").allowed).toBe(true);
      }
      expect(burst.consume("u").allowed).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset a specific key", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      limiter.reset("user1");
      expect(limiter.consume("user1").allowed).toBe(true);
    });

    it("should not affect other keys", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      for (let i = 0; i < 5; i++) limiter.consume("user2");
      limiter.reset("user1");
      expect(limiter.consume("user2").allowed).toBe(false);
    });

    it("should reset all keys", () => {
      for (let i = 0; i < 5; i++) limiter.consume("user1");
      for (let i = 0; i < 5; i++) limiter.consume("user2");
      limiter.resetAll();
      expect(limiter.consume("user1").allowed).toBe(true);
      expect(limiter.consume("user2").allowed).toBe(true);
    });
  });

  describe("getUsage", () => {
    it("should return current usage for key", () => {
      limiter.consume("user1");
      limiter.consume("user1");
      expect(limiter.getUsage("user1")).toBe(2);
    });

    it("should return 0 for unknown key", () => {
      expect(limiter.getUsage("unknown")).toBe(0);
    });
  });

  describe("activeKeys", () => {
    it("should count distinct keys", () => {
      limiter.consume("a");
      limiter.consume("b");
      limiter.consume("c");
      expect(limiter.activeKeys).toBe(3);
    });
  });
});
