import { describe, it, expect, beforeEach } from "vitest";
import { OperationQueue } from "../lib/agent/queue/operation-queue";

describe("OperationQueue", () => {
  let queue: OperationQueue;

  beforeEach(() => {
    queue = new OperationQueue({ maxConcurrent: 2 });
  });

  describe("enqueue", () => {
    it("should enqueue and execute operation", async () => {
      const opId = queue.enqueue("test", async () => "result", { priority: "normal" });
      expect(opId).toBeTruthy();
      const op = await queue.waitFor(opId);
      expect(op.status).toBe("completed");
      expect(op.result).toBe("result");
    });

    it("should respect concurrency limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const operation = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrent--;
        return "done";
      };

      const ids = [
        queue.enqueue("op", operation),
        queue.enqueue("op", operation),
        queue.enqueue("op", operation),
        queue.enqueue("op", operation),
      ];

      await Promise.all(ids.map((id) => queue.waitFor(id)));
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should execute higher priority operations first", async () => {
      const results: string[] = [];
      // Fill concurrency slots so lower-priority ops queue up
      const blocker1 = queue.enqueue("block", () => new Promise((r) => setTimeout(() => { r("b1"); }, 200)));
      const blocker2 = queue.enqueue("block", () => new Promise((r) => setTimeout(() => { r("b2"); }, 200)));

      const lowId = queue.enqueue("low", async () => { results.push("low"); return "low"; }, { priority: "low" });
      const highId = queue.enqueue("high", async () => { results.push("high"); return "high"; }, { priority: "high" });
      const critId = queue.enqueue("crit", async () => { results.push("critical"); return "critical"; }, { priority: "critical" });

      await Promise.all([blocker1, blocker2, lowId, highId, critId].map((id) => queue.waitFor(id)));

      const critIdx = results.indexOf("critical");
      const lowIdx = results.indexOf("low");
      expect(critIdx).toBeLessThan(lowIdx);
    });
  });

  describe("cancel", () => {
    it("should cancel a pending operation", async () => {
      // Fill concurrency so next op stays pending
      queue.enqueue("block", () => new Promise((r) => setTimeout(r, 500)));
      queue.enqueue("block", () => new Promise((r) => setTimeout(r, 500)));

      const opId = queue.enqueue("pending", async () => "result");
      const cancelled = queue.cancel(opId);
      expect(cancelled).toBe(true);

      const op = queue.getOperation(opId);
      expect(op?.status).toBe("cancelled");
    });
  });

  describe("waitFor", () => {
    it("should resolve with operation result", async () => {
      const opId = queue.enqueue("test", async () => {
        await new Promise((r) => setTimeout(r, 30));
        return "hello";
      });

      const op = await queue.waitFor(opId);
      expect(op.status).toBe("completed");
      expect(op.result).toBe("hello");
    });

    it("should throw on timeout", async () => {
      const opId = queue.enqueue("slow", () => new Promise((r) => setTimeout(r, 5000)));
      await expect(queue.waitFor(opId, 50)).rejects.toThrow(/timed out/);
    });
  });

  describe("getStats", () => {
    it("should track completed operations", async () => {
      const id1 = queue.enqueue("t", async () => "r1");
      const id2 = queue.enqueue("t", async () => "r2");
      await Promise.all([queue.waitFor(id1), queue.waitFor(id2)]);

      const stats = queue.getStats();
      expect(stats.completed).toBe(2);
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("OperationQueue — additional coverage", () => {
  it("getOperationsByStatus should filter by status", async () => {
    const queue = new OperationQueue({ maxConcurrent: 2 });
    const id1 = queue.enqueue("t", async () => "r1");
    const id2 = queue.enqueue("t", async () => "r2");
    await Promise.all([queue.waitFor(id1), queue.waitFor(id2)]);
    const completed = queue.getOperationsByStatus("completed");
    expect(completed.length).toBe(2);
    expect(completed.every((op) => op.status === "completed")).toBe(true);
  });

  it("getOperationsByType should filter by type", async () => {
    const queue = new OperationQueue({ maxConcurrent: 2 });
    const id1 = queue.enqueue("swap", async () => "s1");
    const id2 = queue.enqueue("price", async () => "p1");
    await Promise.all([queue.waitFor(id1), queue.waitFor(id2)]);
    const swaps = queue.getOperationsByType("swap");
    expect(swaps.every((op) => op.type === "swap")).toBe(true);
    expect(swaps.length).toBe(1);
  });

  it("clearCompleted should remove completed operations", async () => {
    const queue = new OperationQueue({ maxConcurrent: 2 });
    const id1 = queue.enqueue("t", async () => "r1");
    await queue.waitFor(id1);
    const removed = queue.clearCompleted();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(queue.getOperation(id1)).toBeNull();
  });

  it("clearAll should remove all operations", async () => {
    const queue = new OperationQueue({ maxConcurrent: 2 });
    const id1 = queue.enqueue("t", async () => "r1");
    await queue.waitFor(id1);
    queue.clearAll();
    expect(queue.getOperation(id1)).toBeNull();
    expect(queue.getStats().total).toBe(0);
  });

  it("updateConfig and getConfig should work", () => {
    const queue = new OperationQueue({ maxConcurrent: 2 });
    queue.updateConfig({ maxConcurrent: 5 });
    const config = queue.getConfig();
    expect(config.maxConcurrent).toBe(5);
  });
});
