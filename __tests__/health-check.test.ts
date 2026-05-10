import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HealthCheckSystem } from "../lib/agent/monitoring/health-check";
import type { HealthCheckResult } from "../lib/agent/monitoring/health-check";

function healthy(msg?: string) {
  return async () => ({ status: "healthy" as const, message: msg });
}
function degraded(msg?: string) {
  return async () => ({ status: "degraded" as const, message: msg });
}
function unhealthy(msg?: string) {
  return async () => ({ status: "unhealthy" as const, message: msg });
}
function slow(ms: number) {
  return async () => {
    await new Promise((r) => setTimeout(r, ms));
    return { status: "healthy" as const };
  };
}

describe("HealthCheckSystem", () => {
  let system: HealthCheckSystem;

  beforeEach(() => {
    system = new HealthCheckSystem();
  });

  afterEach(() => {
    system.stopPeriodicChecks();
  });

  describe("register / unregister", () => {
    it("should register a check", async () => {
      system.register({ name: "db", check: healthy() });
      const result = await system.check("db");
      expect(result.name).toBe("db");
    });

    it("should throw for unregistered check", async () => {
      await expect(system.check("missing")).rejects.toThrow(/not registered/i);
    });

    it("should unregister a check", async () => {
      system.register({ name: "db", check: healthy() });
      system.unregister("db");
      await expect(system.check("db")).rejects.toThrow(/not registered/i);
    });
  });

  describe("check()", () => {
    it("should return healthy result", async () => {
      system.register({ name: "api", check: healthy("all good") });
      const result = await system.check("api");
      expect(result.status).toBe("healthy");
      expect(result.message).toBe("all good");
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should return degraded result", async () => {
      system.register({ name: "cache", check: degraded("slow response") });
      const result = await system.check("cache");
      expect(result.status).toBe("degraded");
    });

    it("should return unhealthy on thrown error", async () => {
      system.register({
        name: "db",
        check: async () => { throw new Error("connection refused"); },
      });
      const result = await system.check("db");
      expect(result.status).toBe("unhealthy");
      expect(result.message).toMatch(/connection refused/);
    });

    it("should timeout and return unhealthy", async () => {
      system.register({ name: "slow", check: slow(200), timeout: 50 });
      const result = await system.check("slow");
      expect(result.status).toBe("unhealthy");
      expect(result.message).toMatch(/timed out/i);
    });

    it("should record duration", async () => {
      system.register({ name: "api", check: healthy() });
      const result = await system.check("api");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should store metadata from check", async () => {
      system.register({
        name: "db",
        check: async () => ({
          status: "healthy",
          metadata: { connections: 5, maxConnections: 10 },
        }),
      });
      const result = await system.check("db");
      expect(result.metadata?.connections).toBe(5);
    });
  });

  describe("checkAll()", () => {
    it("should run all registered checks", async () => {
      system.register({ name: "db", check: healthy() });
      system.register({ name: "cache", check: healthy() });
      system.register({ name: "api", check: healthy() });

      const report = await system.checkAll();
      expect(report.checks).toHaveLength(3);
    });

    it("should aggregate to healthy when all healthy", async () => {
      system.register({ name: "db", check: healthy() });
      system.register({ name: "cache", check: healthy() });
      const report = await system.checkAll();
      expect(report.status).toBe("healthy");
    });

    it("should aggregate to degraded when any degraded", async () => {
      system.register({ name: "db", check: healthy() });
      system.register({ name: "cache", check: degraded() });
      const report = await system.checkAll();
      expect(report.status).toBe("degraded");
    });

    it("should aggregate to unhealthy when critical check fails", async () => {
      system.register({ name: "db", check: unhealthy(), critical: true });
      system.register({ name: "cache", check: healthy() });
      const report = await system.checkAll();
      expect(report.status).toBe("unhealthy");
    });

    it("should aggregate to degraded when non-critical check fails", async () => {
      system.register({ name: "db", check: healthy() });
      system.register({ name: "analytics", check: unhealthy(), critical: false });
      const report = await system.checkAll();
      expect(report.status).toBe("degraded");
    });

    it("should include uptime in report", async () => {
      system.register({ name: "db", check: healthy() });
      const report = await system.checkAll();
      expect(report.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should emit report to listeners", async () => {
      system.register({ name: "db", check: healthy() });
      const reports: string[] = [];
      system.onReport((r) => reports.push(r.status));
      await system.checkAll();
      expect(reports).toContain("healthy");
    });
  });

  describe("getLastResult / getLastReport", () => {
    it("should return null before any checks", () => {
      expect(system.getLastReport()).toBeNull();
    });

    it("should return last result for a check", async () => {
      system.register({ name: "db", check: healthy("ok") });
      await system.check("db");
      const result = system.getLastResult("db");
      expect(result?.status).toBe("healthy");
    });

    it("should return last report after checkAll", async () => {
      system.register({ name: "db", check: healthy() });
      await system.checkAll();
      const report = system.getLastReport();
      expect(report?.status).toBe("healthy");
    });
  });

  describe("history", () => {
    it("should record check history", async () => {
      system.register({ name: "db", check: healthy() });
      await system.check("db");
      await system.check("db");
      const history = system.getHistory("db");
      expect(history).toHaveLength(2);
    });

    it("should return all history without filter", async () => {
      system.register({ name: "db", check: healthy() });
      system.register({ name: "cache", check: healthy() });
      await system.checkAll();
      const history = system.getHistory();
      expect(history).toHaveLength(2);
    });
  });

  describe("onReport listener", () => {
    it("should unsubscribe listener", async () => {
      system.register({ name: "db", check: healthy() });
      const calls: number[] = [];
      const unsub = system.onReport(() => calls.push(1));
      unsub();
      await system.checkAll();
      expect(calls).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should track healthy/degraded/unhealthy counts", async () => {
      system.register({ name: "a", check: healthy() });
      system.register({ name: "b", check: degraded() });
      system.register({ name: "c", check: unhealthy() });
      await system.checkAll();

      const stats = system.getStats();
      expect(stats.registered).toBe(3);
      expect(stats.healthy).toBe(1);
      expect(stats.degraded).toBe(1);
      expect(stats.unhealthy).toBe(1);
    });
  });

  describe("periodic checks", () => {
    it("should run checks periodically", async () => {
      let count = 0;
      system.register({ name: "tick", check: async () => { count++; return { status: "healthy" }; } });
      system.startPeriodicChecks(30);
      await new Promise((r) => setTimeout(r, 100));
      system.stopPeriodicChecks();
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });
});
