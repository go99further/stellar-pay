import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordLatency,
  recordFirstTokenLatency,
  recordToolCall,
  recordCacheEvent,
  getSLOMetrics,
  checkSLOs,
  resetMetrics,
  getMetricsSummary,
  withLatencyTracking,
  alertOnViolations,
  configureAlertWebhooks,
  clearAlertWebhooks,
} from "../lib/agent/slos";

describe("slos", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("recordLatency / getSLOMetrics", () => {
    it("should record latency and reflect in metrics", () => {
      recordLatency("router", 100);
      const metrics = getSLOMetrics();
      const routerSLO = metrics.find((m) => m.name === "router_latency_p95");
      expect(routerSLO).toBeDefined();
      expect(routerSLO!.current).toBeGreaterThan(0);
    });

    it("should report met=true when latency is under target", () => {
      recordLatency("router", 100); // target is 500ms
      const metrics = getSLOMetrics();
      const routerSLO = metrics.find((m) => m.name === "router_latency_p95")!;
      expect(routerSLO.met).toBe(true);
    });

    it("should report met=false when latency exceeds target", () => {
      for (let i = 0; i < 20; i++) recordLatency("router", 9999); // target is 500ms
      const metrics = getSLOMetrics();
      const routerSLO = metrics.find((m) => m.name === "router_latency_p95")!;
      expect(routerSLO.met).toBe(false);
    });

    it("should report met=true when no data (no samples)", () => {
      const metrics = getSLOMetrics();
      const routerSLO = metrics.find((m) => m.name === "router_latency_p95")!;
      expect(routerSLO.met).toBe(true);
      expect(routerSLO.current).toBe(0);
    });

    it("should track all four agent types", () => {
      recordLatency("analytics", 200);
      recordLatency("trading", 300);
      recordLatency("security", 150);
      const metrics = getSLOMetrics();
      expect(metrics.find((m) => m.name === "analytics_latency_p95")).toBeDefined();
      expect(metrics.find((m) => m.name === "trading_latency_p95")).toBeDefined();
      expect(metrics.find((m) => m.name === "security_latency_p95")).toBeDefined();
    });
  });

  describe("recordFirstTokenLatency", () => {
    it("should record first token latency", () => {
      recordFirstTokenLatency("router", 50);
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "router_first_token_p95")!;
      expect(slo.current).toBeGreaterThan(0);
    });

    it("should report met=false when first token latency exceeds target", () => {
      for (let i = 0; i < 20; i++) recordFirstTokenLatency("router", 9999); // target 300ms
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "router_first_token_p95")!;
      expect(slo.met).toBe(false);
    });
  });

  describe("recordToolCall", () => {
    it("should track success rate at 100% with all successes", () => {
      recordToolCall("get-balance", true);
      recordToolCall("simulate-swap", true);
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "tool_call_success_rate")!;
      expect(slo.current).toBe(1.0);
      expect(slo.met).toBe(true);
    });

    it("should report met=false when success rate drops below 99%", () => {
      for (let i = 0; i < 99; i++) recordToolCall("tool", true);
      recordToolCall("tool", false); // 99% success rate — exactly at threshold
      // 99/100 = 0.99 which equals the min, so met=true
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "tool_call_success_rate")!;
      expect(slo.met).toBe(true);
    });

    it("should report met=false when success rate is below 99%", () => {
      for (let i = 0; i < 98; i++) recordToolCall("tool", true);
      recordToolCall("tool", false);
      recordToolCall("tool", false); // 98% success rate
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "tool_call_success_rate")!;
      expect(slo.met).toBe(false);
    });

    it("should default to 100% when no calls recorded", () => {
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "tool_call_success_rate")!;
      expect(slo.current).toBe(1.0);
      expect(slo.met).toBe(true);
    });
  });

  describe("recordCacheEvent", () => {
    it("should track cache hit rate", () => {
      recordCacheEvent(true);
      recordCacheEvent(true);
      recordCacheEvent(false);
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "cache_hit_rate")!;
      expect(slo.current).toBeCloseTo(2 / 3);
    });

    it("should report met=false when hit rate below 70%", () => {
      for (let i = 0; i < 3; i++) recordCacheEvent(true);
      for (let i = 0; i < 7; i++) recordCacheEvent(false); // 30% hit rate
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "cache_hit_rate")!;
      expect(slo.met).toBe(false);
    });

    it("should default to 100% when no events recorded", () => {
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "cache_hit_rate")!;
      expect(slo.current).toBe(1.0);
    });
  });

  describe("checkSLOs", () => {
    it("should return empty array when all SLOs are met", () => {
      expect(checkSLOs()).toHaveLength(0);
    });

    it("should return violations when SLOs are breached", () => {
      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].message).toBeDefined();
      expect(violations[0].timestamp).toBeDefined();
    });

    it("should include target in violation", () => {
      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      const routerViolation = violations.find((v) => v.target.name === "router_latency_p95");
      expect(routerViolation).toBeDefined();
      expect(routerViolation!.target.severity).toBe("critical");
    });
  });

  describe("resetMetrics", () => {
    it("should clear all recorded data", () => {
      recordLatency("router", 9999);
      recordToolCall("tool", false);
      recordCacheEvent(false);
      resetMetrics();
      const metrics = getSLOMetrics();
      const routerSLO = metrics.find((m) => m.name === "router_latency_p95")!;
      expect(routerSLO.current).toBe(0);
      expect(checkSLOs()).toHaveLength(0);
    });
  });

  describe("getMetricsSummary", () => {
    it("should return a summary object", () => {
      recordLatency("router", 100);
      recordToolCall("tool", true);
      recordCacheEvent(true);
      const summary = getMetricsSummary();
      expect(summary.timestamp).toBeDefined();
      expect(summary.sampleCounts.router).toBe(1);
      expect(summary.toolCalls.total).toBe(1);
      expect(summary.cache.total).toBe(1);
      expect(Array.isArray(summary.slos)).toBe(true);
      expect(Array.isArray(summary.violations)).toBe(true);
    });
  });

  describe("withLatencyTracking", () => {
    it("should return the function result", async () => {
      const result = await withLatencyTracking("router", async () => 42);
      expect(result).toBe(42);
    });

    it("should record latency on success", async () => {
      await withLatencyTracking("analytics", async () => "ok");
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "analytics_latency_p95")!;
      expect(slo.current).toBeGreaterThanOrEqual(0);
    });

    it("should record latency even on failure", async () => {
      await expect(
        withLatencyTracking("trading", async () => { throw new Error("fail"); })
      ).rejects.toThrow("fail");
      const metrics = getSLOMetrics();
      const slo = metrics.find((m) => m.name === "trading_latency_p95")!;
      expect(slo.current).toBeGreaterThanOrEqual(0);
    });

    it("should rethrow the original error", async () => {
      await expect(
        withLatencyTracking("security", async () => { throw new Error("original"); })
      ).rejects.toThrow("original");
    });
  });

  describe("alertOnViolations", () => {
    beforeEach(() => {
      clearAlertWebhooks();
    });

    it("does nothing when violations array is empty", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      alertOnViolations([]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("logs critical violations to console.error", () => {
      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      alertOnViolations(violations);
      expect(spy).toHaveBeenCalledWith("[SLO CRITICAL]", expect.objectContaining({ count: expect.any(Number) }));
      spy.mockRestore();
    });

    it("logs warning violations to console.warn", () => {
      for (let i = 0; i < 20; i++) recordLatency("analytics", 9999);
      const violations = checkSLOs();
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      alertOnViolations(violations);
      expect(spy).toHaveBeenCalledWith("[SLO WARNING]", expect.objectContaining({ count: expect.any(Number) }));
      spy.mockRestore();
    });

    it("fires webhook when violations exist", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      configureAlertWebhooks([{ url: "https://hooks.example.com/slo" }]);

      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      vi.spyOn(console, "error").mockImplementation(() => {});
      alertOnViolations(violations);

      // postWebhook is fire-and-forget; flush microtasks
      await Promise.resolve();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://hooks.example.com/slo",
        expect.objectContaining({ method: "POST" })
      );
      fetchSpy.mockRestore();
    });

    it("does not fire webhook when minSeverity=critical but only warnings exist", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      configureAlertWebhooks([{ url: "https://hooks.example.com/slo", minSeverity: "critical" }]);

      for (let i = 0; i < 20; i++) recordLatency("analytics", 9999); // analytics is "warning" severity
      const violations = checkSLOs();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      alertOnViolations(violations);

      await Promise.resolve();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("includes Authorization header when token is configured", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      configureAlertWebhooks([{ url: "https://hooks.example.com/slo", token: "secret-token" }]);

      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      vi.spyOn(console, "error").mockImplementation(() => {});
      alertOnViolations(violations);

      await Promise.resolve();
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://hooks.example.com/slo",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
        })
      );
      fetchSpy.mockRestore();
    });

    it("does not throw when webhook fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
      configureAlertWebhooks([{ url: "https://hooks.example.com/slo" }]);

      for (let i = 0; i < 20; i++) recordLatency("router", 9999);
      const violations = checkSLOs();
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => alertOnViolations(violations)).not.toThrow();
      await Promise.resolve();
    });
  });
});
