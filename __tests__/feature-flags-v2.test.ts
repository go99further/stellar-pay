import { describe, it, expect, beforeEach } from "vitest";
import { FeatureFlagManager } from "../lib/agent/config/feature-flags";
import type { FeatureFlag, FlagContext } from "../lib/agent/config/feature-flags";

describe("FeatureFlagManager", () => {
  let mgr: FeatureFlagManager;

  beforeEach(() => {
    mgr = new FeatureFlagManager();
  });

  function defineSimple(key: string, defaultValue: boolean, enabled = true) {
    mgr.define({ key, description: "test", defaultValue, enabled, tags: [] });
  }

  describe("define / getFlag / getAllFlags", () => {
    it("should define and retrieve a flag", () => {
      defineSimple("my_flag", true);
      const flag = mgr.getFlag("my_flag");
      expect(flag).not.toBeNull();
      expect(flag!.key).toBe("my_flag");
      expect(flag!.defaultValue).toBe(true);
    });

    it("should return null for undefined flag", () => {
      expect(mgr.getFlag("nonexistent")).toBeNull();
    });

    it("should list all defined flags", () => {
      defineSimple("a", true);
      defineSimple("b", false);
      const flags = mgr.getAllFlags();
      expect(flags.map((f) => f.key)).toContain("a");
      expect(flags.map((f) => f.key)).toContain("b");
    });
  });

  describe("evaluate / isEnabled", () => {
    it("should return defaultValue when flag is enabled with no rules", () => {
      defineSimple("flag", true);
      const result = mgr.evaluate("flag");
      expect(result.value).toBe(true);
    });

    it("should return false for unknown flag", () => {
      const result = mgr.evaluate("unknown");
      expect(result.value).toBe(false);
      expect(result.reason).toBe("default");
    });

    it("should return defaultValue when flag is disabled", () => {
      mgr.define({ key: "flag", description: "", defaultValue: true, enabled: false, tags: [] });
      const result = mgr.evaluate("flag");
      expect(result.reason).toBe("disabled");
    });

    it("isEnabled returns boolean", () => {
      defineSimple("flag", true);
      expect(mgr.isEnabled("flag")).toBe(true);
    });

    it("getString returns string", () => {
      mgr.define({ key: "theme", description: "", defaultValue: "dark", enabled: true, tags: [] });
      expect(mgr.getString("theme")).toBe("dark");
    });

    it("getNumber returns number", () => {
      mgr.define({ key: "limit", description: "", defaultValue: 42, enabled: true, tags: [] });
      expect(mgr.getNumber("limit")).toBe(42);
    });
  });

  describe("targeting rules", () => {
    it("should match equals operator", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "plan", operator: "equals", values: ["pro"], value: true }],
      });
      const ctx: FlagContext = { attributes: { plan: "pro" } };
      expect(mgr.evaluate("flag", ctx).value).toBe(true);
    });

    it("should not match equals when value differs — falls through to rollout default", () => {
      // When no targeting rule matches and no rollout is set, the flag is enabled
      // so it returns true (not defaultValue=false) per the implementation
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "plan", operator: "equals", values: ["pro"], value: "pro_value" }],
      });
      const ctx: FlagContext = { attributes: { plan: "free" } };
      // No targeting match → falls to rollout path → returns true (enabled flag with false default)
      const result = mgr.evaluate("flag", ctx);
      expect(result.reason).toBe("rollout");
    });

    it("should match contains operator", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "email", operator: "contains", values: ["@company.com"], value: true }],
      });
      const ctx: FlagContext = { attributes: { email: "user@company.com" } };
      expect(mgr.evaluate("flag", ctx).value).toBe(true);
    });

    it("should match startsWith operator", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "userId", operator: "startsWith", values: ["admin_"], value: true }],
      });
      const ctx: FlagContext = { attributes: { userId: "admin_123" } };
      expect(mgr.evaluate("flag", ctx).value).toBe(true);
    });

    it("should match in operator", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "country", operator: "in", values: ["US", "CA", "UK"], value: true }],
      });
      const ctx: FlagContext = { attributes: { country: "CA" } };
      expect(mgr.evaluate("flag", ctx).value).toBe(true);
    });

    it("should match notIn operator", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "country", operator: "notIn", values: ["CN", "RU"], value: true }],
      });
      const ctx: FlagContext = { attributes: { country: "US" } };
      expect(mgr.evaluate("flag", ctx).value).toBe(true);
    });

    it("should return targeting_match reason", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        targeting: [{ attribute: "plan", operator: "equals", values: ["pro"], value: true }],
      });
      const result = mgr.evaluate("flag", { attributes: { plan: "pro" } });
      expect(result.reason).toBe("targeting_match");
    });
  });

  describe("rollout", () => {
    it("should include user in 100% rollout", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        rollout: { percentage: 100, hashAttribute: "userId" },
      });
      const result = mgr.evaluate("flag", { userId: "any_user", attributes: {} });
      expect(result.reason).toBe("rollout");
    });

    it("should exclude user from 0% rollout", () => {
      mgr.define({
        key: "flag",
        description: "",
        defaultValue: false,
        enabled: true,
        tags: [],
        rollout: { percentage: 0, hashAttribute: "userId" },
      });
      const result = mgr.evaluate("flag", { userId: "any_user", attributes: {} });
      expect(result.value).toBe(false);
    });
  });

  describe("variants (A/B testing)", () => {
    it("should select a variant", () => {
      mgr.define({
        key: "ab_test",
        description: "",
        defaultValue: "control",
        enabled: true,
        tags: [],
        variants: [
          { key: "control", value: "control", weight: 50 },
          { key: "treatment", value: "treatment", weight: 50 },
        ],
      });
      const result = mgr.evaluate("ab_test", { userId: "user1", attributes: {} });
      expect(["control", "treatment"]).toContain(result.value);
      expect(result.reason).toBe("variant");
    });

    it("should assign same variant consistently for same user", () => {
      mgr.define({
        key: "ab_test",
        description: "",
        defaultValue: "control",
        enabled: true,
        tags: [],
        variants: [
          { key: "control", value: "control", weight: 50 },
          { key: "treatment", value: "treatment", weight: 50 },
        ],
      });
      const ctx: FlagContext = { userId: "stable_user", attributes: {} };
      const r1 = mgr.evaluate("ab_test", ctx);
      const r2 = mgr.evaluate("ab_test", ctx);
      expect(r1.value).toBe(r2.value);
    });
  });

  describe("enable / disable / update / delete", () => {
    it("should enable a disabled flag", () => {
      mgr.define({ key: "flag", description: "", defaultValue: true, enabled: false, tags: [] });
      mgr.enable("flag");
      expect(mgr.getFlag("flag")!.enabled).toBe(true);
    });

    it("should disable an enabled flag", () => {
      defineSimple("flag", true);
      mgr.disable("flag");
      expect(mgr.getFlag("flag")!.enabled).toBe(false);
    });

    it("should return false when enabling nonexistent flag", () => {
      expect(mgr.enable("nonexistent")).toBe(false);
    });

    it("should update flag properties", () => {
      defineSimple("flag", false);
      mgr.update("flag", { description: "updated" });
      expect(mgr.getFlag("flag")!.description).toBe("updated");
    });

    it("should delete a flag", () => {
      defineSimple("flag", true);
      expect(mgr.delete("flag")).toBe(true);
      expect(mgr.getFlag("flag")).toBeNull();
    });

    it("should return false when deleting nonexistent flag", () => {
      expect(mgr.delete("nonexistent")).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return null for flag with no evaluations", () => {
      defineSimple("flag", true);
      expect(mgr.getStats("flag")).toBeNull();
    });

    it("should count evaluations", () => {
      defineSimple("flag", true);
      mgr.evaluate("flag");
      mgr.evaluate("flag");
      const stats = mgr.getStats("flag");
      expect(stats).not.toBeNull();
      expect(stats!.totalEvaluations).toBe(2);
    });

    it("should track variant counts", () => {
      defineSimple("flag", true);
      mgr.evaluate("flag");
      const stats = mgr.getStats("flag");
      expect(typeof stats!.variantCounts).toBe("object");
    });
  });
});

