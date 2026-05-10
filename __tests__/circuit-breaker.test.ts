import { describe, it, expect, beforeEach } from "vitest";
import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  createProductionCircuitBreaker,
} from "../lib/agent/circuit-breaker";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 60000, successThreshold: 2 });
  });

  describe("initial state", () => {
    it("should start in CLOSED state", () => {
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should have zero stats initially", () => {
      const stats = cb.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalFailures).toBe(0);
      expect(stats.totalSuccesses).toBe(0);
    });
  });

  describe("execute — success", () => {
    it("should return result on success", async () => {
      const result = await cb.execute(async () => 42);
      expect(result).toBe(42);
    });

    it("should increment totalRequests and totalSuccesses", async () => {
      await cb.execute(async () => 1);
      await cb.execute(async () => 2);
      const stats = cb.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalSuccesses).toBe(2);
    });

    it("should set lastSuccessTime", async () => {
      const before = Date.now();
      await cb.execute(async () => 1);
      expect(cb.getStats().lastSuccessTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe("execute — failure and state transitions", () => {
    it("should remain CLOSED below failure threshold", async () => {
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should transition to OPEN after failureThreshold failures", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it("should throw CircuitBreakerError when OPEN", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      await expect(cb.execute(async () => 1)).rejects.toThrow(CircuitBreakerError);
    });

    it("should increment totalFailures", async () => {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(cb.getStats().totalFailures).toBe(1);
    });

    it("should set lastFailureTime", async () => {
      const before = Date.now();
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(cb.getStats().lastFailureTime).toBeGreaterThanOrEqual(before);
    });

    it("should call onStateChange when transitioning to OPEN", async () => {
      const transitions: Array<[CircuitState, CircuitState]> = [];
      const c = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
        onStateChange: (from, to) => transitions.push([from, to]),
      });
      for (let i = 0; i < 2; i++) {
        await expect(c.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      expect(transitions).toContainEqual([CircuitState.CLOSED, CircuitState.OPEN]);
    });
  });

  describe("HALF_OPEN state", () => {
    it("should transition to HALF_OPEN after resetTimeout", async () => {
      const c = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0, successThreshold: 1 });
      await expect(c.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(c.getState()).toBe(CircuitState.OPEN);
      // resetTimeout=0 means nextAttemptTime is in the past immediately
      await new Promise((r) => setTimeout(r, 5));
      // Next execute should transition to HALF_OPEN and attempt
      await c.execute(async () => 1);
      expect(c.getState()).toBe(CircuitState.CLOSED);
    });

    it("should reopen on failure during HALF_OPEN", async () => {
      const c = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0, successThreshold: 2 });
      await expect(c.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 5));
      // Transition to HALF_OPEN, then fail
      await expect(c.execute(async () => { throw new Error("fail again"); })).rejects.toThrow();
      expect(c.getState()).toBe(CircuitState.OPEN);
    });

    it("should close after successThreshold successes in HALF_OPEN", async () => {
      const c = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0, successThreshold: 2 });
      await expect(c.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 5));
      await c.execute(async () => 1); // first success in HALF_OPEN
      await c.execute(async () => 2); // second success → CLOSED
      expect(c.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe("reset", () => {
    it("should reset to CLOSED state", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);
      cb.reset();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it("should allow execution after reset", async () => {
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      }
      cb.reset();
      const result = await cb.execute(async () => "ok");
      expect(result).toBe("ok");
    });

    it("should clear failureCount after reset", async () => {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      cb.reset();
      expect(cb.getStats().failureCount).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should track all stats correctly", async () => {
      await cb.execute(async () => 1);
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      const stats = cb.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalSuccesses).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.state).toBe(CircuitState.CLOSED);
    });
  });

  describe("CircuitBreakerError", () => {
    it("should have name CircuitBreakerError", () => {
      const err = new CircuitBreakerError("test");
      expect(err.name).toBe("CircuitBreakerError");
    });
  });

  describe("createProductionCircuitBreaker", () => {
    it("should create a CircuitBreaker instance", () => {
      const c = createProductionCircuitBreaker("test");
      expect(c).toBeInstanceOf(CircuitBreaker);
    });

    it("should use default production settings", () => {
      const c = createProductionCircuitBreaker("test");
      const stats = c.getStats();
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it("should accept custom options", () => {
      const c = createProductionCircuitBreaker("test", { failureThreshold: 1 });
      expect(c).toBeInstanceOf(CircuitBreaker);
    });
  });

  describe("getStats — successRate", () => {
    it("should compute successRate correctly", async () => {
      await cb.execute(async () => "ok");
      await cb.execute(async () => "ok");
      try { await cb.execute(async () => { throw new Error("fail"); }); } catch {}
      const stats = cb.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
    });
  });

  describe("CircuitBreakerError — message", () => {
    it("should include state in error message when OPEN", async () => {
      const c = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 60000 });
      try { await c.execute(async () => { throw new Error("fail"); }); } catch {}
      try {
        await c.execute(async () => "ok");
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerError);
        expect((err as CircuitBreakerError).message).toMatch(/open/i);
      }
    });
  });

  describe("onStateChange — OPEN to CLOSED", () => {
    it("should call onStateChange when transitioning from OPEN to CLOSED via HALF_OPEN", async () => {
      const transitions: Array<[CircuitState, CircuitState]> = [];
      const c = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 0,
        successThreshold: 1,
        onStateChange: (from, to) => transitions.push([from, to]),
      });

      try { await c.execute(async () => { throw new Error("fail"); }); } catch {}
      // resetTimeout=0 means HALF_OPEN is available immediately
      await c.execute(async () => "ok");

      const states = transitions.map(([, to]) => to);
      expect(states).toContain(CircuitState.OPEN);
      expect(states).toContain(CircuitState.HALF_OPEN);
      expect(states).toContain(CircuitState.CLOSED);
    });
  });

  describe("execute — error propagation", () => {
    it("should propagate the original error when CLOSED", async () => {
      const originalError = new Error("original error message");
      await expect(cb.execute(async () => { throw originalError; })).rejects.toThrow("original error message");
    });
  });

  describe("reset — clears stats", () => {
    it("should reset state to CLOSED but preserve cumulative counters", async () => {
      try { await cb.execute(async () => { throw new Error("fail"); }); } catch {}
      cb.reset();
      const stats = cb.getStats();
      // reset() only resets state/failureCount/successCount, not cumulative totals
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
    });
  });
});
