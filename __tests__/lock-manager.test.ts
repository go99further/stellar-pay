import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LockManager } from "../lib/agent/recovery/lock-manager";

describe("LockManager", () => {
  let lm: LockManager;

  beforeEach(() => {
    lm = new LockManager(60000); // long cleanup interval so tests control timing
  });

  afterEach(() => {
    lm.destroy();
  });

  describe("acquire / release", () => {
    it("should acquire a free lock", async () => {
      const lock = await lm.acquire("key1", "owner1");
      expect(lock.key).toBe("key1");
      expect(lock.owner).toBe("owner1");
      expect(lock.depth).toBe(1);
    });

    it("should release a lock", async () => {
      await lm.acquire("key1", "owner1");
      expect(lm.isLocked("key1")).toBe(true);

      lm.release("key1", "owner1");
      expect(lm.isLocked("key1")).toBe(false);
    });

    it("should return false when releasing a lock not owned", async () => {
      await lm.acquire("key1", "owner1");
      expect(lm.release("key1", "owner2")).toBe(false);
      expect(lm.isLocked("key1")).toBe(true);
      lm.release("key1", "owner1");
    });

    it("should track stats", async () => {
      await lm.acquire("k", "o");
      lm.release("k", "o");

      const stats = lm.getStats();
      expect(stats.acquired).toBe(1);
      expect(stats.released).toBe(1);
    });
  });

  describe("reentrant locking", () => {
    it("should allow same owner to re-acquire", async () => {
      await lm.acquire("key", "owner", { reentrant: true });
      await lm.acquire("key", "owner", { reentrant: true });

      // Both acquires mutate the same record; check current depth via getLock
      const lock = lm.getLock("key");
      expect(lock!.depth).toBe(2);

      // Need two releases
      lm.release("key", "owner");
      expect(lm.isLocked("key")).toBe(true);
      lm.release("key", "owner");
      expect(lm.isLocked("key")).toBe(false);
    });
  });

  describe("TTL expiration", () => {
    it("should auto-expire after TTL", async () => {
      await lm.acquire("expiring", "owner", { ttl: 50 });
      expect(lm.isLocked("expiring")).toBe(true);

      await new Promise((r) => setTimeout(r, 60));
      expect(lm.isLocked("expiring")).toBe(false);
      expect(lm.getStats().expired).toBeGreaterThanOrEqual(1);
    });

    it("should allow new owner after expiry", async () => {
      await lm.acquire("expiring2", "owner1", { ttl: 50 });
      await new Promise((r) => setTimeout(r, 60));

      const lock = await lm.acquire("expiring2", "owner2", { ttl: 5000 });
      expect(lock.owner).toBe("owner2");
      lm.release("expiring2", "owner2");
    });
  });

  describe("extend", () => {
    it("should extend lock TTL", async () => {
      const lock = await lm.acquire("ext", "owner", { ttl: 100 });
      const originalExpiry = lock.expiresAt;

      const extended = lm.extend("ext", "owner", 5000);
      expect(extended).toBe(true);

      const updated = lm.getLock("ext");
      expect(updated!.expiresAt).toBeGreaterThan(originalExpiry);
      lm.release("ext", "owner");
    });

    it("should return false when extending a lock not owned", async () => {
      await lm.acquire("ext2", "owner1");
      expect(lm.extend("ext2", "owner2", 5000)).toBe(false);
      lm.release("ext2", "owner1");
    });
  });

  describe("withLock", () => {
    it("should execute function while holding lock", async () => {
      let insideLock = false;
      await lm.withLock("wl", "owner", async () => {
        insideLock = lm.isLocked("wl");
        return "result";
      });

      expect(insideLock).toBe(true);
      expect(lm.isLocked("wl")).toBe(false);
    });

    it("should release lock even if function throws", async () => {
      await expect(
        lm.withLock("wl2", "owner", async () => {
          throw new Error("fn error");
        })
      ).rejects.toThrow("fn error");

      expect(lm.isLocked("wl2")).toBe(false);
    });
  });

  describe("contention and wait queue", () => {
    it("should queue second acquire and resolve after release", async () => {
      const lock1 = await lm.acquire("contested", "owner1", { ttl: 5000, reentrant: false });

      let owner2Acquired = false;
      const p2 = lm.acquire("contested", "owner2", { waitTimeout: 500, reentrant: false })
        .then((l) => { owner2Acquired = true; return l; });

      expect(lm.getStats().contentions).toBe(1);

      // Release owner1's lock — owner2 should get it
      lm.release("contested", "owner1");
      await p2;

      expect(owner2Acquired).toBe(true);
    });

    it("should timeout if lock not released in time", async () => {
      await lm.acquire("timeout-key", "owner1", { ttl: 5000 });

      await expect(
        lm.acquire("timeout-key", "owner2", { waitTimeout: 50, reentrant: false })
      ).rejects.toThrow(/timeout/i);

      expect(lm.getStats().timeouts).toBe(1);
      lm.release("timeout-key", "owner1");
    });

    it("should throw immediately when waitTimeout is 0", async () => {
      await lm.acquire("no-wait", "owner1");

      await expect(
        lm.acquire("no-wait", "owner2", { waitTimeout: 0, reentrant: false })
      ).rejects.toThrow(/held by/i);

      lm.release("no-wait", "owner1");
    });
  });

  describe("mutual exclusion", () => {
    it("should prevent concurrent execution of critical section", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async (id: string) => {
        await lm.withLock("mutex", id, async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 20));
          concurrent--;
        }, { waitTimeout: 2000, reentrant: false });
      };

      await Promise.all([task("t1"), task("t2"), task("t3")]);
      expect(maxConcurrent).toBe(1);
    });
  });
});
