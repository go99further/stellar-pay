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
});
