import { describe, it, expect, beforeEach, vi } from "vitest";
import { cache, CACHE_KEYS, CACHE_TTL } from "@/lib/cache";

describe("MemoryCache", () => {
  beforeEach(() => {
    cache.clear();
  });

  it("stores and retrieves values", () => {
    cache.set("key1", "value1", 10000);
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    cache.set("temp", "data", 1000);
    expect(cache.get("temp")).toBe("data");

    vi.advanceTimersByTime(1001);
    expect(cache.get("temp")).toBeUndefined();

    vi.useRealTimers();
  });

  it("invalidates specific keys", () => {
    cache.set("a", 1, 10000);
    cache.set("b", 2, 10000);
    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });

  it("clears all entries", () => {
    cache.set("x", 1, 10000);
    cache.set("y", 2, 10000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("has() returns correct boolean", () => {
    cache.set("exists", true, 10000);
    expect(cache.has("exists")).toBe(true);
    expect(cache.has("nope")).toBe(false);
  });

  it("stores complex objects", () => {
    const data = { votes: new Map([[0, 5], [1, 3]]), total: 8 };
    cache.set("poll", data, 10000);
    const retrieved = cache.get<typeof data>("poll");
    expect(retrieved?.total).toBe(8);
  });

  it("CACHE_KEYS generates correct keys", () => {
    expect(CACHE_KEYS.BALANCE("GABC")).toBe("balance:GABC");
    expect(CACHE_KEYS.HAS_VOTED("GXYZ")).toBe("poll:voted:GXYZ");
    expect(CACHE_KEYS.POLL_QUESTION).toBe("poll:question");
  });

  it("CACHE_TTL values are reasonable", () => {
    expect(CACHE_TTL.BALANCE).toBeGreaterThan(5000);
    expect(CACHE_TTL.POLL_STATIC).toBeGreaterThan(CACHE_TTL.POLL_VOTES);
  });
});
