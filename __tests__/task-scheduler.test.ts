import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskScheduler } from "../lib/agent/queue/task-scheduler";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler({ maxConcurrent: 3, tickMs: 50 });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe("schedule / runNow", () => {
    it("should schedule and run a task immediately", async () => {
      const id = scheduler.schedule({
        name: "simple",
        handler: async () => "result",
        priority: "normal" as const,
      });

      const record = await scheduler.runNow(id);
      expect(record.status).toBe("completed");
      expect(record.result).toBe("result");
    });

    it("should assign a unique id when none provided", () => {
      const id1 = scheduler.schedule({ name: "t1", handler: async () => {} });
      const id2 = scheduler.schedule({ name: "t2", handler: async () => {} });
      expect(id1).not.toBe(id2);
    });

    it("should use provided id", () => {
      const id = scheduler.schedule({ id: "my-task", name: "t", handler: async () => {} });
      expect(id).toBe("my-task");
      expect(scheduler.getTask("my-task")).toBeDefined();
    });
  });

  describe("delay", () => {
    it("should not run before delay expires", async () => {
      scheduler.start();
      const id = scheduler.delay("delayed", async () => "late", 500);

      await new Promise((r) => setTimeout(r, 100));
      const record = scheduler.getTask(id)!;
      expect(record.status).toBe("pending");
    });

    it("should run after delay expires", async () => {
      scheduler.start();
      const id = scheduler.delay("soon", async () => "done", 60);

      const record = await scheduler.waitFor(id, 500);
      expect(record.status).toBe("completed");
      expect(record.result).toBe("done");
    });
  });

  describe("cancel", () => {
    it("should cancel a pending task", () => {
      const id = scheduler.schedule({
        name: "cancel-me",
        handler: async () => "x",
        runAt: Date.now() + 60000,
      });

      expect(scheduler.cancel(id)).toBe(true);
      expect(scheduler.getTask(id)!.status).toBe("cancelled");
    });

    it("should return false for non-pending task", async () => {
      const id = scheduler.schedule({ name: "t", handler: async () => {} });
      await scheduler.runNow(id);
      expect(scheduler.cancel(id)).toBe(false);
    });
  });

  describe("retry on failure", () => {
    it("should retry failed tasks up to maxRetries", async () => {
      let attempts = 0;
      const id = scheduler.schedule({
        name: "flaky",
        handler: async () => {
          attempts++;
          if (attempts < 3) throw new Error("not yet");
          return "ok";
        },
        maxRetries: 3,
        retryDelay: 10,
      });

      scheduler.start();
      const record = await scheduler.waitFor(id, 2000);
      expect(record.status).toBe("completed");
      expect(attempts).toBe(3);
    });

    it("should mark as failed after exhausting retries", async () => {
      const id = scheduler.schedule({
        name: "always-fails",
        handler: async () => { throw new Error("permanent failure"); },
        maxRetries: 2,
        retryDelay: 10,
      });

      scheduler.start();
      const record = await scheduler.waitFor(id, 2000);
      expect(record.status).toBe("failed");
      expect(record.error).toMatch(/permanent failure/);
    });
  });

  describe("task dependencies", () => {
    it("should run dependent task only after dependency completes", async () => {
      const order: string[] = [];

      const depId = scheduler.schedule({
        name: "dep",
        handler: async () => { order.push("dep"); },
        priority: "normal" as const,
      });

      const mainId = scheduler.schedule({
        name: "main",
        handler: async () => { order.push("main"); },
        dependencies: [depId],
        priority: "normal" as const,
      });

      scheduler.start();
      await scheduler.waitFor(mainId, 2000);

      expect(order.indexOf("dep")).toBeLessThan(order.indexOf("main"));
    });
  });

  describe("priority ordering", () => {
    it("should run critical tasks before low priority", async () => {
      const order: string[] = [];

      // Fill concurrency so tasks queue up
      const blockers = Array.from({ length: 3 }, (_, i) =>
        scheduler.schedule({
          name: `blocker${i}`,
          handler: () => new Promise((r) => setTimeout(r, 200)),
          priority: "normal" as const,
        })
      );

      const lowId = scheduler.schedule({
        name: "low",
        handler: async () => { order.push("low"); },
        priority: "low" as const,
      });

      const critId = scheduler.schedule({
        name: "crit",
        handler: async () => { order.push("critical"); },
        priority: "critical" as const,
      });

      scheduler.start();
      await Promise.all([...blockers, lowId, critId].map((id) => scheduler.waitFor(id, 3000)));

      expect(order.indexOf("critical")).toBeLessThan(order.indexOf("low"));
    });
  });

  describe("getStats", () => {
    it("should track task counts by status", async () => {
      const id1 = scheduler.schedule({ name: "t1", handler: async () => {} });
      const id2 = scheduler.schedule({ name: "t2", handler: async () => { throw new Error("x"); }, maxRetries: 0, retryDelay: 0 });

      await scheduler.runNow(id1);
      await scheduler.runNow(id2);

      const stats = scheduler.getStats();
      expect(stats.completed).toBeGreaterThanOrEqual(1);
      expect(stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getByTag", () => {
    it("should filter tasks by tag", () => {
      scheduler.schedule({ name: "t1", handler: async () => {}, tags: ["swap"] });
      scheduler.schedule({ name: "t2", handler: async () => {}, tags: ["swap", "urgent"] });
      scheduler.schedule({ name: "t3", handler: async () => {}, tags: ["price"] });

      const swapTasks = scheduler.getByTag("swap");
      expect(swapTasks.length).toBe(2);
      expect(swapTasks.every((t) => t.definition.tags.includes("swap"))).toBe(true);
    });
  });

  describe("timeout", () => {
    it("should fail task that exceeds timeout", async () => {
      const id = scheduler.schedule({
        name: "slow",
        handler: () => new Promise((r) => setTimeout(r, 5000)),
        timeout: 50,
        maxRetries: 0,
      });

      scheduler.start();
      const record = await scheduler.waitFor(id, 2000);
      expect(record.status).toBe("failed");
      expect(record.error).toMatch(/timeout/i);
    });
  });
});
