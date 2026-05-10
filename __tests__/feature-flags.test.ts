import { describe, it, expect, beforeEach, vi } from "vitest";
import { FeatureFlagManager } from "../lib/agent/config/feature-flags";

describe("FeatureFlagManager", () => {
  let manager: FeatureFlagManager;

  beforeEach(() => {
    manager = new FeatureFlagManager();
  });

  describe("define / isEnabled", () => {
    it("should return default value for undefined flag", () => {
      const val = manager.evaluate("nonexistent", { attributes: {} });
      expect(val.value).toBe(false);
    });

    it("should return defaultValue when flag is enabled", () => {
      manager.define({
        key: "my_flag",
        description: "test",
        defaultValue: true,
        enabled: true,
        tags: [],
      });

      const val = manager.evaluate("my_flag", { attributes: {} });
      expect(val.value).toBe(true);
    });

    it("should return defaultValue when flag is disabled", () => {
      manager.define({
        key: "off_flag",
        description: "test",
        defaultValue: "hello",
        enabled: false,
        tags: [],
      });

      const val = manager.evaluate("off_flag", { attributes: {} });
      expect(val.value).toBe("hello");
      expect(val.reason).toBe("disabled");
    });
  });

  describe("enable / disable", () => {
    it("should toggle flag enabled state", () => {
      manager.define({
        key: "toggle_flag",
        description: "test",
        defaultValue: 42,
        enabled: false,
        tags: [],
      });

      manager.enable("toggle_flag");
      // enabled=true, defaultValue=42 → reason="rollout", value=42
      const afterEnable = manager.evaluate("toggle_flag", { attributes: {} });
      expect(afterEnable.reason).not.toBe("disabled");

      manager.disable("toggle_flag");
      // enabled=false → reason="disabled"
      const afterDisable = manager.evaluate("toggle_flag", { attributes: {} });
      expect(afterDisable.reason).toBe("disabled");
    });
  });

  describe("rollout percentage", () => {
    it("should respect 0% rollout", () => {
      manager.define({
        key: "zero_rollout",
        description: "test",
        defaultValue: true,
        enabled: true,
        rollout: { percentage: 0, hashAttribute: "userId" },
        tags: [],
      });

      let enabledCount = 0;
      for (let i = 0; i < 100; i++) {
        const val = manager.evaluate("zero_rollout", { userId: `user_${i}`, attributes: {} });
        if (val.reason === "rollout" && val.value === true) enabledCount++;
      }
      expect(enabledCount).toBe(0);
    });

    it("should respect 100% rollout", () => {
      manager.define({
        key: "full_rollout",
        description: "test",
        defaultValue: true,
        enabled: true,
        rollout: { percentage: 100, hashAttribute: "userId" },
        tags: [],
      });

      let enabledCount = 0;
      for (let i = 0; i < 20; i++) {
        const val = manager.evaluate("full_rollout", { userId: `user_${i}`, attributes: {} });
        if (val.value === true) enabledCount++;
      }
      expect(enabledCount).toBe(20);
    });

    it("should give consistent results for same user", () => {
      manager.define({
        key: "consistent_flag",
        description: "test",
        defaultValue: true,
        enabled: true,
        rollout: { percentage: 50, hashAttribute: "userId" },
        tags: [],
      });

      const ctx = { userId: "user_abc", attributes: {} };
      const first = manager.evaluate("consistent_flag", ctx);
      const second = manager.evaluate("consistent_flag", ctx);
      expect(first.value).toBe(second.value);
    });
  });

  describe("targeting rules", () => {
    it("should match equals rule", () => {
      manager.define({
        key: "targeted_flag",
        description: "test",
        // Use a non-false defaultValue so the fallthrough path returns it correctly
        defaultValue: "default",
        enabled: true,
        targeting: [
          { attribute: "plan", operator: "equals", values: ["premium"], value: "premium_value" },
        ],
        tags: [],
      });

      const premiumVal = manager.evaluate("targeted_flag", { attributes: { plan: "premium" } });
      const freeVal = manager.evaluate("targeted_flag", { attributes: { plan: "free" } });

      expect(premiumVal.value).toBe("premium_value");
      expect(premiumVal.reason).toBe("targeting_match");
      expect(freeVal.value).toBe("default");
    });

    it("should match 'in' operator", () => {
      manager.define({
        key: "in_flag",
        description: "test",
        defaultValue: "no",
        enabled: true,
        targeting: [
          { attribute: "country", operator: "in", values: ["US", "CA", "GB"], value: "yes" },
        ],
        tags: [],
      });

      expect(manager.evaluate("in_flag", { attributes: { country: "US" } }).value).toBe("yes");
      expect(manager.evaluate("in_flag", { attributes: { country: "DE" } }).value).toBe("no");
    });
  });

  describe("getFlag / getAllFlags", () => {
    it("should retrieve a defined flag", () => {
      manager.define({
        key: "get_flag",
        description: "test",
        defaultValue: 99,
        enabled: true,
        tags: ["test"],
      });

      const flag = manager.getFlag("get_flag");
      expect(flag).toBeDefined();
      expect(flag!.key).toBe("get_flag");
      expect(flag!.defaultValue).toBe(99);
    });

    it("should list all defined flags", () => {
      manager.define({ key: "f1", description: "", defaultValue: true, enabled: true, tags: [] });
      manager.define({ key: "f2", description: "", defaultValue: false, enabled: true, tags: [] });

      const all = manager.getAllFlags();
      const keys = all.map((f) => f.key);
      expect(keys).toContain("f1");
      expect(keys).toContain("f2");
    });
  });
});
