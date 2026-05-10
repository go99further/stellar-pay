import { describe, it, expect, beforeEach, vi } from "vitest";
import { CacheManager, CacheRegistry } from "../lib/agent/optimization/cache-manager";

describe("CacheManager", () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager<string>({ namespace: "test", defaultTtl: 0 });
  });

  describe("get / set", () => {
    it("should store and retrieve a value", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("should return null for missing key", () => {
      expect(cache.get("missing")).toBeNull();
    });

    it("should track hit/miss stats", () => {
      cache.set("k", "v");
      cache.get("k");       // hit
      cache.get("missing"); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      cache.set("expiring", "value", 50); // 50ms TTL
      expect(cache.get("expiring")).toBe("value");

      await new Promise((r) => setTimeout(r, 60));
      expect(cache.get("expiring")).toBeNull();
    });

    it("should not expire entries with no TTL", async () => {
      cache.set("permanent", "value", 0);
      await new Promise((r) => setTimeout(r, 20));
      expect(cache.get("permanent")).toBe("value");
    });

    it("should count expirations in stats", async () => {
      cache.set("exp", "v", 30);
      await new Promise((r) => setTimeout(r, 40));
      cache.get("exp"); // triggers expiration detection

      expect(cache.getStats().expirations).toBe(1);
    });
  });

  describe("has / delete", () => {
    it("should return true for existing key", () => {
      cache.set("k", "v");
      expect(cache.has("k")).toBe(true);
    });

    it("should return false after delete", () => {
      cache.set("k", "v");
      cache.delete("k");
      expect(cache.has("k")).toBe(false);
    });
  });

  describe("getOrLoad", () => {
    it("should load and cache on miss", async () => {
      let loadCount = 0;
      const loader = async (key: string) => {
        loadCount++;
        return `loaded_${key}`;
      };

      const v1 = await cache.getOrLoad("k", loader);
      const v2 = await cache.getOrLoad("k", loader);

      expect(v1).toBe("loaded_k");
      expect(v2).toBe("loaded_k");
      expect(loadCount).toBe(1); // only loaded once
    });
  });

  describe("LRU eviction", () => {
    it("should evict least recently used when at capacity", async () => {
      const small = new CacheManager<number>({ maxSize: 3, namespace: "lru", evictionPolicy: "lru" });

      small.set("a", 1);
      await new Promise((r) => setTimeout(r, 5));
      small.set("b", 2);
      await new Promise((r) => setTimeout(r, 5));
      small.set("c", 3);
      await new Promise((r) => setTimeout(r, 5));

      // Access 'b' and 'c' to make 'a' the LRU
      small.get("b");
      await new Promise((r) => setTimeout(r, 5));
      small.get("c");
      await new Promise((r) => setTimeout(r, 5));

      // Adding 'd' should evict 'a' (least recently used)
      small.set("d", 4);

      expect(small.get("b")).toBe(2);
      expect(small.get("c")).toBe(3);
      expect(small.get("d")).toBe(4);
      expect(small.get("a")).toBeNull(); // evicted
      expect(small.getStats().evictions).toBe(1);
    });
  });

  describe("invalidatePrefix", () => {
    it("should remove all keys with matching prefix", () => {
      cache.set("user:1", "alice");
      cache.set("user:2", "bob");
      cache.set("product:1", "widget");

      const removed = cache.invalidatePrefix("user:");
      expect(removed).toBe(2);
      expect(cache.get("user:1")).toBeNull();
      expect(cache.get("user:2")).toBeNull();
      expect(cache.get("product:1")).toBe("widget");
    });
  });

  describe("purgeExpired", () => {
    it("should remove expired entries", async () => {
      cache.set("exp1", "v1", 30);
      cache.set("exp2", "v2", 30);
      cache.set("perm", "v3", 0);

      await new Promise((r) => setTimeout(r, 40));
      const removed = cache.purgeExpired();

      expect(removed).toBe(2);
      expect(cache.get("perm")).toBe("v3");
    });
  });

  describe("clear", () => {
    it("should remove all entries", () => {
      cache.set("a", "1");
      cache.set("b", "2");
      cache.clear();
      expect(cache.getStats().size).toBe(0);
    });
  });
});

describe("CacheRegistry", () => {
  it("should create and reuse namespaced caches", () => {
    const registry = new CacheRegistry();
    const c1 = registry.getOrCreate<string>("ns1");
    const c2 = registry.getOrCreate<string>("ns1");
    expect(c1).toBe(c2);
  });

  it("should aggregate stats across namespaces", () => {
    const registry = new CacheRegistry();
    const c1 = registry.getOrCreate<number>("a");
    const c2 = registry.getOrCreate<number>("b");
    c1.set("x", 1);
    c2.set("y", 2);
    c1.get("x");
    c2.get("missing");

    const stats = registry.getAggregateStats();
    expect(stats["a"].hits).toBe(1);
    expect(stats["b"].misses).toBe(1);
  });

  it("should clearAll across all namespaces", () => {
    const registry = new CacheRegistry();
    const c1 = registry.getOrCreate<string>("x");
    c1.set("k", "v");
    registry.clearAll();
    expect(c1.get("k")).toBeNull();
  });
});
