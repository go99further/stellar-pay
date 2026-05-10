import { describe, it, expect, vi } from "vitest";
import { ObjectPool } from "../lib/agent/object-pool";

let counter = 0;
function makePool(opts: Partial<Parameters<typeof ObjectPool>[0]> = {}) {
  return new ObjectPool<{ id: number }>({
    factory: () => ({ id: ++counter }),
    ...opts,
  });
}

describe("ObjectPool", () => {
  describe("acquire / release", () => {
    it("should create object on first acquire", async () => {
      const pool = makePool();
      const obj = await pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.stats.active).toBe(1);
    });

    it("should reuse released object", async () => {
      const pool = makePool({ maxSize: 1 });
      const obj1 = await pool.acquire();
      await pool.release(obj1);
      const obj2 = await pool.acquire();
      expect(obj2).toBe(obj1);
      expect(pool.stats.created).toBe(1);
    });

    it("should track active count", async () => {
      const pool = makePool({ maxSize: 3 });
      const a = await pool.acquire();
      const b = await pool.acquire();
      expect(pool.stats.active).toBe(2);
      await pool.release(a);
      expect(pool.stats.active).toBe(1);
      await pool.release(b);
    });

    it("should track idle count after release", async () => {
      const pool = makePool();
      const obj = await pool.acquire();
      await pool.release(obj);
      expect(pool.stats.idle).toBe(1);
    });

    it("should ignore release of unknown object", async () => {
      const pool = makePool();
      await pool.release({ id: 999 }); // not from pool
      expect(pool.stats.released).toBe(0);
    });
  });

  describe("maxSize", () => {
    it("should queue when at maxSize", async () => {
      const pool = makePool({ maxSize: 1, acquireTimeoutMs: 200 });
      const obj = await pool.acquire();
      let resolved = false;
      const p = pool.acquire().then((o) => { resolved = true; return o; });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await pool.release(obj);
      await p;
      expect(resolved).toBe(true);
    });

    it("should timeout when pool exhausted", async () => {
      const pool = makePool({ maxSize: 1, acquireTimeoutMs: 20 });
      await pool.acquire(); // exhaust
      await expect(pool.acquire()).rejects.toThrow("timed out");
    });
  });

  describe("initialize (minSize)", () => {
    it("should pre-create minSize objects", async () => {
      const pool = makePool({ minSize: 3, maxSize: 5 });
      await pool.initialize();
      expect(pool.stats.idle).toBe(3);
      expect(pool.stats.created).toBe(3);
    });
  });

  describe("validate", () => {
    it("should discard invalid objects and create new ones", async () => {
      let callCount = 0;
      const pool = new ObjectPool<{ id: number; valid: boolean }>({
        factory: () => ({ id: ++callCount, valid: callCount > 1 }),
        validate: (obj) => obj.valid,
        maxSize: 5,
      });
      const obj1 = await pool.acquire();
      await pool.release(obj1); // obj1.valid = false
      const obj2 = await pool.acquire(); // should discard obj1, create new
      expect(obj2.valid).toBe(true);
    });
  });

  describe("withResource", () => {
    it("should acquire, run fn, and release", async () => {
      const pool = makePool();
      const result = await pool.withResource((obj) => obj.id);
      expect(result).toBeGreaterThan(0);
      expect(pool.stats.idle).toBe(1);
      expect(pool.stats.active).toBe(0);
    });

    it("should release even if fn throws", async () => {
      const pool = makePool();
      await expect(pool.withResource(() => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(pool.stats.active).toBe(0);
      expect(pool.stats.idle).toBe(1);
    });
  });

  describe("drain", () => {
    it("should destroy all idle objects", async () => {
      const destroyed: number[] = [];
      const pool = new ObjectPool<{ id: number }>({
        factory: () => ({ id: ++counter }),
        destroy: (obj) => { destroyed.push(obj.id); },
        maxSize: 5,
      });
      const a = await pool.acquire();
      const b = await pool.acquire();
      await pool.release(a);
      await pool.release(b);
      await pool.drain();
      expect(destroyed).toHaveLength(2);
      expect(pool.stats.idle).toBe(0);
    });
  });

  describe("stats", () => {
    it("should track created/acquired/released counts", async () => {
      const pool = makePool({ maxSize: 5 });
      const a = await pool.acquire();
      const b = await pool.acquire();
      await pool.release(a);
      await pool.release(b);
      expect(pool.stats.created).toBe(2);
      expect(pool.stats.acquired).toBe(2);
      expect(pool.stats.released).toBe(2);
    });
  });

  describe("size", () => {
    it("should report total pool size", async () => {
      const pool = makePool({ maxSize: 5 });
      const a = await pool.acquire();
      const b = await pool.acquire();
      await pool.release(a);
      expect(pool.size).toBe(2); // 1 idle + 1 active
      await pool.release(b);
    });
  });
});
