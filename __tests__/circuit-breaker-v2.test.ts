import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker } from "../lib/agent/circuit-breaker-v2";

const success = async () => "ok";
const fail = async () => { throw new Error("service down"); };

function makeBreaker(opts = {}) {
  return new CircuitBreaker(success, {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 50,
    windowSize: 5,
    volumeThreshold: 3,
    ...opts,
  });
}

async function tripBreaker(cb: CircuitBreaker<string>, times = 3) {
  for (let i = 0; i < times; i++) {
    const breaker = new CircuitBreaker(fail, {
      failureThreshold: times,
      successThreshold: 2,
      timeout: 50,
      windowSize: 10,
      volumeThreshold: times,
    });
    // We need to use the same instance — just call fail directly
    try { await cb.execute(); } catch {}
  }
}

describe("CircuitBreaker", () => {
  describe("CLOSED state", () => {
    it("should start in CLOSED state", () => {
      const cb = new CircuitBreaker(success);
      expect(cb.getState()).toBe("CLOSED");
    });

    it("should execute successfully in CLOSED state", async () => {
      const cb = new CircuitBreaker(success);
      const result = await cb.execute();
      expect(result).toBe("ok");
    });

    it("should not trip before volumeThreshold is reached", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 2,
        volumeThreshold: 5,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      // 4 failures — below volumeThreshold of 5
      for (let i = 0; i < 4; i++) {
        try { await cb.execute(); } catch {}
      }
      expect(cb.getState()).toBe("CLOSED");
    });

    it("should trip to OPEN after failureThreshold exceeded", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      expect(cb.getState()).toBe("OPEN");
    });
  });

  describe("OPEN state", () => {
    it("should reject calls when OPEN", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }

      await expect(cb.execute()).rejects.toThrow(/OPEN/);
    });

    it("should increment rejected count", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      try { await cb.execute(); } catch {}

      expect(cb.getStats().rejected).toBe(1);
    });

    it("should transition to HALF_OPEN after timeout (via event)", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      const events: string[] = [];
      cb.on((e) => events.push(e.type));

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      expect(cb.getState()).toBe("OPEN");

      await new Promise((r) => setTimeout(r, 50));

      // Next call triggers HALF_OPEN, then fails → re-opens
      try { await cb.execute(); } catch {}
      expect(events).toContain("half_open");
    });
  });

  describe("HALF_OPEN state", () => {
    async function getHalfOpenBreaker() {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 50));
      // Trigger HALF_OPEN
      try { await cb.execute(); } catch {}
      return cb;
    }

    it("should re-open on failure in HALF_OPEN", async () => {
      const cb = await getHalfOpenBreaker();
      // After getHalfOpenBreaker, the last call already failed and re-opened
      // Verify the half_open event was emitted and state is now OPEN again
      expect(cb.getState()).toBe("OPEN");
    });

    it("should close after successThreshold successes in HALF_OPEN", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const successFn = vi.fn().mockResolvedValue("ok");

      // Start with fail, trip, wait, then switch to success
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 50));

      // Replace internal fn with success — use a wrapper
      const successCb = new CircuitBreaker(successFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      // Manually force HALF_OPEN by resetting and checking
      // Instead, test via reset + direct state manipulation
      // Simpler: use a breaker that starts in HALF_OPEN via timeout
      const cb2 = new CircuitBreaker(successFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      // Force OPEN by using a fail wrapper, then switch
      const failWrapper = { fn: failFn };
      const dynamic = new CircuitBreaker(
        (...args) => failWrapper.fn(...args) as Promise<string>,
        { failureThreshold: 3, volumeThreshold: 3, successThreshold: 2, timeout: 30, windowSize: 10 }
      );

      for (let i = 0; i < 3; i++) {
        try { await dynamic.execute(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 50));

      // Switch to success
      failWrapper.fn = successFn as unknown as typeof failFn;

      // 2 successes should close
      await dynamic.execute();
      await dynamic.execute();
      expect(dynamic.getState()).toBe("CLOSED");
    });
  });

  describe("executeWithFallback", () => {
    it("should return fallback when circuit is OPEN", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }

      const result = await cb.executeWithFallback(() => "fallback");
      expect(result).toBe("fallback");
    });

    it("should return normal result when CLOSED", async () => {
      const cb = new CircuitBreaker(success);
      const result = await cb.executeWithFallback(() => "fallback");
      expect(result).toBe("ok");
    });
  });

  describe("events", () => {
    it("should emit open event when tripped", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      const events: string[] = [];
      cb.on((e) => events.push(e.type));

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }

      expect(events).toContain("open");
    });

    it("should emit half_open event after timeout", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 30,
        windowSize: 10,
      });

      const events: string[] = [];
      cb.on((e) => events.push(e.type));

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 50));
      try { await cb.execute(); } catch {}

      expect(events).toContain("half_open");
    });

    it("should unsubscribe listener", async () => {
      const cb = new CircuitBreaker(success);
      const events: string[] = [];
      const unsub = cb.on((e) => events.push(e.type));
      unsub();
      await cb.execute();
      expect(events).toEqual([]);
    });
  });

  describe("getStats", () => {
    it("should track failures and successes", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 10,
        volumeThreshold: 10,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      try { await cb.execute(); } catch {}
      try { await cb.execute(); } catch {}

      const stats = cb.getStats();
      expect(stats.failures).toBe(2);
      expect(stats.state).toBe("CLOSED");
    });
  });

  describe("reset", () => {
    it("should reset to CLOSED state", async () => {
      const failFn = vi.fn().mockRejectedValue(new Error("fail"));
      const cb = new CircuitBreaker(failFn, {
        failureThreshold: 3,
        volumeThreshold: 3,
        successThreshold: 2,
        timeout: 50,
        windowSize: 10,
      });

      for (let i = 0; i < 3; i++) {
        try { await cb.execute(); } catch {}
      }
      expect(cb.getState()).toBe("OPEN");

      cb.reset();
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.getStats().rejected).toBe(0);
    });
  });
});
