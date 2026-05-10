import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigManager } from "../lib/agent/config-manager";

describe("ConfigManager", () => {
  let cfg: ConfigManager;

  beforeEach(() => {
    cfg = new ConfigManager();
  });

  describe("load / get", () => {
    it("should load and retrieve a value", () => {
      cfg.load({ host: "localhost", port: 3000 });
      expect(cfg.get("host")).toBe("localhost");
      expect(cfg.get("port")).toBe(3000);
    });

    it("should return undefined for missing key", () => {
      expect(cfg.get("missing")).toBeUndefined();
    });

    it("should return fallback for missing key", () => {
      expect(cfg.get("missing", "default")).toBe("default");
    });

    it("should return schema default when key missing", () => {
      const c = new ConfigManager({
        schema: { timeout: { type: "number", default: 5000 } },
      });
      expect(c.get("timeout")).toBe(5000);
    });

    it("should merge multiple layers (higher priority wins)", () => {
      cfg.load({ host: "base-host", port: 80 }, 0);
      cfg.load({ host: "override-host" }, 1);
      expect(cfg.get("host")).toBe("override-host");
      expect(cfg.get("port")).toBe(80);
    });
  });

  describe("set", () => {
    it("should set a value at runtime", () => {
      cfg.set("debug", true);
      expect(cfg.get("debug")).toBe(true);
    });

    it("should overwrite existing value", () => {
      cfg.load({ level: "info" });
      cfg.set("level", "debug");
      expect(cfg.get("level")).toBe("debug");
    });
  });

  describe("has", () => {
    it("should return true for existing key", () => {
      cfg.load({ key: "value" });
      expect(cfg.has("key")).toBe(true);
    });

    it("should return false for missing key", () => {
      expect(cfg.has("missing")).toBe(false);
    });
  });

  describe("validate", () => {
    it("should pass validation for valid config", () => {
      const c = new ConfigManager({
        schema: {
          host: { type: "string", required: true },
          port: { type: "number", required: true },
        },
      });
      c.load({ host: "localhost", port: 3000 });
      const result = c.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail for missing required key", () => {
      const c = new ConfigManager({
        schema: { apiKey: { type: "string", required: true } },
      });
      const result = c.validate();
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("apiKey");
    });

    it("should fail for wrong type", () => {
      const c = new ConfigManager({
        schema: { port: { type: "number" } },
      });
      c.load({ port: "not-a-number" });
      const result = c.validate();
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("port");
    });

    it("should fail custom validation", () => {
      const c = new ConfigManager({
        schema: {
          port: { type: "number", validate: (v) => typeof v === "number" && v > 0 && v < 65536 },
        },
      });
      c.load({ port: 99999 });
      const result = c.validate();
      expect(result.valid).toBe(false);
    });
  });

  describe("toObject", () => {
    it("should return all config values", () => {
      cfg.load({ a: 1, b: "two" });
      const obj = cfg.toObject();
      expect(obj.a).toBe(1);
      expect(obj.b).toBe("two");
    });

    it("should mask secret values", () => {
      const c = new ConfigManager({
        schema: { apiKey: { type: "string", secret: true } },
      });
      c.load({ apiKey: "super-secret", host: "localhost" });
      const obj = c.toObject(true);
      expect(obj.apiKey).toBe("***");
      expect(obj.host).toBe("localhost");
    });

    it("should not mask when maskSecrets=false", () => {
      const c = new ConfigManager({
        schema: { apiKey: { type: "string", secret: true } },
      });
      c.load({ apiKey: "super-secret" });
      const obj = c.toObject(false);
      expect(obj.apiKey).toBe("super-secret");
    });
  });

  describe("onChange listener", () => {
    it("should notify listener when value changes via set()", () => {
      const listener = vi.fn();
      cfg.load({ level: "info" });
      cfg.onChange("level", listener);
      cfg.set("level", "debug");
      expect(listener).toHaveBeenCalledWith("debug", "info");
    });

    it("should notify listener when value changes via load()", () => {
      const listener = vi.fn();
      cfg.load({ host: "old" });
      cfg.onChange("host", listener);
      cfg.load({ host: "new" }, 1);
      expect(listener).toHaveBeenCalledWith("new", "old");
    });

    it("should unsubscribe listener", () => {
      const listener = vi.fn();
      cfg.load({ x: 1 });
      const unsub = cfg.onChange("x", listener);
      unsub();
      cfg.set("x", 2);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("dot-notation access", () => {
    it("should get nested value via dot notation", () => {
      cfg.load({ db: { host: "db-host", port: 5432 } });
      expect(cfg.get("db.host")).toBe("db-host");
    });

    it("should set nested value via dot notation", () => {
      cfg.set("server.port", 8080);
      expect(cfg.get("server.port")).toBe(8080);
    });

    it("should return undefined for missing nested path", () => {
      cfg.load({ db: { host: "localhost" } });
      expect(cfg.get("db.missing")).toBeUndefined();
    });
  });
});
