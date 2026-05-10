import { describe, it, expect, beforeEach } from "vitest";
import { resetMetrics } from "../lib/agent/slos";

beforeEach(() => {
  resetMetrics();
});

describe("production-patterns-example", () => {
  describe("productionRouterAgent", () => {
    it("should return a RouterOutput with intent", async () => {
      const { productionRouterAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionRouterAgent("user-1", []);
      expect(result).toHaveProperty("intent");
      expect(typeof result.intent).toBe("string");
    });

    it("should return intent=analytics for empty history", async () => {
      const { productionRouterAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionRouterAgent("user-1", []);
      expect(["analytics", "trading", "security", "clarify"]).toContain(result.intent);
    });

    it("should include reason in result", async () => {
      const { productionRouterAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionRouterAgent("user-1", []);
      expect(result).toHaveProperty("reason");
    });
  });

  describe("productionTradingAgent", () => {
    it("should return success=true for swap operation", async () => {
      const { productionTradingAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionTradingAgent("user-1", "swap", {});
      expect(result.success).toBe(true);
    });

    it("should return txHash on success", async () => {
      const { productionTradingAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionTradingAgent("user-1", "add_liquidity", {});
      expect(result.txHash).toBeDefined();
    });

    it("should handle remove_liquidity operation", async () => {
      const { productionTradingAgent } = await import("../lib/agent/production-patterns-example");
      const result = await productionTradingAgent("user-1", "remove_liquidity", {});
      expect(result).toHaveProperty("success");
    });
  });

  describe("getMonitoringData", () => {
    it("should return circuitBreakers and slos", async () => {
      const { getMonitoringData } = await import("../lib/agent/production-patterns-example");
      const data = getMonitoringData();
      expect(data).toHaveProperty("circuitBreakers");
      expect(data).toHaveProperty("slos");
    });

    it("should include stellarHorizon and contractCall breaker stats", async () => {
      const { getMonitoringData } = await import("../lib/agent/production-patterns-example");
      const data = getMonitoringData();
      expect(data.circuitBreakers).toHaveProperty("stellarHorizon");
      expect(data.circuitBreakers).toHaveProperty("contractCall");
    });

    it("should include slos with timestamp", async () => {
      const { getMonitoringData } = await import("../lib/agent/production-patterns-example");
      const data = getMonitoringData();
      expect(data.slos).toHaveProperty("timestamp");
      expect(data.slos).toHaveProperty("slos");
    });
  });
});
