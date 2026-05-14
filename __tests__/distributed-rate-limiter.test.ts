import { describe, it, expect } from "vitest";
import { DistributedRateLimiter, kvFromEnv, type KvClient } from "../lib/agent/distributed-rate-limiter";
import { MultiTierRateLimiter } from "../lib/agent/token-bucket";

function makeMockKv(): KvClient & {
  storage: Map<string, string>;
  ttls: Map<string, number>;
  getCalls: number;
  setCalls: number;
  incrCalls: number;
  ttlCalls: number;
} {
  const storage = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    storage,
    ttls,
    getCalls: 0,
    setCalls: 0,
    incrCalls: 0,
    ttlCalls: 0,
    async get(key) {
      this.getCalls++;
      return storage.get(key) ?? null;
    },
    async set(key, value, opts) {
      this.setCalls++;
      storage.set(key, value);
      if (opts?.ex !== undefined) ttls.set(key, opts.ex);
      return "OK";
    },
    async incr(key) {
      this.incrCalls++;
      const cur = parseInt(storage.get(key) ?? "0", 10);
      const next = cur + 1;
      storage.set(key, String(next));
      return next;
    },
    async ttl(key) {
      this.ttlCalls++;
      return ttls.get(key) ?? -1;
    },
  };
}

describe("DistributedRateLimiter", () => {
  describe("with KV backend", () => {
    it("isDistributed reports true", () => {
      const kv = makeMockKv();
      const rl = new DistributedRateLimiter({ perSecond: 5, perMinute: 100, kv });
      expect(rl.isDistributed()).toBe(true);
    });

    it("first request initializes both per-second and per-minute keys", async () => {
      const kv = makeMockKv();
      const rl = new DistributedRateLimiter({ perSecond: 5, perMinute: 100, kv });
      const result = await rl.consume("1.2.3.4");
      expect(result.allowed).toBe(true);
      expect(kv.storage.get("rl:s:1.2.3.4")).toBe("1");
      expect(kv.storage.get("rl:m:1.2.3.4")).toBe("1");
    });

    it("second request increments existing counters", async () => {
      const kv = makeMockKv();
      const rl = new DistributedRateLimiter({ perSecond: 5, perMinute: 100, kv });
      await rl.consume("1.2.3.4");
      await rl.consume("1.2.3.4");
      expect(kv.storage.get("rl:s:1.2.3.4")).toBe("2");
    });

    it("blocks at the per-second cap", async () => {
      const kv = makeMockKv();
      const rl = new DistributedRateLimiter({ perSecond: 2, perMinute: 100, kv });
      await rl.consume("1.2.3.4");
      await rl.consume("1.2.3.4");
      const blocked = await rl.consume("1.2.3.4"); // 3rd within 1s window
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    it("different IPs have separate keys", async () => {
      const kv = makeMockKv();
      const rl = new DistributedRateLimiter({ perSecond: 1, perMinute: 100, kv });
      const a = await rl.consume("1.1.1.1");
      const b = await rl.consume("2.2.2.2");
      expect(a.allowed).toBe(true);
      expect(b.allowed).toBe(true);
    });

    it("falls back to in-memory when KV throws mid-flight", async () => {
      const fallback = new MultiTierRateLimiter(100, 1000);
      const failingKv: KvClient = {
        async get() { throw new Error("KV down"); },
        async set() { throw new Error("KV down"); },
        async incr() { throw new Error("KV down"); },
        async ttl() { throw new Error("KV down"); },
      };
      const rl = new DistributedRateLimiter({ perSecond: 5, perMinute: 100, kv: failingKv, fallback });
      const result = await rl.consume("1.1.1.1");
      // Doesn't throw — degrades to fallback
      expect(result.allowed).toBe(true);
    });
  });

  describe("without KV backend (in-memory fallback)", () => {
    it("isDistributed reports false", () => {
      const rl = new DistributedRateLimiter({ perSecond: 5, perMinute: 100 });
      expect(rl.isDistributed()).toBe(false);
    });

    it("delegates consume to in-memory MultiTierRateLimiter", async () => {
      const rl = new DistributedRateLimiter({ perSecond: 1, perMinute: 100 });
      const a = await rl.consume("1.1.1.1");
      const b = await rl.consume("1.1.1.1");
      expect(a.allowed).toBe(true);
      expect(b.allowed).toBe(false);
    });
  });

  describe("kvFromEnv", () => {
    it("returns null when env vars are not set", () => {
      const oldUrl = process.env.KV_REST_API_URL;
      const oldToken = process.env.KV_REST_API_TOKEN;
      const oldUUrl = process.env.UPSTASH_REDIS_REST_URL;
      const oldUToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      try {
        expect(kvFromEnv()).toBeNull();
      } finally {
        if (oldUrl) process.env.KV_REST_API_URL = oldUrl;
        if (oldToken) process.env.KV_REST_API_TOKEN = oldToken;
        if (oldUUrl) process.env.UPSTASH_REDIS_REST_URL = oldUUrl;
        if (oldUToken) process.env.UPSTASH_REDIS_REST_TOKEN = oldUToken;
      }
    });

    it("returns a client when env vars are set (no actual fetch)", () => {
      const oldUrl = process.env.KV_REST_API_URL;
      const oldToken = process.env.KV_REST_API_TOKEN;
      process.env.KV_REST_API_URL = "https://example.upstash.io";
      process.env.KV_REST_API_TOKEN = "fake-token";
      try {
        const kv = kvFromEnv();
        expect(kv).not.toBeNull();
        expect(typeof kv!.get).toBe("function");
      } finally {
        if (oldUrl !== undefined) process.env.KV_REST_API_URL = oldUrl;
        else delete process.env.KV_REST_API_URL;
        if (oldToken !== undefined) process.env.KV_REST_API_TOKEN = oldToken;
        else delete process.env.KV_REST_API_TOKEN;
      }
    });
  });
});
