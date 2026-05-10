import { describe, it, expect } from "vitest";
import { defaultRegistry } from "../lib/agent/registry";
import type { RouterIntent } from "../lib/agent/types";

describe("registry", () => {
  describe("defaultRegistry", () => {
    it("should contain analytics, trading, and security agents", () => {
      const names = defaultRegistry.agents.map((a) => a.name);
      expect(names).toContain("analytics");
      expect(names).toContain("trading");
      expect(names).toContain("security");
    });

    it("should have 3 agents (clarify is intentionally absent)", () => {
      expect(defaultRegistry.agents).toHaveLength(3);
    });

    it("should get analytics agent by intent", () => {
      const agent = defaultRegistry.get("analytics");
      expect(agent).toBeDefined();
      expect(agent!.name).toBe("analytics");
    });

    it("should get trading agent by intent", () => {
      const agent = defaultRegistry.get("trading");
      expect(agent).toBeDefined();
      expect(agent!.name).toBe("trading");
    });

    it("should get security agent by intent", () => {
      const agent = defaultRegistry.get("security");
      expect(agent).toBeDefined();
      expect(agent!.name).toBe("security");
    });

    it("should return undefined for clarify intent", () => {
      expect(defaultRegistry.get("clarify")).toBeUndefined();
    });

    it("should have description on each agent", () => {
      for (const agent of defaultRegistry.agents) {
        expect(typeof agent.description).toBe("string");
        expect(agent.description.length).toBeGreaterThan(0);
      }
    });

    it("should have run function on each agent", () => {
      for (const agent of defaultRegistry.agents) {
        expect(typeof agent.run).toBe("function");
      }
    });
  });
});
