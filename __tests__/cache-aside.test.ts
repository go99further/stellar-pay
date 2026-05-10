import { describe, it, expect, beforeEach, vi } from "vitest";
import { CacheAside } from "../lib/agent/cache-aside";

describe("CacheAside", () => {
  describe("read-through (get)", () => {
    it("should load from source on miss", async () => {
      const loader = vi.fn().mockResolvedValue("data");
      const cache = new CacheAside({ loader });
      const result = await cache.get("key1");
      expect(result).toBe("data");
      expect(loader).toHaveBeenCalledWith("key1");
    });

    it("should return cached value on hit", async () => {
      const loader = vi.fn().mockResolvedValue("data");
      const cache = new CacheAside({ loader });
      await cache.get("key1");
      await cache.get("key1");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("should call loader again after invalidation", async () => {
      const loader = vi.fn().mockResolvedValue("data");
      const cache = new CacheAside({ loader });
      await cache.get("key1");
      cache.invalidate("key1");
      await cache.get("key1");
      expect(loader).toHaveBeenCalledTimes(2);
    });

    it("should propagate loader errors", async () => {
      const loader = vi.fn().mockRejectedValue(new Error("source down"));
      const cache = new CacheAside({ loader });
      await expect(cache.get("key1")).rejects.toThrow("source down");
    });
  });

  describe("single-flight (stampede protection)", () => {
    it("should deduplicate concurrent loads for same key", async () => {
      let resolveLoad!: (v: string) => void;
      const loader = vi.fn().mockReturnValue(new Promise<string>((r) => { resolveLoad = r; }));
      const cache = new CacheAside({ loader });

      const p1 = cache.get("key1");
      const p2 = cache.get("key1");
      resolveLoad("value");
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(loader).toHaveBeenCalledTimes(1);
      expect(r1).toBe("value");
      expect(r2).toBe("value");
    });
  });

  describe("set / has", () => {
    it("should manually set a value", async () => {
      const loader = vi.fn();
      const cache = new CacheAside({ loader });
      cache.set("key1", "manual");
      expect(cache.has("key1")).toBe(true);
      const result = await cache.get("key1");
      expect(result).toBe("manual");
      expect(loader).not.toHaveBeenCalled();
    });

    it("has() should return false for missing key", () => {
      const cache = new CacheAside({ loader: vi.fn() });
      expect(cache.has("missing")).toBe(false);
    });
  });

  describe("write-through", () => {
    it("should write to cache and call writer", async () => {
      const writer = vi.fn().mockResolvedValue(undefined);
      const cache = new CacheAside({ loader: vi.fn(), writer });
      await cache.write("key1", "value");
      expect(writer).toHaveBeenCalledWith("key1", "value");
      expect(cache.has("key1")).toBe(true);
    });

    it("should not call writer when using set()", async () => {
      const writer = vi.fn();
      const cache = new CacheAside({ loader: vi.fn(), writer });
      cache.set("key1", "value");
      expect(writer).not.toHaveBeenCalled();
    });
  });

  describe("TTL", () => {
    it("should expire entries after TTL", async () => {
      const loader = vi.fn().mockResolvedValue("fresh");
      const cache = new CacheAside({ loader, ttlMs: 10 });
      cache.set("key1", "old");
      await new Promise((r) => setTimeout(r, 20));
      const result = await cache.get("key1");
      expect(result).toBe("fresh");
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("should not expire before TTL", async () => {
      const loader = vi.fn().mockResolvedValue("fresh");
      const cache = new CacheAside({ loader, ttlMs: 500 });
      cache.set("key1", "cached");
      const result = await cache.get("key1");
      expect(result).toBe("cached");
      expect(loader).not.toHaveBeenCalled();
    });

    it("should support per-entry TTL override", async () => {
      const loader = vi.fn().mockResolvedValue("fresh");
      const cache = new CacheAside({ loader, ttlMs: 500 });
      cache.set("key1", "short-lived", { ttlMs: 10 });
      await new Promise((r) => setTimeout(r, 20));
      await cache.get("key1");
      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe("tag-based invalidation", () => {
    it("should invalidate all entries with a tag", async () => {
      const loader = vi.fn().mockResolvedValue("reloaded");
      const cache = new CacheAside({ loader });
      cache.set("user:1", "Alice", { tags: ["user"] });
      cache.set("user:2", "Bob", { tags: ["user"] });
      cache.set("order:1", "Order", { tags: ["order"] });

      const count = cache.invalidateByTag("user");
      expect(count).toBe(2);
      expect(cache.has("user:1")).toBe(false);
      expect(cache.has("user:2")).toBe(false);
      expect(cache.has("order:1")).toBe(true);
    });

    it("should return 0 for unknown tag", () => {
      const cache = new CacheAside({ loader: vi.fn() });
      expect(cache.invalidateByTag("nonexistent")).toBe(0);
    });
  });

  describe("maxSize eviction", () => {
    it("should evict oldest entry when maxSize is reached", async () => {
      const loader = vi.fn().mockResolvedValue("loaded");
      const cache = new CacheAside({ loader, maxSize: 2 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3"); // should evict "a"
      expect(cache.size).toBe(2);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
    });
  });

  describe("stats", () => {
    it("should track hits and misses", async () => {
      const loader = vi.fn().mockResolvedValue("v");
      const cache = new CacheAside({ loader });
      await cache.get("k1"); // miss
      await cache.get("k1"); // hit
      await cache.get("k1"); // hit
      expect(cache.stats.hits).toBe(2);
      expect(cache.stats.misses).toBe(1);
    });

    it("should compute hit rate", async () => {
      const loader = vi.fn().mockResolvedValue("v");
      const cache = new CacheAside({ loader });
      await cache.get("k1"); // miss
      await cache.get("k1"); // hit
      expect(cache.stats.hitRate).toBeCloseTo(0.5);
    });

    it("should return 0 hitRate when no requests", () => {
      const cache = new CacheAside({ loader: vi.fn() });
      expect(cache.stats.hitRate).toBe(0);
    });
  });

  describe("invalidate", () => {
    it("should return true when key existed", () => {
      const cache = new CacheAside({ loader: vi.fn() });
      cache.set("k", "v");
      expect(cache.invalidate("k")).toBe(true);
    });

    it("should return false when key did not exist", () => {
      const cache = new CacheAside({ loader: vi.fn() });
      expect(cache.invalidate("missing")).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      const loader = vi.fn().mockResolvedValue("v");
      const cache = new CacheAside({ loader });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});
