import { describe, it, expect, beforeEach } from "vitest";
import { ReflectionLoop } from "../lib/agent/learning/reflection-loop";

describe("ReflectionLoop", () => {
  let loop: ReflectionLoop;

  beforeEach(() => {
    loop = new ReflectionLoop();
  });

  describe("reflect", () => {
    it("should create reflection for successful operation", () => {
      const reflection = loop.reflect(
        "op_123",
        "success",
        {
          duration: 1000,
          retryCount: 0,
          errorCount: 0,
          successRate: 1.0,
          efficiency: 0.95,
        },
        { operationType: "swap" }
      );

      expect(reflection.id).toBeTruthy();
      expect(reflection.operationId).toBe("op_123");
      expect(reflection.outcome).toBe("success");
      expect(reflection.insights.length).toBeGreaterThan(0);
    });

    it("should generate insights for errors", () => {
      const reflection = loop.reflect(
        "op_456",
        "failure",
        {
          duration: 5000,
          retryCount: 3,
          errorCount: 3,
          successRate: 0.5,
          efficiency: 0.3,
        }
      );

      const errorInsights = reflection.insights.filter((i) => i.type === "error_pattern");
      expect(errorInsights.length).toBeGreaterThan(0);
    });

    it("should generate adjustments for high error count", () => {
      const reflection = loop.reflect(
        "op_789",
        "failure",
        {
          duration: 3000,
          retryCount: 4,
          errorCount: 5,
          successRate: 0.2,
          efficiency: 0.4,
        }
      );

      expect(reflection.adjustments.length).toBeGreaterThan(0);
      expect(reflection.adjustments.some((a) => a.parameter === "maxRetries")).toBe(true);
    });

    it("should identify best practices", () => {
      const reflection = loop.reflect(
        "op_best",
        "success",
        {
          duration: 500,
          retryCount: 0,
          errorCount: 0,
          successRate: 1.0,
          efficiency: 0.95,
        }
      );

      const bestPractices = reflection.insights.filter((i) => i.type === "best_practice");
      expect(bestPractices.length).toBeGreaterThan(0);
    });
  });

  describe("getPatterns", () => {
    it("should learn patterns from reflections", () => {
      loop.reflect("op_1", "success", {
        duration: 1000,
        retryCount: 0,
        errorCount: 0,
        successRate: 1.0,
        efficiency: 0.9,
      }, { operationType: "swap" });

      loop.reflect("op_2", "success", {
        duration: 1200,
        retryCount: 0,
        errorCount: 0,
        successRate: 1.0,
        efficiency: 0.85,
      }, { operationType: "swap" });

      const patterns = loop.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0].pattern).toContain("swap");
    });
  });

  describe("getRecommendations", () => {
    it("should provide recommendations based on learned patterns", () => {
      loop.reflect("op_1", "success", {
        duration: 1000,
        retryCount: 0,
        errorCount: 0,
        successRate: 1.0,
        efficiency: 0.9,
      }, { operationType: "swap" });

      const recommendations = loop.getRecommendations("swap");
      expect(Array.isArray(recommendations)).toBe(true);
    });
  });

  describe("getStatistics", () => {
    it("should return learning statistics", () => {
      loop.reflect("op_1", "success", {
        duration: 1000,
        retryCount: 0,
        errorCount: 0,
        successRate: 1.0,
        efficiency: 0.9,
      });

      loop.reflect("op_2", "failure", {
        duration: 3000,
        retryCount: 2,
        errorCount: 2,
        successRate: 0.5,
        efficiency: 0.5,
      });

      const stats = loop.getStatistics();
      expect(stats.totalReflections).toBe(2);
      expect(stats.averageSuccessRate).toBe(0.5);
    });
  });
});
