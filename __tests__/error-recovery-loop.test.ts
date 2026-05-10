import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ErrorRecoveryLoop,
  RecoveryError,
  errorRecoveryLoop,
  withRecovery,
} from "../lib/agent/recovery/error-recovery-loop";

describe("ErrorRecoveryLoop", () => {
  let loop: ErrorRecoveryLoop;

  beforeEach(() => {
    loop = new ErrorRecoveryLoop({
      maxRetries: 2,
      baseDelay: 0,
      maxDelay: 0,
      jitterFactor: 0,
      useCircuitBreaker: false,
    });
  });

  describe("execute — success", () => {
    it("should return result on first attempt", async () => {
      const result = await loop.execute(async () => 42, "op-1");
      expect(result).toBe(42);
    });

    it("should mark trajectory as recovered", async () => {
      await loop.execute(async () => "ok", "op-2");
      const traj = loop.getTrajectory("op-2")!;
      expect(traj.recovered).toBe(true);
      expect(traj.finalResult).toBe("ok");
    });

    it("should set endTime on success", async () => {
      await loop.execute(async () => 1, "op-3");
      const traj = loop.getTrajectory("op-3")!;
      expect(traj.endTime).toBeDefined();
    });

    it("should call onRecovery callback", async () => {
      let called: unknown = null;
      const l = new ErrorRecoveryLoop({
        maxRetries: 0,
        baseDelay: 0,
        maxDelay: 0,
        jitterFactor: 0,
        useCircuitBreaker: false,
        onRecovery: (r) => { called = r; },
      });
      await l.execute(async () => "done", "op");
      expect(called).toBe("done");
    });
  });

  describe("execute — retry on retryable errors", () => {
    it("should retry and succeed on second attempt", async () => {
      let attempts = 0;
      const result = await loop.execute(async () => {
        attempts++;
        if (attempts < 2) throw new Error("network error: timeout");
        return "success";
      }, "op-retry");
      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should record retry attempts in trajectory", async () => {
      let attempts = 0;
      await loop.execute(async () => {
        attempts++;
        if (attempts < 2) throw new Error("network error: timeout");
        return "ok";
      }, "op-traj");
      const traj = loop.getTrajectory("op-traj")!;
      expect(traj.attempts.length).toBeGreaterThanOrEqual(1);
    });

    it("should call onRetry callback on each retry", async () => {
      const retryCalls: number[] = [];
      const l = new ErrorRecoveryLoop({
        maxRetries: 2,
        baseDelay: 0,
        maxDelay: 0,
        jitterFactor: 0,
        useCircuitBreaker: false,
        onRetry: (attempt) => retryCalls.push(attempt),
      });
      let attempts = 0;
      await l.execute(async () => {
        attempts++;
        if (attempts < 3) throw new Error("network error: timeout");
        return "ok";
      }, "op");
      expect(retryCalls).toContain(1);
      expect(retryCalls).toContain(2);
    });
  });

  describe("execute — non-retryable errors", () => {
    it("should throw RecoveryError immediately for non-retryable error", async () => {
      let attempts = 0;
      await expect(
        loop.execute(async () => {
          attempts++;
          throw new Error("user rejected transaction");
        }, "op-nonretry")
      ).rejects.toThrow(RecoveryError);
      expect(attempts).toBe(1);
    });

    it("should throw RecoveryError after exhausting retries", async () => {
      await expect(
        loop.execute(async () => {
          throw new Error("network error: timeout");
        }, "op-exhaust")
      ).rejects.toThrow(RecoveryError);
    });

    it("should set finalError in trajectory on failure", async () => {
      await expect(
        loop.execute(async () => {
          throw new Error("user rejected transaction");
        }, "op-err")
      ).rejects.toThrow();
      const traj = loop.getTrajectory("op-err")!;
      expect(traj.finalError).toBeDefined();
      expect(traj.recovered).toBe(false);
    });

    it("should call onFailure callback", async () => {
      let failedTraj = null;
      const l = new ErrorRecoveryLoop({
        maxRetries: 0,
        baseDelay: 0,
        maxDelay: 0,
        jitterFactor: 0,
        useCircuitBreaker: false,
        onFailure: (t) => { failedTraj = t; },
      });
      await expect(
        l.execute(async () => { throw new Error("user rejected transaction"); }, "op")
      ).rejects.toThrow();
      expect(failedTraj).not.toBeNull();
    });
  });

  describe("RecoveryError", () => {
    it("should have name RecoveryError", async () => {
      try {
        await loop.execute(async () => { throw new Error("user rejected transaction"); }, "op");
      } catch (e) {
        expect(e).toBeInstanceOf(RecoveryError);
        expect((e as RecoveryError).name).toBe("RecoveryError");
        expect((e as RecoveryError).trajectory).toBeDefined();
      }
    });

    it("should include attempt count in message", async () => {
      try {
        await loop.execute(async () => { throw new Error("user rejected transaction"); }, "op");
      } catch (e) {
        expect((e as RecoveryError).message).toContain("attempt");
      }
    });
  });

  describe("getTrajectory / getAllTrajectories", () => {
    it("should return null for unknown operation", () => {
      expect(loop.getTrajectory("nonexistent")).toBeNull();
    });

    it("should return all trajectories", async () => {
      await loop.execute(async () => 1, "op-a");
      await loop.execute(async () => 2, "op-b");
      expect(loop.getAllTrajectories()).toHaveLength(2);
    });
  });

  describe("getStatistics", () => {
    it("should count successful recoveries", async () => {
      await loop.execute(async () => 1, "op-1");
      await loop.execute(async () => 2, "op-2");
      const stats = loop.getStatistics();
      expect(stats.totalOperations).toBe(2);
      expect(stats.successfulRecoveries).toBe(2);
      expect(stats.failedRecoveries).toBe(0);
    });

    it("should count failed recoveries", async () => {
      await expect(
        loop.execute(async () => { throw new Error("user rejected transaction"); }, "op-fail")
      ).rejects.toThrow();
      const stats = loop.getStatistics();
      expect(stats.failedRecoveries).toBe(1);
    });

    it("should compute recoveryRate as percentage", async () => {
      await loop.execute(async () => 1, "op-ok");
      await expect(
        loop.execute(async () => { throw new Error("user rejected transaction"); }, "op-fail")
      ).rejects.toThrow();
      const stats = loop.getStatistics();
      expect(stats.recoveryRate).toBe(50);
    });

    it("should return zero stats when no operations", () => {
      const stats = loop.getStatistics();
      expect(stats.totalOperations).toBe(0);
      expect(stats.recoveryRate).toBe(0);
      expect(stats.averageAttempts).toBe(0);
    });
  });

  describe("clearHistory", () => {
    it("should remove all trajectories", async () => {
      await loop.execute(async () => 1, "op-1");
      loop.clearHistory();
      expect(loop.getAllTrajectories()).toHaveLength(0);
    });
  });

  describe("updateConfig", () => {
    it("should update maxRetries", async () => {
      loop.updateConfig({ maxRetries: 0 });
      let attempts = 0;
      await expect(
        loop.execute(async () => {
          attempts++;
          throw new Error("network error: timeout");
        }, "op")
      ).rejects.toThrow();
      expect(attempts).toBe(1);
    });
  });

  describe("auto-generated operationId", () => {
    it("should generate unique IDs when none provided", async () => {
      await loop.execute(async () => 1);
      await loop.execute(async () => 2);
      const ids = loop.getAllTrajectories().map((t) => t.operationId);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe("global instance / withRecovery", () => {
    it("errorRecoveryLoop should be a shared instance", () => {
      expect(errorRecoveryLoop).toBeInstanceOf(ErrorRecoveryLoop);
    });

    it("withRecovery should succeed", async () => {
      const result = await withRecovery(async () => "hello", {
        maxRetries: 0,
        baseDelay: 0,
        maxDelay: 0,
        jitterFactor: 0,
        useCircuitBreaker: false,
      });
      expect(result).toBe("hello");
    });

    it("withRecovery without config uses global instance", async () => {
      const result = await withRecovery(async () => 99);
      expect(result).toBe(99);
    });
  });
});
