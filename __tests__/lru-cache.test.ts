import { describe, it, expect, beforeEach } from "vitest";
import { LRUCache } from "../lib/agent/lru-cache";

describe("LRUCache", () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache({ capacity: 3 });
  });

  describe("put / get", () => {
    it("should store and retrieve a value", () => {
      cache.put("a", 1);
      expect(cache.get("a")).toBe(1);
    });

    it("should return undefined for missing key", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("should update existing key", () => {
      cache.put("a", 1);
      cache.put("a", 99);
      expect(cache.get("a")).toBe(99);
    });

    it("should evict LRU entry when capacity exceeded", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      cache.put("d", 4); // evicts "a" (LRU)
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe(2);
      expect(cache.get("c")).toBe(3);
      expect(cache.get("d")).toBe(4);
    });

    it("should not evict recently accessed entry", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      cache.get("a"); // access "a" → moves to head
      cache.put("d", 4); // evicts "b" (now LRU)
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBeUndefined();
    });

    it("should track size correctly", () => {
      expect(cache.size).toBe(0);
      cache.put("a", 1);
      cache.put("b", 2);
      expect(cache.size).toBe(2);
    });
  });

  describe("has", () => {
    it("should return true for existing key", () => {
      cache.put("a", 1);
      expect(cache.has("a")).toBe(true);
    });

    it("should return false for missing key", () => {
      expect(cache.has("missing")).toBe(false);
    });
  });

  describe("delete", () => {
    it("should remove a key", () => {
      cache.put("a", 1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.get("a")).toBeUndefined();
    });

    it("should return false for missing key", () => {
      expect(cache.delete("missing")).toBe(false);
    });

    it("should decrement size", () => {
      cache.put("a", 1);
      cache.delete("a");
      expect(cache.size).toBe(0);
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("a")).toBeUndefined();
    });
  });

  describe("keys", () => {
    it("should return keys in MRU order", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      cache.get("a"); // move a to head
      const keys = cache.keys();
      expect(keys[0]).toBe("a");
    });

    it("should return all keys", () => {
      cache.put("x", 1);
      cache.put("y", 2);
      expect(cache.keys().sort()).toEqual(["x", "y"]);
    });
  });

  describe("TTL", () => {
    it("should expire entries after TTL", async () => {
      cache.put("a", 1, 30);
      await new Promise((r) => setTimeout(r, 50));
      expect(cache.get("a")).toBeUndefined();
    });

    it("should not expire before TTL", async () => {
      cache.put("a", 1, 200);
      await new Promise((r) => setTimeout(r, 30));
      expect(cache.get("a")).toBe(1);
    });

    it("should use defaultTtlMs for all entries", async () => {
      const c = new LRUCache<string, number>({ capacity: 5, defaultTtlMs: 30 });
      c.put("a", 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(c.get("a")).toBeUndefined();
    });

    it("should evict expired entries via evictExpired()", async () => {
      cache.put("a", 1, 30);
      cache.put("b", 2, 30);
      cache.put("c", 3, 5000);
      await new Promise((r) => setTimeout(r, 50));
      const evicted = cache.evictExpired();
      expect(evicted).toBe(2);
      expect(cache.size).toBe(1);
    });
  });

  describe("onEvict callback", () => {
    it("should call onEvict when entry is evicted", () => {
      const evicted: string[] = [];
      const c = new LRUCache<string, number>({
        capacity: 2,
        onEvict: (key) => evicted.push(key),
      });
      c.put("a", 1);
      c.put("b", 2);
      c.put("c", 3); // evicts "a"
      expect(evicted).toContain("a");
    });
  });

  describe("getStats", () => {
    it("should track hits and misses", () => {
      cache.put("a", 1);
      cache.get("a"); // hit
      cache.get("a"); // hit
      cache.get("b"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });

    it("should compute hit rate", () => {
      cache.put("a", 1);
      cache.get("a"); // hit
      cache.get("b"); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it("should track evictions", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      cache.put("d", 4); // evicts one

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });

    it("should report capacity", () => {
      expect(cache.getStats().capacity).toBe(3);
    });

    it("should return 0 hit rate when no accesses", () => {
      expect(cache.getStats().hitRate).toBe(0);
    });
  });

  describe("LRU ordering", () => {
    it("should maintain correct LRU order across multiple operations", () => {
      cache.put("a", 1);
      cache.put("b", 2);
      cache.put("c", 3);
      cache.get("a"); // a → head: c, b, a → a, c, b
      cache.get("b"); // b → head: b, a, c
      cache.put("d", 4); // evicts c (LRU)
      expect(cache.get("c")).toBeUndefined();
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);
      expect(cache.get("d")).toBe(4);
    });

    it("should handle capacity of 1", () => {
      const c = new LRUCache<string, number>({ capacity: 1 });
      c.put("a", 1);
      c.put("b", 2);
      expect(c.get("a")).toBeUndefined();
      expect(c.get("b")).toBe(2);
    });
  });
});
