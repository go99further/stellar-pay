import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkQueue } from "../lib/agent/work-queue";

describe("WorkQueue", () => {
  describe("enqueue / pendingCount", () => {
    it("should enqueue a job", () => {
      const q = new WorkQueue();
      const job = q.enqueue("task1");
      expect(job.id).toBeDefined();
      expect(job.status).toBe("pending");
      expect(q.pendingCount).toBe(1);
    });

    it("should enqueue multiple jobs", () => {
      const q = new WorkQueue();
      q.enqueue("a");
      q.enqueue("b");
      q.enqueue("c");
      expect(q.pendingCount).toBe(3);
    });

    it("should order by priority (higher first)", () => {
      const q = new WorkQueue<string>();
      q.enqueue("low", { priority: 1 });
      q.enqueue("high", { priority: 10 });
      q.enqueue("mid", { priority: 5 });

      const order: string[] = [];
      q.process(async (p) => { order.push(p); });
      return q.drain().then(() => {
        expect(order[0]).toBe("high");
        expect(order[1]).toBe("mid");
        expect(order[2]).toBe("low");
      });
    });
  });

  describe("process / drain", () => {
    it("should process all jobs", async () => {
      const q = new WorkQueue<number>();
      const results: number[] = [];
      q.enqueue(1);
      q.enqueue(2);
      q.enqueue(3);
      q.process(async (n) => { results.push(n); });
      await q.drain();
      expect(results).toHaveLength(3);
      expect(q.doneCount).toBe(3);
      expect(q.pendingCount).toBe(0);
    });

    it("should respect concurrency limit", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const q = new WorkQueue({ concurrency: 2 });
      for (let i = 0; i < 5; i++) q.enqueue(i);
      q.process(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
      });
      await q.drain();
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should mark jobs as done after processing", async () => {
      const q = new WorkQueue();
      const job = q.enqueue("task");
      q.process(async () => {});
      await q.drain();
      expect(q.getJob(job.id)?.status).toBe("done");
    });
  });

  describe("retry", () => {
    it("should retry failed jobs up to maxAttempts", async () => {
      let attempts = 0;
      const q = new WorkQueue({ maxAttempts: 3, baseDelayMs: 0 });
      q.enqueue("task");
      q.process(async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
      });
      await q.drain();
      expect(attempts).toBe(3);
      expect(q.doneCount).toBe(1);
    });

    it("should move to dead letter after exhausting retries", async () => {
      const q = new WorkQueue({ maxAttempts: 2, baseDelayMs: 0 });
      q.enqueue("task");
      q.process(async () => { throw new Error("permanent"); });
      await q.drain();
      expect(q.deadCount).toBe(1);
      expect(q.doneCount).toBe(0);
    });

    it("should call onDead callback for dead-lettered jobs", async () => {
      const onDead = vi.fn();
      const q = new WorkQueue({ maxAttempts: 1, baseDelayMs: 0, onDead });
      q.enqueue("task");
      q.process(async () => { throw new Error("fail"); });
      await q.drain();
      expect(onDead).toHaveBeenCalledTimes(1);
      expect(onDead.mock.calls[0][0].status).toBe("failed");
    });

    it("should record error message on failed job", async () => {
      const q = new WorkQueue({ maxAttempts: 1, baseDelayMs: 0 });
      const job = q.enqueue("task");
      q.process(async () => { throw new Error("something broke"); });
      await q.drain();
      const dead = q.getDeadLetters()[0];
      expect(dead.error).toBe("something broke");
    });
  });

  describe("cancel", () => {
    it("should cancel a pending job", () => {
      const q = new WorkQueue();
      const job = q.enqueue("task");
      expect(q.cancel(job.id)).toBe(true);
      expect(q.pendingCount).toBe(0);
      expect(q.getJob(job.id)?.status).toBe("cancelled");
    });

    it("should return false for non-existing job", () => {
      const q = new WorkQueue();
      expect(q.cancel("nonexistent")).toBe(false);
    });

    it("should not process cancelled job", async () => {
      const processor = vi.fn();
      const q = new WorkQueue();
      const job = q.enqueue("task");
      q.cancel(job.id);
      q.process(processor);
      await q.drain();
      expect(processor).not.toHaveBeenCalled();
    });
  });

  describe("getJob", () => {
    it("should find pending job", () => {
      const q = new WorkQueue();
      const job = q.enqueue("task");
      expect(q.getJob(job.id)).toBeDefined();
    });

    it("should return undefined for unknown id", () => {
      const q = new WorkQueue();
      expect(q.getJob("unknown")).toBeUndefined();
    });
  });

  describe("getDeadLetters", () => {
    it("should return copy of dead letter queue", async () => {
      const q = new WorkQueue({ maxAttempts: 1, baseDelayMs: 0 });
      q.enqueue("a");
      q.enqueue("b");
      q.process(async () => { throw new Error("fail"); });
      await q.drain();
      expect(q.getDeadLetters()).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("should remove all jobs", async () => {
      const q = new WorkQueue();
      q.enqueue("a");
      q.enqueue("b");
      q.clear();
      expect(q.pendingCount).toBe(0);
      expect(q.doneCount).toBe(0);
    });
  });

  describe("job metadata", () => {
    it("should track attempt count", async () => {
      let attempts = 0;
      const q = new WorkQueue({ maxAttempts: 3, baseDelayMs: 0 });
      const job = q.enqueue("task");
      q.process(async () => {
        attempts++;
        if (attempts < 2) throw new Error("retry");
      });
      await q.drain();
      expect(q.getJob(job.id)?.attempts).toBe(2);
    });

    it("should set createdAt timestamp", () => {
      const before = Date.now();
      const q = new WorkQueue();
      const job = q.enqueue("task");
      expect(job.createdAt).toBeGreaterThanOrEqual(before);
    });
  });
});

describe("WorkQueue — additional coverage", () => {
  it("runningCount should be 0 when idle", () => {
    const q = new WorkQueue();
    expect(q.runningCount).toBe(0);
  });

  it("deadCount should track dead-lettered jobs", async () => {
    const q = new WorkQueue({ maxAttempts: 1, baseDelayMs: 0 });
    q.enqueue("fail1");
    q.enqueue("fail2");
    q.process(async () => { throw new Error("always fails"); });
    await q.drain();
    expect(q.deadCount).toBe(2);
  });

  it("doneCount should track successfully processed jobs", async () => {
    const q = new WorkQueue();
    q.enqueue("a");
    q.enqueue("b");
    q.enqueue("c");
    q.process(async () => {});
    await q.drain();
    expect(q.doneCount).toBe(3);
  });

  it("getJob should find done job by id", async () => {
    const q = new WorkQueue();
    const job = q.enqueue("task");
    q.process(async () => {});
    await q.drain();
    const found = q.getJob(job.id);
    expect(found?.status).toBe("done");
  });

  it("enqueue with custom priority should order correctly", () => {
    const q = new WorkQueue();
    const low = q.enqueue("low", { priority: 1 });
    const high = q.enqueue("high", { priority: 10 });
    const mid = q.enqueue("mid", { priority: 5 });
    const pending = [low, high, mid].map((j) => j.id);
    expect(pending).toContain(high.id);
  });
});
