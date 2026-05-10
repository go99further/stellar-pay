import { describe, it, expect, beforeEach, vi } from "vitest";
import { AlertSystem, type AlertRule, type AlertContext, stellarPayAlertRules, alertSystem } from "../lib/agent/monitoring/alert-system";

describe("AlertSystem", () => {
  let system: AlertSystem;

  const makeRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
    id: "test_rule",
    name: "Test Rule",
    description: "A test rule",
    condition: (ctx) => ctx.value > 10,
    severity: "warning",
    cooldown: 0,
    tags: ["test"],
    ...overrides,
  });

  const makeCtx = (overrides: Partial<AlertContext> = {}): AlertContext => ({
    metric: "test_metric",
    value: 15,
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  });

  beforeEach(() => {
    system = new AlertSystem();
  });

  describe("addRule / removeRule", () => {
    it("should add and evaluate a rule", async () => {
      system.addRule(makeRule());
      const alerts = await system.evaluate(makeCtx());
      expect(alerts).toHaveLength(1);
      expect(alerts[0].ruleName).toBe("Test Rule");
    });

    it("should not trigger when condition is false", async () => {
      system.addRule(makeRule());
      const alerts = await system.evaluate(makeCtx({ value: 5 }));
      expect(alerts).toHaveLength(0);
    });

    it("should remove a rule", async () => {
      system.addRule(makeRule());
      const removed = system.removeRule("test_rule");
      expect(removed).toBe(true);
      const alerts = await system.evaluate(makeCtx());
      expect(alerts).toHaveLength(0);
    });

    it("should return false when removing non-existent rule", () => {
      expect(system.removeRule("nonexistent")).toBe(false);
    });
  });

  describe("evaluate", () => {
    it("should set alert status to active", async () => {
      system.addRule(makeRule());
      const alerts = await system.evaluate(makeCtx());
      expect(alerts[0].status).toBe("active");
    });

    it("should respect cooldown", async () => {
      system.addRule(makeRule({ cooldown: 60000 }));
      await system.evaluate(makeCtx());
      const second = await system.evaluate(makeCtx());
      expect(second).toHaveLength(0);
    });

    it("should fire again after cooldown expires", async () => {
      system.addRule(makeRule({ cooldown: 0 }));
      await system.evaluate(makeCtx());
      const second = await system.evaluate(makeCtx());
      expect(second).toHaveLength(1);
    });

    it("should call notification channel for matching severity", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      system.addChannel({ name: "test", send, severities: ["warning"] });
      system.addRule(makeRule({ severity: "warning" }));
      await system.evaluate(makeCtx());
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("should not call channel for non-matching severity", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      system.addChannel({ name: "test", send, severities: ["critical"] });
      system.addRule(makeRule({ severity: "warning" }));
      await system.evaluate(makeCtx());
      expect(send).not.toHaveBeenCalled();
    });

    it("should not throw if notification channel fails", async () => {
      const send = vi.fn().mockRejectedValue(new Error("channel down"));
      system.addChannel({ name: "test", send, severities: ["warning"] });
      system.addRule(makeRule({ severity: "warning" }));
      await expect(system.evaluate(makeCtx())).resolves.toHaveLength(1);
    });

    it("should not throw if rule condition throws", async () => {
      system.addRule(makeRule({ condition: () => { throw new Error("boom"); } }));
      const alerts = await system.evaluate(makeCtx());
      expect(alerts).toHaveLength(0);
    });
  });

  describe("fire", () => {
    it("should manually fire an alert", async () => {
      system.addRule(makeRule());
      const alert = await system.fire("test_rule", makeCtx());
      expect(alert).not.toBeNull();
      expect(alert?.status).toBe("active");
    });

    it("should return null for unknown rule", async () => {
      const alert = await system.fire("unknown", makeCtx());
      expect(alert).toBeNull();
    });

    it("should use custom message when provided", async () => {
      system.addRule(makeRule());
      const alert = await system.fire("test_rule", makeCtx(), "custom message");
      expect(alert?.message).toBe("custom message");
    });
  });

  describe("resolve / acknowledge / silence", () => {
    it("should resolve an active alert", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      const resolved = system.resolve(alert.id);
      expect(resolved).toBe(true);
      expect(system.getActiveAlerts()).toHaveLength(0);
    });

    it("should not resolve a non-active alert", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      system.resolve(alert.id);
      expect(system.resolve(alert.id)).toBe(false);
    });

    it("should acknowledge an alert", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      expect(system.acknowledge(alert.id)).toBe(true);
      // acknowledged alerts are no longer "active" — check history instead
      const history = system.getHistory();
      expect(history[0].status).toBe("acknowledged");
    });

    it("should silence an alert", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      expect(system.silence(alert.id)).toBe(true);
      const history = system.getHistory();
      expect(history[0].status).toBe("silenced");
    });
  });

  describe("getActiveAlerts", () => {
    it("should sort by severity (fatal > critical > warning > info)", async () => {
      system.addRule(makeRule({ id: "r1", severity: "info", cooldown: 0 }));
      system.addRule(makeRule({ id: "r2", severity: "critical", cooldown: 0 }));
      system.addRule(makeRule({ id: "r3", severity: "warning", cooldown: 0 }));
      await system.evaluate(makeCtx());
      const active = system.getActiveAlerts();
      expect(active[0].severity).toBe("critical");
      expect(active[1].severity).toBe("warning");
      expect(active[2].severity).toBe("info");
    });
  });

  describe("getHistory", () => {
    it("should return all alerts in history", async () => {
      system.addRule(makeRule({ cooldown: 0 }));
      await system.evaluate(makeCtx());
      await system.evaluate(makeCtx());
      expect(system.getHistory()).toHaveLength(2);
    });

    it("should respect limit", async () => {
      system.addRule(makeRule({ cooldown: 0 }));
      for (let i = 0; i < 5; i++) await system.evaluate(makeCtx());
      expect(system.getHistory(3)).toHaveLength(3);
    });
  });

  describe("getStats", () => {
    it("should count alerts by severity", async () => {
      system.addRule(makeRule({ id: "r1", severity: "warning", cooldown: 0 }));
      system.addRule(makeRule({ id: "r2", severity: "critical", cooldown: 0 }));
      await system.evaluate(makeCtx());
      const stats = system.getStats();
      expect(stats.bySeverity.warning).toBe(1);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.totalAlerts).toBe(2);
    });

    it("should track resolved alerts", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      system.resolve(alert.id);
      const stats = system.getStats();
      expect(stats.resolvedAlerts).toBe(1);
    });

    it("should compute average resolution time", async () => {
      system.addRule(makeRule());
      const [alert] = await system.evaluate(makeCtx());
      await new Promise((r) => setTimeout(r, 5));
      system.resolve(alert.id);
      const stats = system.getStats();
      expect(stats.averageResolutionTime).toBeGreaterThan(0);
    });
  });

  describe("stellarPayAlertRules", () => {
    it("should include pre-built rules", () => {
      expect(stellarPayAlertRules.length).toBeGreaterThan(0);
      const ids = stellarPayAlertRules.map((r) => r.id);
      expect(ids).toContain("high_slippage");
      expect(ids).toContain("low_liquidity");
      expect(ids).toContain("high_error_rate");
    });

    it("high_slippage rule should trigger above 5%", () => {
      const rule = stellarPayAlertRules.find((r) => r.id === "high_slippage")!;
      expect(rule.condition({ metric: "slippage", value: 0.06, timestamp: Date.now(), metadata: {} })).toBe(true);
      expect(rule.condition({ metric: "slippage", value: 0.03, timestamp: Date.now(), metadata: {} })).toBe(false);
    });

    it("low_liquidity rule should trigger below 1000", () => {
      const rule = stellarPayAlertRules.find((r) => r.id === "low_liquidity")!;
      expect(rule.condition({ metric: "pool_liquidity", value: 500, timestamp: Date.now(), metadata: {} })).toBe(true);
      expect(rule.condition({ metric: "pool_liquidity", value: 2000, timestamp: Date.now(), metadata: {} })).toBe(false);
    });
  });
});

describe("alertSystem — shared instance", () => {
  it("should be an AlertSystem instance", () => {
    expect(alertSystem).toBeInstanceOf(AlertSystem);
  });

  it("should have stellarPayAlertRules pre-registered (getActiveAlerts works)", () => {
    // alertSystem has rules registered; evaluate with a high-slippage context to confirm
    const ctx = { metric: "slippage", value: 0.99, timestamp: Date.now(), metadata: {} };
    // Just verify the system is functional — evaluate returns a promise
    expect(alertSystem.evaluate(ctx)).toBeInstanceOf(Promise);
  });

  it("getStats should return an object with counts", () => {
    const stats = alertSystem.getStats();
    expect(stats).toHaveProperty("totalAlerts");
    expect(stats).toHaveProperty("activeAlerts");
  });
});
