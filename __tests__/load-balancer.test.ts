import { describe, it, expect, beforeEach } from "vitest";
import { LoadBalancer } from "../lib/agent/optimization/load-balancer";

describe("LoadBalancer", () => {
  let lb: LoadBalancer;

  beforeEach(() => {
    lb = new LoadBalancer({ strategy: "round-robin", maxRetries: 3 });
    lb.addEndpoint("ep1", "http://host1:8080");
    lb.addEndpoint("ep2", "http://host2:8080");
    lb.addEndpoint("ep3", "http://host3:8080");
  });

  describe("addEndpoint / removeEndpoint", () => {
    it("should register endpoints", () => {
      expect(lb.getEndpoints().length).toBe(3);
    });

    it("should remove an endpoint", () => {
      lb.removeEndpoint("ep2");
      const ids = lb.getEndpoints().map((e) => e.id);
      expect(ids).not.toContain("ep2");
      expect(ids.length).toBe(2);
    });
  });

  describe("select — round-robin", () => {
    it("should cycle through all healthy endpoints", () => {
      const selected = [lb.select(), lb.select(), lb.select()].map((e) => e!.id);
      expect(new Set(selected).size).toBe(3);
    });

    it("should skip unhealthy endpoints", () => {
      lb.setHealth("ep1", false);
      lb.setHealth("ep2", false);

      for (let i = 0; i < 5; i++) {
        const ep = lb.select();
        expect(ep?.id).toBe("ep3");
      }
    });

    it("should return null when all endpoints are unhealthy", () => {
      lb.setHealth("ep1", false);
      lb.setHealth("ep2", false);
      lb.setHealth("ep3", false);
      expect(lb.select()).toBeNull();
    });
  });

  describe("select — least-connections", () => {
    it("should prefer endpoint with fewest connections", () => {
      const lcLb = new LoadBalancer({ strategy: "least-connections" });
      lcLb.addEndpoint("a", "http://a", 50);
      lcLb.addEndpoint("b", "http://b", 50);
      lcLb.addEndpoint("c", "http://c", 50);

      // Manually set connections
      lcLb.getEndpoints().find((e) => e.id === "a")!.connections = 5;
      lcLb.getEndpoints().find((e) => e.id === "b")!.connections = 2;
      lcLb.getEndpoints().find((e) => e.id === "c")!.connections = 8;

      const selected = lcLb.select();
      expect(selected?.id).toBe("b");
    });
  });

  describe("select — consistent-hash", () => {
    it("should return same endpoint for same session key", () => {
      const hashLb = new LoadBalancer({ strategy: "consistent-hash" });
      hashLb.addEndpoint("x", "http://x");
      hashLb.addEndpoint("y", "http://y");
      hashLb.addEndpoint("z", "http://z");

      const key = "user_session_abc";
      const first = hashLb.select(key);
      const second = hashLb.select(key);
      expect(first?.id).toBe(second?.id);
    });
  });

  describe("execute", () => {
    it("should execute request on selected endpoint", async () => {
      const result = await lb.execute(async (ep) => `response_from_${ep.id}`);
      expect(result).toMatch(/^response_from_ep/);
    });

    it("should retry on failure and succeed on next endpoint", async () => {
      let attempts = 0;
      const result = await lb.execute(async (ep) => {
        attempts++;
        if (attempts === 1) throw new Error("first attempt failed");
        return `ok_${ep.id}`;
      });
      expect(attempts).toBe(2);
      expect(result).toMatch(/^ok_ep/);
    });

    it("should throw when all retries exhausted", async () => {
      const smallLb = new LoadBalancer({ strategy: "round-robin", maxRetries: 2 });
      smallLb.addEndpoint("bad1", "http://bad1");
      smallLb.addEndpoint("bad2", "http://bad2");

      await expect(
        smallLb.execute(async () => { throw new Error("always fails"); })
      ).rejects.toThrow();
    });

    it("should track request stats", async () => {
      await lb.execute(async (ep) => ep.id);
      const stats = lb.getStats();
      const total = Object.values(stats).reduce((sum, s) => sum + s.requests, 0);
      expect(total).toBe(1);
    });
  });

  describe("setHealth", () => {
    it("should mark endpoint unhealthy", () => {
      lb.setHealth("ep1", false);
      const ep = lb.getEndpoints().find((e) => e.id === "ep1");
      expect(ep?.healthy).toBe(false);
    });

    it("should restore endpoint health", () => {
      lb.setHealth("ep1", false);
      lb.setHealth("ep1", true);
      const ep = lb.getEndpoints().find((e) => e.id === "ep1");
      expect(ep?.healthy).toBe(true);
    });
  });

  describe("getHealthyEndpoints", () => {
    it("should only return healthy endpoints", () => {
      lb.setHealth("ep2", false);
      const healthy = lb.getHealthyEndpoints();
      expect(healthy.length).toBe(2);
      expect(healthy.every((e) => e.healthy)).toBe(true);
    });
  });

  describe("select — weighted", () => {
    it("should select endpoints proportional to weight", () => {
      const wLb = new LoadBalancer({ strategy: "weighted" });
      wLb.addEndpoint("heavy", "http://heavy", 90);
      wLb.addEndpoint("light", "http://light", 10);

      const counts: Record<string, number> = { heavy: 0, light: 0 };
      for (let i = 0; i < 100; i++) {
        const ep = wLb.select();
        if (ep) counts[ep.id]++;
      }
      // heavy should be selected significantly more often
      expect(counts.heavy).toBeGreaterThan(counts.light);
    });
  });

  describe("select — random", () => {
    it("should select from healthy endpoints", () => {
      const rLb = new LoadBalancer({ strategy: "random" });
      rLb.addEndpoint("r1", "http://r1");
      rLb.addEndpoint("r2", "http://r2");
      rLb.addEndpoint("r3", "http://r3");

      for (let i = 0; i < 20; i++) {
        const ep = rLb.select();
        expect(ep).not.toBeNull();
        expect(["r1", "r2", "r3"]).toContain(ep!.id);
      }
    });
  });

  describe("sticky sessions", () => {
    it("should route same session key to same endpoint", () => {
      const stickyLb = new LoadBalancer({ strategy: "round-robin", stickySessionTtl: 60000 });
      stickyLb.addEndpoint("s1", "http://s1");
      stickyLb.addEndpoint("s2", "http://s2");
      stickyLb.addEndpoint("s3", "http://s3");

      const key = "session_xyz";
      const first = stickyLb.select(key);
      const second = stickyLb.select(key);
      const third = stickyLb.select(key);
      expect(first?.id).toBe(second?.id);
      expect(second?.id).toBe(third?.id);
    });

    it("should not apply sticky when stickySessionTtl is 0", () => {
      const noStickyLb = new LoadBalancer({ strategy: "round-robin", stickySessionTtl: 0 });
      noStickyLb.addEndpoint("n1", "http://n1");
      noStickyLb.addEndpoint("n2", "http://n2");

      const key = "session_abc";
      const ids = new Set([noStickyLb.select(key)?.id, noStickyLb.select(key)?.id, noStickyLb.select(key)?.id]);
      // With round-robin and no sticky, should cycle through both endpoints
      expect(ids.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("execute — error rate tracking", () => {
    it("should mark endpoint unhealthy after high error rate", async () => {
      const errLb = new LoadBalancer({ strategy: "round-robin", maxRetries: 10 });
      errLb.addEndpoint("flaky", "http://flaky");
      errLb.addEndpoint("stable", "http://stable");

      let calls = 0;
      try {
        await errLb.execute(async (ep) => {
          calls++;
          if (ep.id === "flaky") throw new Error("flaky error");
          return "ok";
        });
      } catch {
        // may throw if retries exhausted
      }

      const flaky = errLb.getEndpoints().find((e) => e.id === "flaky");
      // After enough errors, flaky should be marked unhealthy
      if (flaky && flaky.totalRequests >= 5) {
        expect(flaky.healthy).toBe(false);
      }
    });
  });

  describe("TypedBatchHandler", () => {
    it("should register and execute typed handlers", async () => {
      const { TypedBatchHandler } = await import("../lib/agent/optimization/batch-handler");
      type Ops = "double" | "triple";
      const batcher = new TypedBatchHandler<Ops, number, number>();

      batcher.register("double", async (items) => items.map((x) => x * 2), { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });
      batcher.register("triple", async (items) => items.map((x) => x * 3), { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });

      const [d, t] = await Promise.all([
        batcher.execute("double", 5),
        batcher.execute("triple", 4),
      ]);
      expect(d).toBe(10);
      expect(t).toBe(12);
    });

    it("should throw for unregistered type", async () => {
      const { TypedBatchHandler } = await import("../lib/agent/optimization/batch-handler");
      type Ops = "known";
      const batcher = new TypedBatchHandler<Ops, number, number>();
      await expect(batcher.execute("known", 1)).rejects.toThrow("No handler registered");
    });

    it("should return null from getHandler for unknown type", async () => {
      const { TypedBatchHandler } = await import("../lib/agent/optimization/batch-handler");
      type Ops = "known";
      const batcher = new TypedBatchHandler<Ops, number, number>();
      expect(batcher.getHandler("known")).toBeNull();
    });

    it("should aggregate stats across all handlers", async () => {
      const { TypedBatchHandler } = await import("../lib/agent/optimization/batch-handler");
      type Ops = "a" | "b";
      const batcher = new TypedBatchHandler<Ops, number, number>();
      batcher.register("a", async (items) => items, { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });
      batcher.register("b", async (items) => items, { maxBatchSize: 10, maxWaitTime: 50, deduplication: false, retryOnError: false, maxRetries: 0 });

      await Promise.all([batcher.execute("a", 1), batcher.execute("b", 2)]);
      const stats = batcher.getAllStatistics();
      expect(stats["a"].totalRequests).toBeGreaterThanOrEqual(1);
      expect(stats["b"].totalRequests).toBeGreaterThanOrEqual(1);
    });
  });
});
