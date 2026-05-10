import { describe, it, expect, beforeEach } from "vitest";
import { TimeSeries, TimeSeriesRegistry } from "../lib/agent/time-series";

const T = 1700000000000; // fixed base timestamp

describe("TimeSeries", () => {
  let ts: TimeSeries;

  beforeEach(() => {
    ts = new TimeSeries();
  });

  describe("write / query", () => {
    it("should store and retrieve a data point", () => {
      ts.write(42, T);
      const points = ts.query();
      expect(points).toHaveLength(1);
      expect(points[0].value).toBe(42);
      expect(points[0].timestamp).toBe(T);
    });

    it("should store multiple points", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      ts.write(3, T + 2000);
      expect(ts.query()).toHaveLength(3);
    });

    it("should query by from timestamp", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      ts.write(3, T + 2000);
      const result = ts.query({ from: T + 1000 });
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(2);
    });

    it("should query by to timestamp", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      ts.write(3, T + 2000);
      const result = ts.query({ to: T + 1000 });
      expect(result).toHaveLength(2);
    });

    it("should query by range", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      ts.write(3, T + 2000);
      ts.write(4, T + 3000);
      const result = ts.query({ from: T + 1000, to: T + 2000 });
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.value)).toEqual([2, 3]);
    });

    it("should filter by tags", () => {
      ts.write(1, T, { region: "us" });
      ts.write(2, T + 1000, { region: "eu" });
      ts.write(3, T + 2000, { region: "us" });
      const result = ts.query({ tags: { region: "us" } });
      expect(result).toHaveLength(2);
      expect(result.every((p) => p.tags?.region === "us")).toBe(true);
    });

    it("should apply limit", () => {
      for (let i = 0; i < 10; i++) ts.write(i, T + i * 1000);
      const result = ts.query({ limit: 3 });
      expect(result).toHaveLength(3);
      // limit returns last N
      expect(result[2].value).toBe(9);
    });

    it("should return empty array when no points match", () => {
      ts.write(1, T);
      expect(ts.query({ from: T + 99999 })).toEqual([]);
    });
  });

  describe("writeMany", () => {
    it("should write multiple points at once", () => {
      ts.writeMany([
        { timestamp: T, value: 10 },
        { timestamp: T + 1000, value: 20 },
        { timestamp: T + 2000, value: 30 },
      ]);
      expect(ts.size).toBe(3);
    });

    it("should sort points by timestamp after writeMany", () => {
      ts.writeMany([
        { timestamp: T + 2000, value: 3 },
        { timestamp: T, value: 1 },
        { timestamp: T + 1000, value: 2 },
      ]);
      const points = ts.query();
      expect(points.map((p) => p.value)).toEqual([1, 2, 3]);
    });
  });

  describe("latest", () => {
    it("should return the latest N points", () => {
      for (let i = 0; i < 5; i++) ts.write(i, T + i * 1000);
      const latest = ts.latest(2);
      expect(latest).toHaveLength(2);
      expect(latest[1].value).toBe(4);
    });

    it("should return single latest by default", () => {
      ts.write(99, T);
      expect(ts.latest()[0].value).toBe(99);
    });
  });

  describe("count", () => {
    it("should count all points", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      expect(ts.count()).toBe(2);
    });

    it("should count with filter", () => {
      ts.write(1, T, { env: "prod" });
      ts.write(2, T + 1000, { env: "dev" });
      ts.write(3, T + 2000, { env: "prod" });
      expect(ts.count({ tags: { env: "prod" } })).toBe(2);
    });
  });

  describe("stats", () => {
    it("should compute aggregate statistics", () => {
      ts.write(10, T);
      ts.write(20, T + 1000);
      ts.write(30, T + 2000);
      const s = ts.stats();
      expect(s?.avg).toBe(20);
      expect(s?.min).toBe(10);
      expect(s?.max).toBe(30);
      expect(s?.sum).toBe(60);
      expect(s?.count).toBe(3);
    });

    it("should return null for empty series", () => {
      expect(ts.stats()).toBeNull();
    });

    it("should compute stats for filtered range", () => {
      ts.write(5, T);
      ts.write(10, T + 1000);
      ts.write(15, T + 2000);
      const s = ts.stats({ from: T + 1000 });
      expect(s?.avg).toBe(12.5);
      expect(s?.count).toBe(2);
    });
  });

  describe("downsample", () => {
    it("should aggregate into time buckets", () => {
      // 3 points in first bucket, 2 in second
      ts.write(10, T);
      ts.write(20, T + 100);
      ts.write(30, T + 200);
      ts.write(40, T + 1000);
      ts.write(50, T + 1100);

      const buckets = ts.downsample({ from: T, to: T + 2000, bucketMs: 1000 });
      expect(buckets).toHaveLength(2);
      expect(buckets[0].count).toBe(3);
      expect(buckets[0].avg).toBeCloseTo(20);
      expect(buckets[0].min).toBe(10);
      expect(buckets[0].max).toBe(30);
      expect(buckets[1].count).toBe(2);
      expect(buckets[1].avg).toBe(45);
    });

    it("should return empty array when no points in range", () => {
      ts.write(1, T);
      const buckets = ts.downsample({ from: T + 99999, to: T + 199999, bucketMs: 1000 });
      expect(buckets).toHaveLength(0);
    });

    it("should filter by tags during downsample", () => {
      ts.write(10, T, { host: "a" });
      ts.write(20, T + 100, { host: "b" });
      ts.write(30, T + 200, { host: "a" });

      const buckets = ts.downsample({ from: T, to: T + 1000, bucketMs: 1000, tags: { host: "a" } });
      expect(buckets[0].count).toBe(2);
      expect(buckets[0].avg).toBe(20);
    });
  });

  describe("retention policy", () => {
    it("should evict old points based on retention", async () => {
      const ts2 = new TimeSeries({ retentionMs: 50 });
      ts2.write(1, Date.now() - 100); // old
      ts2.write(2, Date.now());       // fresh
      ts2.write(3, Date.now() + 100); // future
      // Trigger eviction by writing another point
      ts2.write(4, Date.now());
      const points = ts2.query();
      expect(points.every((p) => p.value !== 1)).toBe(true);
    });
  });

  describe("clear", () => {
    it("should remove all points", () => {
      ts.write(1, T);
      ts.write(2, T + 1000);
      ts.clear();
      expect(ts.size).toBe(0);
    });
  });

  describe("size", () => {
    it("should track number of points", () => {
      expect(ts.size).toBe(0);
      ts.write(1, T);
      ts.write(2, T + 1000);
      expect(ts.size).toBe(2);
    });
  });
});

