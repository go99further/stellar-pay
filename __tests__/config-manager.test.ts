import { describe, it, expect, beforeEach } from "vitest";
import { ConfigManager } from "../lib/agent/config/config-manager";

describe("ConfigManager", () => {
  let manager: ConfigManager;

  beforeEach(() => {
    manager = new ConfigManager();
  });

  describe("load / get", () => {
    it("should load from a source and retrieve values", async () => {
      manager.addSource({
        name: "static",
        priority: 1,
        load: () => ({ host: "localhost", port: 8080, debug: true }),
      });

      await manager.load();

      expect(manager.get("host")).toBe("localhost");
      expect(manager.get("port")).toBe(8080);
      expect(manager.get("debug")).toBe(true);
    });

    it("should return undefined for missing key", async () => {
      await manager.load();
      expect(manager.get("nonexistent")).toBeUndefined();
    });

    it("should support dot-notation for nested keys", async () => {
      manager.addSource({
        name: "nested",
        priority: 1,
        load: () => ({ db: { host: "db.local", port: 5432 } }),
      });

      await manager.load();
      expect(manager.get("db.host")).toBe("db.local");
      expect(manager.get("db.port")).toBe(5432);
    });
  });

  describe("layered sources", () => {
    it("should merge sources with higher priority overriding lower", async () => {
      manager.addSource({
        name: "defaults",
        priority: 1,
        load: () => ({ timeout: 5000, retries: 3, host: "default.host" }),
      });
      manager.addSource({
        name: "env",
        priority: 2,
        load: () => ({ timeout: 10000, host: "env.host" }),
      });

      await manager.load();

      expect(manager.get("timeout")).toBe(10000); // env overrides
      expect(manager.get("host")).toBe("env.host"); // env overrides
      expect(manager.get("retries")).toBe(3); // only in defaults
    });

    it("should deep-merge nested objects", async () => {
      manager.addSource({
        name: "base",
        priority: 1,
        load: () => ({ db: { host: "localhost", port: 5432, ssl: false } }),
      });
      manager.addSource({
        name: "override",
        priority: 2,
        load: () => ({ db: { ssl: true } }),
      });

      await manager.load();

      expect(manager.get("db.host")).toBe("localhost"); // preserved
      expect(manager.get("db.ssl")).toBe(true); // overridden
    });
  });

  describe("schema defaults and validation", () => {
    it("should apply schema defaults for missing keys", async () => {
      const mgr = new ConfigManager({
        schema: {
          maxConnections: { type: "number", default: 10 },
          logLevel: { type: "string", default: "info" },
        },
      });

      await mgr.load();

      expect(mgr.get("maxConnections")).toBe(10);
      expect(mgr.get("logLevel")).toBe("info");
    });

    it("should throw when required key is missing", async () => {
      const mgr = new ConfigManager({
        schema: {
          apiKey: { type: "string", required: true },
        },
      });

      await expect(mgr.load()).rejects.toThrow(/apiKey.*required/i);
    });

    it("should throw when custom validation fails", async () => {
      const mgr = new ConfigManager({
        schema: {
          port: {
            type: "number",
            default: 99999,
            validate: (v) => typeof v === "number" && v > 0 && v < 65536,
          },
        },
      });

      await expect(mgr.load()).rejects.toThrow(/port.*validation/i);
    });
  });

  describe("set (runtime override)", () => {
    it("should override a value at runtime", async () => {
      manager.addSource({
        name: "base",
        priority: 1,
        load: () => ({ level: "info" }),
      });
      await manager.load();

      manager.set("level", "debug");
      expect(manager.get("level")).toBe("debug");
    });

    it("should create nested keys via dot notation", async () => {
      await manager.load();
      manager.set("feature.enabled", true);
      expect(manager.get("feature.enabled")).toBe(true);
    });
  });

  describe("has", () => {
    it("should return true for existing key", async () => {
      manager.addSource({ name: "s", priority: 1, load: () => ({ x: 1 }) });
      await manager.load();
      expect(manager.has("x")).toBe(true);
    });

    it("should return false for missing key", async () => {
      await manager.load();
      expect(manager.has("missing")).toBe(false);
    });
  });

  describe("getOrDefault", () => {
    it("should return value when key exists", async () => {
      manager.addSource({ name: "s", priority: 1, load: () => ({ timeout: 3000 }) });
      await manager.load();
      expect(manager.getOrDefault("timeout", 1000)).toBe(3000);
    });

    it("should return default when key is missing", async () => {
      await manager.load();
      expect(manager.getOrDefault("missing", 42)).toBe(42);
    });
  });

  describe("getAll with secret masking", () => {
    it("should mask secret fields", async () => {
      const mgr = new ConfigManager({
        schema: {
          apiKey: { type: "string", secret: true },
          host: { type: "string" },
        },
      });
      mgr.addSource({
        name: "s",
        priority: 1,
        load: () => ({ apiKey: "super-secret-key", host: "localhost" }),
      });
      await mgr.load();

      const all = mgr.getAll(true);
      expect(all.apiKey).toBe("***");
      expect(all.host).toBe("localhost");
    });

    it("should expose secrets when maskSecrets=false", async () => {
      const mgr = new ConfigManager({
        schema: { apiKey: { type: "string", secret: true } },
      });
      mgr.addSource({ name: "s", priority: 1, load: () => ({ apiKey: "secret" }) });
      await mgr.load();

      const all = mgr.getAll(false);
      expect(all.apiKey).toBe("secret");
    });
  });

  describe("onChange listener", () => {
    it("should notify listener when key changes on reload", async () => {
      let callCount = 0;
      let latestValue: unknown;

      manager.addSource({ name: "s", priority: 1, load: () => ({ level: "info" }) });
      await manager.load();

      manager.onChange("level", (event) => {
        callCount++;
        latestValue = event.newValue;
      });

      // Simulate config change by adding a higher-priority source
      manager.addSource({ name: "override", priority: 2, load: () => ({ level: "debug" }) });
      await manager.reload();

      expect(callCount).toBe(1);
      expect(latestValue).toBe("debug");
    });

    it("should unsubscribe when returned function is called", async () => {
      let callCount = 0;
      manager.addSource({ name: "s", priority: 1, load: () => ({ x: 1 }) });
      await manager.load();

      const unsub = manager.onChange("x", () => { callCount++; });
      manager.set("x", 2);
      unsub();
      manager.set("x", 3);

      expect(callCount).toBe(1);
    });
  });

  describe("onAnyChange listener", () => {
    it("should notify on any config change", async () => {
      const changes: string[] = [];
      manager.addSource({ name: "s", priority: 1, load: () => ({ a: 1, b: 2 }) });
      await manager.load();

      manager.onAnyChange((event) => { changes.push(event.key); });
      manager.set("a", 99);
      manager.set("b", 100);

      expect(changes).toContain("a");
      expect(changes).toContain("b");
    });
  });
});
