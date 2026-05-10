import { describe, it, expect, vi } from "vitest";
import { Semaphore, Mutex, ReadWriteLock } from "../lib/agent/semaphore";

describe("Semaphore", () => {
  describe("acquire / release", () => {
    it("should acquire immediately when permits available", async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      expect(sem.available).toBe(1);
    });

    it("should block when no permits available", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      let resolved = false;
      const p = sem.acquire().then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      sem.release();
      await p;
      expect(resolved).toBe(true);
    });

    it("should release and restore permit", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      sem.release();
      expect(sem.available).toBe(1);
    });

    it("should not exceed maxPermits on release", () => {
      const sem = new Semaphore(2);
      sem.release();
      expect(sem.available).toBe(2);
    });

    it("should track waiting count", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      sem.acquire(); // queued
      sem.acquire(); // queued
      expect(sem.waiting).toBe(2);
      sem.release();
      expect(sem.waiting).toBe(1);
    });
  });

  describe("tryAcquire", () => {
    it("should return true when permit available", () => {
      const sem = new Semaphore(1);
      expect(sem.tryAcquire()).toBe(true);
      expect(sem.available).toBe(0);
    });

    it("should return false when no permit available", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      expect(sem.tryAcquire()).toBe(false);
    });
  });

  describe("withLock", () => {
    it("should execute function and release", async () => {
      const sem = new Semaphore(1);
      const result = await sem.withLock(() => 42);
      expect(result).toBe(42);
      expect(sem.available).toBe(1);
    });

    it("should release even if function throws", async () => {
      const sem = new Semaphore(1);
      await expect(sem.withLock(() => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(sem.available).toBe(1);
    });

    it("should limit concurrency", async () => {
      const sem = new Semaphore(2);
      let concurrent = 0;
      let maxConcurrent = 0;
      const tasks = Array.from({ length: 5 }, () =>
        sem.withLock(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 5));
          concurrent--;
        })
      );
      await Promise.all(tasks);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("timeout", () => {
    it("should reject after timeout when no permit available", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      await expect(sem.acquire(10)).rejects.toThrow("timed out");
    });

    it("should resolve before timeout if permit becomes available", async () => {
      const sem = new Semaphore(1);
      await sem.acquire();
      setTimeout(() => sem.release(), 5);
      await expect(sem.acquire(100)).resolves.toBeUndefined();
    });
  });
});

describe("Mutex", () => {
  it("should start unlocked", () => {
    const m = new Mutex();
    expect(m.locked).toBe(false);
  });

  it("should lock on acquire", async () => {
    const m = new Mutex();
    await m.acquire();
    expect(m.locked).toBe(true);
  });

  it("should unlock on release", async () => {
    const m = new Mutex();
    await m.acquire();
    m.release();
    expect(m.locked).toBe(false);
  });

  it("should serialize access", async () => {
    const m = new Mutex();
    const order: number[] = [];
    const t1 = m.withLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 10));
      order.push(2);
    });
    const t2 = m.withLock(async () => {
      order.push(3);
    });
    await Promise.all([t1, t2]);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("ReadWriteLock", () => {
  it("should allow multiple concurrent readers", async () => {
    const rwl = new ReadWriteLock();
    await rwl.acquireRead();
    await rwl.acquireRead();
    expect(rwl.readerCount).toBe(2);
    rwl.releaseRead();
    rwl.releaseRead();
  });

  it("should block writer when readers active", async () => {
    const rwl = new ReadWriteLock();
    await rwl.acquireRead();
    let writerStarted = false;
    const writeP = rwl.acquireWrite().then(() => { writerStarted = true; });
    await Promise.resolve();
    expect(writerStarted).toBe(false);
    rwl.releaseRead();
    await writeP;
    expect(writerStarted).toBe(true);
    rwl.releaseWrite();
  });

  it("should block readers when writer active", async () => {
    const rwl = new ReadWriteLock();
    await rwl.acquireWrite();
    let readerStarted = false;
    const readP = rwl.acquireRead().then(() => { readerStarted = true; });
    await Promise.resolve();
    expect(readerStarted).toBe(false);
    rwl.releaseWrite();
    await readP;
    expect(readerStarted).toBe(true);
    rwl.releaseRead();
  });

  it("withRead should release after fn", async () => {
    const rwl = new ReadWriteLock();
    await rwl.withRead(() => "ok");
    expect(rwl.readerCount).toBe(0);
  });

  it("withWrite should release after fn", async () => {
    const rwl = new ReadWriteLock();
    await rwl.withWrite(() => "ok");
    expect(rwl.isWriting).toBe(false);
  });

  it("should release readers after writer finishes", async () => {
    const rwl = new ReadWriteLock();
    await rwl.acquireWrite();
    const order: string[] = [];
    const r1 = rwl.acquireRead().then(() => { order.push("r1"); rwl.releaseRead(); });
    const r2 = rwl.acquireRead().then(() => { order.push("r2"); rwl.releaseRead(); });
    rwl.releaseWrite();
    await Promise.all([r1, r2]);
    expect(order).toContain("r1");
    expect(order).toContain("r2");
  });
});
