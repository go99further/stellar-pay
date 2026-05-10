import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "../lib/agent/monitoring/metrics-collector";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("counter", () => {
    it("should record counter metrics", () => {
      collector.counter("requests", 1);
      collector.counter("requests", 1);
      collector.counter("requests", 1);

      const summary = collector.getSummary("requests");
      expect(summary).toBeDefined();
      expect(summary!.count).toBe(3);
      expect(summary!.sum).toBe(3);
      expect(summary!.type).toBe("counter");
    });

    it("should support tags", () => {
      collector.counter("requests", 1, { method: "GET" });
      collector.counter("requests", 1, { method: "POST" });

      // Different tags = different keys; query without tags returns all
      const all = collector.query({ name: "requests" });
      expect(all.length).toBe(2);
    });
  });

  describe("gauge", () => {
    it("should record gauge metrics", () => {
      collector.gauge("memory", 512);
      collector.gauge("memory", 768);

      const summary = collector.getSummary("memory");
      expect(summary).toBeDefined();
      expect(summary!.type).toBe("gauge");
      expect(summary!.lastValue).toBe(768);
    });
  });

  describe("histogram", () => {
    it("should calculate percentiles", () => {
      // Record 100 values: 1..100
      for (let i = 1; i <= 100; i++) {
        collector.histogram("latency", i);
      }

      const summary = collector.getSummary("latency");
      expect(summary).toBeDefined();
      expect(summary!.count).toBe(100);
      expect(summary!.min).toBe(1);
      expect(summary!.max).toBe(100);
      expect(summary!.p95).toBeGreaterThanOrEqual(94);
      expect(summary!.p95).toBeLessThanOrEqual(96);
      expect(summary!.p99).toBeGreaterThanOrEqual(98);
    });

    it("should compute mean correctly", () => {
      collector.histogram("score", 10);
      collector.histogram("score", 20);
      collector.histogram("score", 30);

      const summary = collector.getSummary("score");
      expect(summary!.mean).toBeCloseTo(20, 1);
    });
  });

  describe("timer", () => {
    it("should record timer metrics", () => {
      // timer() wraps a sync function and records its duration
      collector.timer("op_duration", () => "result1");
      collector.timer("op_duration", () => "result2");

      const summary = collector.getSummary("op_duration");
      expect(summary).toBeDefined();
      expect(summary!.type).toBe("timer");
      expect(summary!.count).toBe(2);
    });
  });

  describe("query", () => {
    it("should filter metrics by name", () => {
      collector.counter("http.requests", 1);
      collector.counter("db.queries", 1);
      collector.gauge("memory.used", 512);

      const results = collector.query({ name: "http.requests" });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((m) => m.name === "http.requests")).toBe(true);
    });

    it("should filter metrics by type", () => {
      collector.counter("a", 1);
      collector.gauge("b", 2);
      collector.histogram("c", 3);

      const counters = collector.query({ type: "counter" });
      expect(counters.every((m) => m.type === "counter")).toBe(true);
    });

    it("should filter by time range", () => {
      const before = Date.now();
      collector.counter("events", 1);
      const after = Date.now();

      const inRange = collector.query({ startTime: before, endTime: after + 1 });
      expect(inRange.length).toBeGreaterThan(0);

      const outOfRange = collector.query({ startTime: after + 1000 });
      expect(outOfRange.length).toBe(0);
    });
  });

  describe("getTimeSeries", () => {
    it("should return time series for a metric", () => {
      // Use a small bucketSize so each record lands in its own bucket
      collector.counter("events", 1);
      collector.counter("events", 2);
      collector.counter("events", 3);

      // bucketSize=1 means each ms is its own bucket; use 1ms buckets
      const series = collector.getTimeSeries("events", {}, 1);
      expect(series.length).toBeGreaterThanOrEqual(1);
      // All values should be present in the series
      const total = series.reduce((sum, p) => sum + p.value, 0);
      expect(total).toBeCloseTo(2, 0); // average of 1,2,3 = 2 if all in one bucket
    });
  });

  describe("getAllSummaries", () => {
    it("should return summaries for all recorded metrics", () => {
      collector.counter("a", 1);
      collector.gauge("b", 2);
      collector.histogram("c", 3);

      const summaries = collector.getAllSummaries();
      const names = summaries.map((s) => s.name);
      expect(names).toContain("a");
      expect(names).toContain("b");
      expect(names).toContain("c");
    });
  });

  describe("reset", () => {
    it("should clear all metrics", () => {
      collector.counter("x", 1);
      collector.clear();

      const summary = collector.getSummary("x");
      expect(summary).toBeNull();
    });
  });
});
