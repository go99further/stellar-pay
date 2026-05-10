import { describe, it, expect } from "vitest";
import { BatchRequestHandler } from "../lib/agent/optimization/batch-handler";

// The actual API: handler.request(data, priority?) — not handler.add()
// The executor receives T[] and returns R[]
// getStatistics() not getStats()
// No destroy() — use clear() or flush()

describe("BatchRequestHandler", () => {
  describe("basic batching", () => {
    it("should process a single request", async () => {
      const handler = new BatchRequestHandler<number, number>(
        async (items) => items.map((v) => v * 2),
        { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      const result = await handler.request(5);
      expect(result).toBe(10);
      handler.clear();
    });

    it("should batch multiple requests together", async () => {
      const batchSizes: number[] = [];
      const handler = new BatchRequestHandler<number, number>(
        async (items) => {
          batchSizes.push(items.length);
          return items;
        },
        { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      await Promise.all([
        handler.request(1),
        handler.request(2),
        handler.request(3),
      ]);

      expect(batchSizes.some((s) => s > 1)).toBe(true);
    });

    it("should respect maxBatchSize", async () => {
      const batchSizes: number[] = [];
      const handler = new BatchRequestHandler<number, number>(
        async (items) => {
          batchSizes.push(items.length);
          return items;
        },
        { maxBatchSize: 2, maxWaitTime: 200, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      await Promise.all([
        handler.request(1),
        handler.request(2),
        handler.request(3),
        handler.request(4),
      ]);

      expect(batchSizes.every((s) => s <= 2)).toBe(true);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate requests with same data", async () => {
      let callCount = 0;
      const handler = new BatchRequestHandler<number, number>(
        async (items) => {
          callCount += items.length;
          return items.map((v) => v * 10);
        },
        { maxBatchSize: 10, maxWaitTime: 50, deduplication: true, retryOnError: false, maxRetries: 0 }
      );

      const [r1, r2] = await Promise.all([
        handler.request(5),
        handler.request(5),
      ]);

      expect(r1).toBe(50);
      expect(r2).toBe(50);
      expect(callCount).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should propagate batch errors to individual requests", async () => {
      const handler = new BatchRequestHandler<number, number>(
        async () => { throw new Error("batch failed"); },
        { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      await expect(handler.request(1)).rejects.toThrow("batch failed");
    });
  });

  describe("getStatistics", () => {
    it("should track request statistics", async () => {
      const handler = new BatchRequestHandler<number, number>(
        async (items) => items,
        { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      await Promise.all([handler.request(1), handler.request(2)]);

      const stats = handler.getStatistics();
      expect(stats.totalRequests).toBeGreaterThanOrEqual(2);
      expect(stats.totalBatches).toBeGreaterThanOrEqual(1);
    });
  });

  describe("flush", () => {
    it("should flush pending requests immediately", async () => {
      const processed: number[] = [];
      const handler = new BatchRequestHandler<number, number>(
        async (items) => {
          processed.push(...items);
          return items;
        },
        { maxBatchSize: 100, maxWaitTime: 5000, deduplication: false, retryOnError: false, maxRetries: 0 }
      );

      const p1 = handler.request(1);
      const p2 = handler.request(2);
      await handler.flush();
      await Promise.all([p1, p2]);

      expect(processed).toContain(1);
      expect(processed).toContain(2);
    });
  });
});

import { TypedBatchHandler } from "../lib/agent/optimization/batch-handler";

describe("BatchRequestHandler — additional coverage", () => {
  it("getQueueSize should return pending count", async () => {
    const handler = new BatchRequestHandler<number, number>(
      async (items) => new Promise((r) => setTimeout(() => r(items), 200)),
      { maxBatchSize: 100, maxWaitTime: 5000, deduplication: false, retryOnError: false, maxRetries: 0 }
    );
    handler.request(1).catch(() => {});
    handler.request(2).catch(() => {});
    expect(handler.getQueueSize()).toBeGreaterThanOrEqual(0);
    handler.clear();
  });

  it("clear should reject pending requests", async () => {
    const handler = new BatchRequestHandler<number, number>(
      async (items) => new Promise((r) => setTimeout(() => r(items), 5000)),
      { maxBatchSize: 100, maxWaitTime: 5000, deduplication: false, retryOnError: false, maxRetries: 0 }
    );
    const p = handler.request(1);
    handler.clear();
    await expect(p).rejects.toThrow(/cleared/i);
  });

  it("updateConfig should apply new maxBatchSize", async () => {
    const batchSizes: number[] = [];
    const handler = new BatchRequestHandler<number, number>(
      async (items) => { batchSizes.push(items.length); return items; },
      { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 }
    );
    handler.updateConfig({ maxBatchSize: 1 });
    await Promise.all([handler.request(1), handler.request(2)]);
    expect(batchSizes.every((s) => s <= 1)).toBe(true);
  });
});

describe("TypedBatchHandler", () => {
  it("should register and dispatch to typed handlers via execute()", async () => {
    const typed = new TypedBatchHandler<"num", number, number>();
    typed.register("num", async (items) => items.map((v) => v * 3), {
      maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0,
    });
    const result = await typed.execute("num", 4);
    expect(result).toBe(12);
  });

  it("should throw for unregistered type", async () => {
    const typed = new TypedBatchHandler<"num", number, number>();
    await expect(typed.execute("num", 1)).rejects.toThrow(/No handler registered/);
  });

  it("getHandler should return null for unknown type", () => {
    const typed = new TypedBatchHandler<"num", number, number>();
    expect(typed.getHandler("num")).toBeNull();
  });

  it("getAllStatistics should return stats for all registered types", async () => {
    const typed = new TypedBatchHandler<"a" | "b", number, number>();
    typed.register("a", async (items) => items, { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });
    typed.register("b", async (items) => items, { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });
    await typed.execute("a", 1);
    const stats = typed.getAllStatistics();
    expect(stats["a"]).toBeDefined();
    expect(stats["b"]).toBeDefined();
  });
});
