import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeatureFlags } from "../lib/agent/feature-flags";

describe("FeatureFlags", () => {
  let ff: FeatureFlags;

  beforeEach(() => {
    ff = new FeatureFlags();
  });

  describe("define / evaluate", () => {
    it("should return defaultValue for defined flag", () => {
      ff.define({ name: "dark-mode", defaultValue: false });
      expect(ff.evaluate("dark-mode")).toBe(false);
    });

    it("should return false for undefined flag", () => {
      expect(ff.evaluate("unknown-flag")).toBe(false);
    });

    it("should support string default values", () => {
      ff.define({ name: "theme", defaultValue: "light" });
      expect(ff.evaluate("theme")).toBe("light");
    });

    it("should support number default values", () => {
      ff.define({ name: "max-retries", defaultValue: 3 });
      expect(ff.evaluate("max-retries")).toBe(3);
    });
  });

  describe("isEnabled", () => {
    it("should return true when flag evaluates to true", () => {
      ff.define({ name: "feature-x", defaultValue: true });
      expect(ff.isEnabled("feature-x")).toBe(true);
    });

    it("should return false when flag evaluates to false", () => {
      ff.define({ name: "feature-x", defaultValue: false });
      expect(ff.isEnabled("feature-x")).toBe(false);
    });
  });

  describe("boolean rule", () => {
    it("should apply boolean rule", () => {
      ff.define({
        name: "new-ui",
        defaultValue: false,
        rules: [{ type: "boolean", value: true }],
      });
      expect(ff.evaluate("new-ui")).toBe(true);
    });
  });

  describe("allowlist rule", () => {
    it("should enable for allowlisted user", () => {
      ff.define({
        name: "beta",
        defaultValue: false,
        rules: [{ type: "allowlist", value: true, allowlist: ["alice", "bob"] }],
      });
      expect(ff.evaluate("beta", { userId: "alice" })).toBe(true);
    });

    it("should not enable for non-allowlisted user", () => {
      ff.define({
        name: "beta",
        defaultValue: false,
        rules: [{ type: "allowlist", value: true, allowlist: ["alice"] }],
      });
      expect(ff.evaluate("beta", { userId: "charlie" })).toBe(false);
    });

    it("should use default when no userId provided", () => {
      ff.define({
        name: "beta",
        defaultValue: false,
        rules: [{ type: "allowlist", value: true, allowlist: ["alice"] }],
      });
      expect(ff.evaluate("beta")).toBe(false);
    });
  });

  describe("denylist rule", () => {
    it("should disable for denylisted user", () => {
      ff.define({
        name: "feature",
        defaultValue: true,
        rules: [{ type: "denylist", value: false, denylist: ["banned-user"] }],
      });
      expect(ff.evaluate("feature", { userId: "banned-user" })).toBe(false);
    });

    it("should not affect non-denylisted users", () => {
      ff.define({
        name: "feature",
        defaultValue: true,
        rules: [{ type: "denylist", value: false, denylist: ["banned-user"] }],
      });
      expect(ff.evaluate("feature", { userId: "normal-user" })).toBe(true);
    });
  });

  describe("percentage rule", () => {
    it("should enable for users within percentage", () => {
      ff.define({
        name: "rollout",
        defaultValue: false,
        rules: [{ type: "percentage", value: true, percentage: 100 }],
      });
      expect(ff.evaluate("rollout", { userId: "any-user" })).toBe(true);
    });

    it("should disable for users outside percentage", () => {
      ff.define({
        name: "rollout",
        defaultValue: false,
        rules: [{ type: "percentage", value: true, percentage: 0 }],
      });
      expect(ff.evaluate("rollout", { userId: "any-user" })).toBe(false);
    });

    it("should use default when no userId for percentage rule", () => {
      ff.define({
        name: "rollout",
        defaultValue: false,
        rules: [{ type: "percentage", value: true, percentage: 100 }],
      });
      expect(ff.evaluate("rollout")).toBe(false);
    });
  });

  describe("overrides", () => {
    it("should apply global override", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true);
      expect(ff.evaluate("feature")).toBe(true);
    });

    it("should apply user-level override", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true, "alice");
      expect(ff.evaluate("feature", { userId: "alice" })).toBe(true);
      expect(ff.evaluate("feature", { userId: "bob" })).toBe(false);
    });

    it("user override takes precedence over global override", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true); // global
      ff.setOverride("feature", false, "alice"); // user
      expect(ff.evaluate("feature", { userId: "alice" })).toBe(false);
    });

    it("should clear global override", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true);
      ff.clearOverride("feature");
      expect(ff.evaluate("feature")).toBe(false);
    });

    it("should clear user override", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true, "alice");
      ff.clearOverride("feature", "alice");
      expect(ff.evaluate("feature", { userId: "alice" })).toBe(false);
    });
  });

  describe("onChange listener", () => {
    it("should notify listener on override change", () => {
      const listener = vi.fn();
      ff.define({ name: "feature", defaultValue: false });
      ff.onChange("feature", listener);
      ff.setOverride("feature", true);
      expect(listener).toHaveBeenCalledWith(true);
    });

    it("should unsubscribe listener", () => {
      const listener = vi.fn();
      ff.define({ name: "feature", defaultValue: false });
      const unsub = ff.onChange("feature", listener);
      unsub();
      ff.setOverride("feature", true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("audit log", () => {
    it("should record evaluations", () => {
      ff.define({ name: "feature", defaultValue: true });
      ff.evaluate("feature");
      ff.evaluate("feature");
      expect(ff.getAuditLog("feature")).toHaveLength(2);
    });

    it("should record reason", () => {
      ff.define({ name: "feature", defaultValue: true });
      ff.evaluate("feature");
      const log = ff.getAuditLog("feature");
      expect(log[0].reason).toBe("default");
    });

    it("should record override reason", () => {
      ff.define({ name: "feature", defaultValue: false });
      ff.setOverride("feature", true);
      ff.evaluate("feature");
      const log = ff.getAuditLog("feature");
      expect(log[0].reason).toBe("override");
    });

    it("should return all logs when no filter", () => {
      ff.define({ name: "a", defaultValue: true });
      ff.define({ name: "b", defaultValue: false });
      ff.evaluate("a");
      ff.evaluate("b");
      expect(ff.getAuditLog()).toHaveLength(2);
    });

    it("should respect maxAuditLog limit", () => {
      const smallFf = new FeatureFlags({ maxAuditLog: 3 });
      smallFf.define({ name: "f", defaultValue: true });
      for (let i = 0; i < 5; i++) smallFf.evaluate("f");
      expect(smallFf.getAuditLog()).toHaveLength(3);
    });
  });

  describe("getAllFlags", () => {
    it("should return all defined flags", () => {
      ff.define({ name: "a", defaultValue: true });
      ff.define({ name: "b", defaultValue: false });
      expect(ff.getAllFlags()).toHaveLength(2);
    });
  });

  describe("isEnabled", () => {
    it("should return true for truthy flag value", () => {
      ff.define({ name: "feat", defaultValue: true });
      expect(ff.isEnabled("feat")).toBe(true);
    });

    it("should return false for falsy flag value", () => {
      ff.define({ name: "feat", defaultValue: false });
      expect(ff.isEnabled("feat")).toBe(false);
    });

    it("should return false for undefined flag", () => {
      expect(ff.isEnabled("nonexistent")).toBe(false);
    });
  });

  describe("evaluate — rule type: boolean", () => {
    it("should return rule value when type is boolean and condition is true", () => {
      ff.define({
        name: "bool-rule",
        defaultValue: false,
        rules: [{ type: "boolean", value: true }],
      });
      expect(ff.evaluate("bool-rule")).toBe(true);
    });
  });

  describe("evaluate — string and number defaults", () => {
    it("should return string default", () => {
      ff.define({ name: "theme", defaultValue: "dark" });
      expect(ff.evaluate("theme")).toBe("dark");
    });

    it("should return number default", () => {
      ff.define({ name: "limit", defaultValue: 100 });
      expect(ff.evaluate("limit")).toBe(100);
    });
  });

  describe("audit log — reason tracking", () => {
    it("should record rule reason when rule matches", () => {
      ff.define({
        name: "rule-flag",
        defaultValue: false,
        rules: [{ type: "boolean", value: true }],
      });
      ff.evaluate("rule-flag");
      const log = ff.getAuditLog("rule-flag");
      expect(log[0].reason).toBe("rule");
    });

    it("should record default reason for undefined flag", () => {
      ff.evaluate("undefined-flag");
      const log = ff.getAuditLog("undefined-flag");
      expect(log[0].reason).toBe("default");
    });
  });

  describe("clearOverride", () => {
    it("should clear global override and revert to default", () => {
      ff.define({ name: "feat", defaultValue: false });
      ff.setOverride("feat", true);
      expect(ff.evaluate("feat")).toBe(true);
      ff.clearOverride("feat");
      expect(ff.evaluate("feat")).toBe(false);
    });

    it("should clear user-level override", () => {
      ff.define({ name: "feat", defaultValue: false });
      ff.setOverride("feat", true, "alice");
      expect(ff.evaluate("feat", { userId: "alice" })).toBe(true);
      ff.clearOverride("feat", "alice");
      expect(ff.evaluate("feat", { userId: "alice" })).toBe(false);
    });
  });
});
