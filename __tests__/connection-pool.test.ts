import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectionPool } from "../lib/agent/optimization/connection-pool";

describe("ConnectionPool", () => {
  let pool: ConnectionPool<{ id: number; alive: boolean }>;
  let connCounter = 0;

  const factory = async () => ({ id: ++connCounter, alive: true });
  const destroyer = async () => {};
  const healthCheck = async (r: { id: number; alive: boolean }) => r.alive;

  beforeEach(() => {
    connCounter = 0;
    pool = new ConnectionPool(factory, destroyer, { minSize: 1, maxSize: 3 }, healthCheck);
  });

  describe("acquire / release", () => {
    it("should acquire a connection", async () => {
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.id).toBeTruthy();
      expect(conn.resource).toBeDefined();
    });

    it("should track active connections", async () => {
      const conn = await pool.acquire();
      const stats = pool.getStats();
      expect(stats.active).toBeGreaterThanOrEqual(1);
      await pool.release(conn.id);
    });

    it("should return connection to idle after release", async () => {
      const conn = await pool.acquire();
      await pool.release(conn.id);
      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });

    it("should reuse released connections", async () => {
      const conn1 = await pool.acquire();
      const id1 = conn1.id;
      await pool.release(id1);

      const conn2 = await pool.acquire();
      expect(conn2.id).toBe(id1);
      await pool.release(conn2.id);
    });
  });

  describe("withConnection", () => {
    it("should execute function with connection and release", async () => {
      const result = await pool.withConnection(async (resource) => {
        return resource.id;
      });
      expect(result).toBeGreaterThan(0);
      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });

    it("should release connection even on error", async () => {
      await expect(
        pool.withConnection(async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
    });
  });

  describe("pool limits", () => {
    it("should not exceed maxSize", async () => {
      const conns = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ]);
      const stats = pool.getStats();
      expect(stats.total).toBeLessThanOrEqual(3);
      await Promise.all(conns.map((c) => pool.release(c.id)));
    });

    it("should timeout when pool exhausted", async () => {
      // minSize: 0 avoids async-init race; maxSize: 1 caps at one connection
      const smallPool = new ConnectionPool(factory, destroyer, {
        minSize: 0,
        maxSize: 1,
        acquireTimeout: 100,
      });

      const conn = await smallPool.acquire();
      await expect(smallPool.acquire()).rejects.toThrow(/timeout/i);
      await smallPool.release(conn.id);
      await smallPool.drain();
    });
  });

  describe("getStats", () => {
    it("should track acquired and released counts", async () => {
      const conn = await pool.acquire();
      await pool.release(conn.id);

      const stats = pool.getStats();
      expect(stats.totalAcquired).toBeGreaterThanOrEqual(1);
      expect(stats.totalReleased).toBeGreaterThanOrEqual(1);
    });
  });

  describe("drain", () => {
    it("should drain pool and reject waiting requests", async () => {
      // minSize: 0 avoids async-init race; maxSize: 1 caps at one connection
      const tinyPool = new ConnectionPool(factory, destroyer, {
        minSize: 0,
        maxSize: 1,
        acquireTimeout: 5000,
      });

      const conn = await tinyPool.acquire();
      const waitPromise = tinyPool.acquire();
      await tinyPool.drain();
      await expect(waitPromise).rejects.toThrow(/drain/i);
      await tinyPool.release(conn.id);
    });
  });
});
