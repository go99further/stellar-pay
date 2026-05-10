import { describe, it, expect, vi, beforeEach } from "vitest";
import { Bulkhead, BulkheadRegistry } from "../lib/agent/bulkhead";

describe("Bulkhead", () => {
  describe("basic execution", () => {
    it("should execute a function and return result", async () => {
      const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 5 });
      const result = await bh.execute(async () => "ok");
      expect(result).toBe("ok");
    });

    it("should track completed count", async () => {
      const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 5 });
      await bh.execute(async () => "a");
      await bh.execute(async () => "b");
      expect(bh.getStats().completed).toBe(2);
    });

    it("should track failed count on error", async () => {
      const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 5 });
      await expect(bh.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
      expect(bh.getStats().failed).toBe(1);
    });
  });

  describe("concurrency limiting", () => {
    it("should allow up to maxConcurrent simultaneous executions", async () => {
      const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 10 });
      let active = 0;
      let maxActive = 0;

      const task = () => bh.execute(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      });

      await Promise.all([task(), task(), task(), task()]);
      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it("should queue requests when at capacity", async () => {
      const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 5 });
      const order: number[] = [];

      const task = (n: number) => bh.execute(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(n);
      });

      await Promise.all([task(1), task(2), task(3)]);
      expect(order).toEqual([1, 2, 3]);
    });

    it("should reject when queue is full", async () => {
      const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 1 });

      // Fill the slot and queue
      const slow = () => new Promise<void>((r) => setTimeout(r, 100));
      bh.execute(slow); // occupies slot
      bh.execute(slow); // fills queue

      // This should be rejected
      await expect(bh.execute(slow)).rejects.toThrow(/rejected/i);
      expect(bh.getStats().rejected).toBe(1);
    });
  });

  describe("maxWaitMs timeout", () => {
    it("should reject queued request after maxWaitMs", async () => {
      const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 30 });

      // Occupy the slot with a slow task
      const slowDone = bh.execute(() => new Promise((r) => setTimeout(r, 200)));

      // Queue a request that will timeout
      await expect(
        bh.execute(async () => "should not run")
      ).rejects.toThrow(/timeout/i);

      // Clean up
      await slowDone.catch(() => {});
    });

    it("should succeed if slot opens before maxWaitMs", async () => {
      const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 5, maxWaitMs: 200 });

      // Occupy slot briefly
      const first = bh.execute(() => new Promise((r) => setTimeout(r, 30)));
      const second = bh.execute(async () => "queued-ok");

      await first;
      const result = await second;
      expect(result).toBe("queued-ok");
    });
  });

  describe("getStats", () => {
    it("should report active count during execution", async () => {
      const bh = new Bulkhead({ maxConcurrent: 3, maxQueue: 10 });
      let statsSnapshot: ReturnType<typeof bh.getStats> | null = null;

      const task = bh.execute(async () => {
        statsSnapshot = bh.getStats();
        await new Promise((r) => setTimeout(r, 10));
      });

      await task;
      expect(statsSnapshot?.active).toBe(1);
    });

    it("should report queued count", async () => {
      const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 5 });
      const slow = () => new Promise<void>((r) => setTimeout(r, 100));

      bh.execute(slow); // occupies slot
      bh.execute(slow); // queued
      bh.execute(slow); // queued

      const stats = bh.getStats();
      expect(stats.queued).toBe(2);
      expect(stats.active).toBe(1);
    });
  });
});

describe("BulkheadRegistry", () => {
  let registry: BulkheadRegistry;

  beforeEach(() => {
    registry = new BulkheadRegistry();
  });

  it("should register and retrieve bulkheads by name", async () => {
    registry.register("db", { maxConcurrent: 5, maxQueue: 10 });
    const result = await registry.execute("db", async () => "db-result");
    expect(result).toBe("db-result");
  });

  it("should throw for unregistered bulkhead", () => {
    expect(() => registry.get("missing")).toThrow(/not registered/i);
  });

  it("should isolate partitions", async () => {
    registry.register("db", { maxConcurrent: 1, maxQueue: 0 });
    registry.register("api", { maxConcurrent: 1, maxQueue: 0 });

    // Fill db partition
    const slow = () => new Promise<void>((r) => setTimeout(r, 100));
    registry.execute("db", slow);

    // api partition should still work
    const result = await registry.execute("api", async () => "api-ok");
    expect(result).toBe("api-ok");
  });

  it("should return stats for all partitions", async () => {
    registry.register("db", { maxConcurrent: 2, maxQueue: 5 });
    registry.register("cache", { maxConcurrent: 3, maxQueue: 5 });

    await registry.execute("db", async () => {});
    await registry.execute("cache", async () => {});

    const stats = registry.getAllStats();
    expect(stats.db.completed).toBe(1);
    expect(stats.cache.completed).toBe(1);
  });
});