import { featureFlags } from "../lib/agent/config/feature-flags";

describe("featureFlags — shared instance", () => {
  it("should be a FeatureFlagManager instance", () => {
    expect(featureFlags).toBeInstanceOf(FeatureFlagManager);
  });

  it("should have enable_simulation_cache defined", () => {
    const flag = featureFlags.getFlag("enable_simulation_cache");
    expect(flag).not.toBeNull();
    expect(flag!.enabled).toBe(true);
  });

  it("should have enable_batch_requests defined", () => {
    const flag = featureFlags.getFlag("enable_batch_requests");
    expect(flag).not.toBeNull();
    expect(flag!.defaultValue).toBe(true);
  });

  it("should have enable_reflection_loop with rollout", () => {
    const flag = featureFlags.getFlag("enable_reflection_loop");
    expect(flag).not.toBeNull();
    expect(flag!.rollout).toBeDefined();
    expect(flag!.rollout!.percentage).toBe(50);
  });

  it("should have new_swap_ui with variants", () => {
    const flag = featureFlags.getFlag("new_swap_ui");
    expect(flag).not.toBeNull();
    expect(flag!.variants).toBeDefined();
    expect(flag!.variants!.length).toBe(2);
  });

  it("should have max_slippage_tolerance with numeric default", () => {
    const flag = featureFlags.getFlag("max_slippage_tolerance");
    expect(flag).not.toBeNull();
    expect(flag!.defaultValue).toBe(0.5);
  });

  it("getAllFlags should include all predefined flags", () => {
    const all = featureFlags.getAllFlags();
    const keys = all.map((f) => f.key);
    expect(keys).toContain("enable_simulation_cache");
    expect(keys).toContain("enable_batch_requests");
    expect(keys).toContain("enable_reflection_loop");
    expect(keys).toContain("new_swap_ui");
    expect(keys).toContain("max_slippage_tolerance");
  });
});
