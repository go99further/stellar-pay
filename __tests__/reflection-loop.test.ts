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

    it("should report totalPatterns", () => {
      loop.reflect("op_1", "success", { duration: 1000, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 }, { operationType: "swap" });
      loop.reflect("op_2", "failure", { duration: 2000, retryCount: 1, errorCount: 1, successRate: 0.5, efficiency: 0.5 }, { operationType: "liquidity" });
      const stats = loop.getStatistics();
      expect(stats.totalPatterns).toBeGreaterThanOrEqual(2);
    });

    it("should report mostCommonPattern", () => {
      for (let i = 0; i < 3; i++) {
        loop.reflect(`op_${i}`, "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.95 }, { operationType: "swap" });
      }
      loop.reflect("op_x", "failure", { duration: 2000, retryCount: 1, errorCount: 1, successRate: 0.5, efficiency: 0.4 }, { operationType: "liquidity" });
      const stats = loop.getStatistics();
      expect(stats.mostCommonPattern).toContain("swap");
    });

    it("should return none for mostCommonPattern when empty", () => {
      const stats = loop.getStatistics();
      expect(stats.mostCommonPattern).toBe("none");
    });
  });

  describe("getReflection", () => {
    it("should return reflection by id", () => {
      const r = loop.reflect("op_1", "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 });
      const found = loop.getReflection(r.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(r.id);
    });

    it("should return null for unknown id", () => {
      expect(loop.getReflection("nonexistent")).toBeNull();
    });
  });

  describe("getRecentReflections", () => {
    it("should return most recent reflections in descending order", () => {
      for (let i = 0; i < 5; i++) {
        loop.reflect(`op_${i}`, "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 });
      }
      const recent = loop.getRecentReflections(3);
      expect(recent).toHaveLength(3);
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i - 1].timestamp).toBeGreaterThanOrEqual(recent[i].timestamp);
      }
    });

    it("should default to 10 entries", () => {
      for (let i = 0; i < 15; i++) {
        loop.reflect(`op_${i}`, "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 });
      }
      expect(loop.getRecentReflections()).toHaveLength(10);
    });
  });

  describe("getPattern", () => {
    it("should return pattern by key", () => {
      loop.reflect("op_1", "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 }, { operationType: "swap" });
      const pattern = loop.getPattern("swap:success:clean");
      expect(pattern).not.toBeNull();
      expect(pattern!.occurrences).toBe(1);
    });

    it("should return null for unknown pattern key", () => {
      expect(loop.getPattern("unknown:key")).toBeNull();
    });
  });

  describe("clearAll", () => {
    it("should clear all reflections and patterns", () => {
      loop.reflect("op_1", "success", { duration: 500, retryCount: 0, errorCount: 0, successRate: 1.0, efficiency: 0.9 });
      loop.clearAll();
      const stats = loop.getStatistics();
      expect(stats.totalReflections).toBe(0);
      expect(stats.totalPatterns).toBe(0);
    });
  });

  describe("global reflectionLoop instance", () => {
    it("should be a shared ReflectionLoop instance", async () => {
      const { reflectionLoop } = await import("../lib/agent/learning/reflection-loop");
      expect(reflectionLoop).toBeInstanceOf(ReflectionLoop);
    });
  });
});