describe("TimeSeriesRegistry", () => {
  let registry: TimeSeriesRegistry;

  beforeEach(() => {
    registry = new TimeSeriesRegistry();
  });

  it("should create series on first access", () => {
    const s = registry.getOrCreate("cpu");
    expect(s).toBeDefined();
  });

  it("should return same series on subsequent access", () => {
    const a = registry.getOrCreate("cpu");
    const b = registry.getOrCreate("cpu");
    expect(a).toBe(b);
  });

  it("should write to named series", () => {
    registry.write("cpu", 75, T);
    registry.write("memory", 50, T);
    expect(registry.get("cpu")?.size).toBe(1);
    expect(registry.get("memory")?.size).toBe(1);
  });

  it("should return undefined for non-existing series", () => {
    expect(registry.get("missing")).toBeUndefined();
  });

  it("should list all series names", () => {
    registry.getOrCreate("cpu");
    registry.getOrCreate("memory");
    registry.getOrCreate("disk");
    expect(registry.names().sort()).toEqual(["cpu", "disk", "memory"]);
  });

  it("should delete a series", () => {
    registry.getOrCreate("cpu");
    expect(registry.delete("cpu")).toBe(true);
    expect(registry.get("cpu")).toBeUndefined();
  });

  it("should return false when deleting non-existing series", () => {
    expect(registry.delete("missing")).toBe(false);
  });

  it("should report stats for all series", () => {
    registry.write("cpu", 1, T);
    registry.write("cpu", 2, T + 1000);
    registry.write("memory", 3, T);
    const stats = registry.getStats();
    expect(stats.cpu).toBe(2);
    expect(stats.memory).toBe(1);
  });
});

describe("TimeSeries — additional coverage", () => {
  const T = 1700000000000;

  it("write with tags should be queryable by tags", () => {
    const ts = new TimeSeries();
    ts.write(10, T, { host: "server1" });
    ts.write(20, T + 1000, { host: "server2" });
    const results = ts.query({ tags: { host: "server1" } });
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(10);
  });

  it("stats should compute correct avg", () => {
    const ts = new TimeSeries();
    ts.write(10, T);
    ts.write(20, T + 1000);
    ts.write(30, T + 2000);
    const s = ts.stats();
    expect(s?.avg).toBe(20);
    expect(s?.min).toBe(10);
    expect(s?.max).toBe(30);
    expect(s?.sum).toBe(60);
    expect(s?.count).toBe(3);
  });

  it("latest(n) should return n most recent points", () => {
    const ts = new TimeSeries();
    ts.write(1, T);
    ts.write(2, T + 1000);
    ts.write(3, T + 2000);
    const latest = ts.latest(2);
    expect(latest).toHaveLength(2);
    // latest() returns last n in chronological order (oldest first)
    expect(latest[0].value).toBe(2);
    expect(latest[1].value).toBe(3);
  });

  it("count with range filter", () => {
    const ts = new TimeSeries();
    ts.write(1, T);
    ts.write(2, T + 1000);
    ts.write(3, T + 2000);
    expect(ts.count({ from: T + 500, to: T + 1500 })).toBe(1);
  });
});
