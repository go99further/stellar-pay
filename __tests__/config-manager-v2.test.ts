import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigManager } from "../lib/agent/config/config-manager";
import type { ConfigSource, ConfigSchema } from "../lib/agent/config/config-manager";

describe("ConfigManager (config/config-manager)", () => {
  let mgr: ConfigManager;

  beforeEach(() => {
    mgr = new ConfigManager();
  });

  describe("load / get / getOrDefault", () => {
    it("should load config from a sync source and retrieve values", async () => {
      const source: ConfigSource = {
        name: "test",
        priority: 1,
        load: () => ({ host: "localhost", port: 3000 }),
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.get("host")).toBe("localhost");
      expect(mgr.get("port")).toBe(3000);
    });

    it("should load config from an async source", async () => {
      const source: ConfigSource = {
        name: "async",
        priority: 1,
        load: async () => ({ key: "value" }),
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.get("key")).toBe("value");
    });

    it("should return undefined for missing key", async () => {
      await mgr.load();
      expect(mgr.get("nonexistent")).toBeUndefined();
    });

    it("should return default value via getOrDefault", async () => {
      await mgr.load();
      expect(mgr.getOrDefault("missing", "fallback")).toBe("fallback");
    });

    it("should return actual value when key exists via getOrDefault", async () => {
      const source: ConfigSource = {
        name: "s",
        priority: 1,
        load: () => ({ key: "real" }),
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.getOrDefault("key", "fallback")).toBe("real");
    });

    it("should merge multiple sources with higher priority winning", async () => {
      const low: ConfigSource = { name: "low", priority: 1, load: () => ({ key: "low", shared: "from-low" }) };
      const high: ConfigSource = { name: "high", priority: 2, load: () => ({ key: "high" }) };
      mgr = new ConfigManager({ sources: [low, high] });
      await mgr.load();
      expect(mgr.get("key")).toBe("high");
      expect(mgr.get("shared")).toBe("from-low");
    });
  });

  describe("set / has", () => {
    it("should set a runtime value", async () => {
      await mgr.load();
      mgr.set("runtime_key", "runtime_value");
      expect(mgr.get("runtime_key")).toBe("runtime_value");
    });

    it("should overwrite existing value", async () => {
      const source: ConfigSource = { name: "s", priority: 1, load: () => ({ key: "original" }) };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      mgr.set("key", "overwritten");
      expect(mgr.get("key")).toBe("overwritten");
    });

    it("has() should return true for existing key", async () => {
      const source: ConfigSource = { name: "s", priority: 1, load: () => ({ key: "val" }) };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.has("key")).toBe(true);
    });

    it("has() should return false for missing key", async () => {
      await mgr.load();
      expect(mgr.has("nonexistent")).toBe(false);
    });
  });

  describe("dot-notation access", () => {
    it("should get nested value via dot notation", async () => {
      const source: ConfigSource = {
        name: "s",
        priority: 1,
        load: () => ({ db: { host: "pg.local", port: 5432 } }),
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.get("db.host")).toBe("pg.local");
      expect(mgr.get("db.port")).toBe(5432);
    });

    it("should set nested value via dot notation", async () => {
      await mgr.load();
      mgr.set("db.host", "new-host");
      expect(mgr.get("db.host")).toBe("new-host");
    });

    it("should return undefined for missing nested path", async () => {
      await mgr.load();
      expect(mgr.get("a.b.c")).toBeUndefined();
    });
  });

  describe("schema validation", () => {
    it("should apply schema defaults when key is missing", async () => {
      const schema: ConfigSchema = {
        timeout: { type: "number", default: 5000 },
      };
      mgr = new ConfigManager({ schema });
      await mgr.load();
      expect(mgr.get("timeout")).toBe(5000);
    });

    it("should throw when required key is missing", async () => {
      const schema: ConfigSchema = {
        api_key: { type: "string", required: true },
      };
      mgr = new ConfigManager({ schema });
      await expect(mgr.load()).rejects.toThrow(/api_key/);
    });

    it("should throw when custom validation fails", async () => {
      const schema: ConfigSchema = {
        port: { type: "number", validate: (v) => Number(v) > 0 && Number(v) < 65536 },
      };
      const source: ConfigSource = { name: "s", priority: 1, load: () => ({ port: 99999 }) };
      mgr = new ConfigManager({ schema, sources: [source] });
      await expect(mgr.load()).rejects.toThrow(/port/);
    });
  });

  describe("getAll with secret masking", () => {
    it("should mask secret values by default", async () => {
      const schema: ConfigSchema = {
        api_key: { type: "string", secret: true },
      };
      const source: ConfigSource = { name: "s", priority: 1, load: () => ({ api_key: "super-secret" }) };
      mgr = new ConfigManager({ schema, sources: [source] });
      await mgr.load();
      const all = mgr.getAll();
      expect(all.api_key).toBe("***");
    });

    it("should not mask when maskSecrets=false", async () => {
      const schema: ConfigSchema = {
        api_key: { type: "string", secret: true },
      };
      const source: ConfigSource = { name: "s", priority: 1, load: () => ({ api_key: "super-secret" }) };
      mgr = new ConfigManager({ schema, sources: [source] });
      await mgr.load();
      const all = mgr.getAll(false);
      expect(all.api_key).toBe("super-secret");
    });
  });

  describe("onChange / onAnyChange listeners", () => {
    it("should notify onChange listener when key changes via set()", async () => {
      await mgr.load();
      const events: unknown[] = [];
      mgr.onChange("key", (evt) => events.push(evt));
      mgr.set("key", "new_value");
      expect(events).toHaveLength(1);
    });

    it("should unsubscribe onChange listener", async () => {
      await mgr.load();
      const events: unknown[] = [];
      const unsub = mgr.onChange("key", (evt) => events.push(evt));
      unsub();
      mgr.set("key", "value");
      expect(events).toHaveLength(0);
    });

    it("should notify onAnyChange listener for any key change", async () => {
      await mgr.load();
      const keys: string[] = [];
      mgr.onAnyChange((evt) => keys.push(evt.key));
      mgr.set("a", 1);
      mgr.set("b", 2);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
    });

    it("should unsubscribe onAnyChange listener", async () => {
      await mgr.load();
      const events: unknown[] = [];
      const unsub = mgr.onAnyChange((evt) => events.push(evt));
      unsub();
      mgr.set("key", "value");
      expect(events).toHaveLength(0);
    });

    it("should notify onChange when value changes via reload", async () => {
      let callCount = 0;
      let tick = 0;
      const source: ConfigSource = {
        name: "s",
        priority: 1,
        load: () => ({ key: `value-${tick++}` }),
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load(); // tick=0 → key="value-0"
      mgr.onChange("key", () => callCount++);
      await mgr.reload(); // tick=1 → key="value-1" → change detected
      expect(callCount).toBe(1);
    });
  });

  describe("addSource", () => {
    it("should add a source and use it on next load", async () => {
      await mgr.load();
      mgr.addSource({ name: "extra", priority: 5, load: () => ({ extra_key: "extra_val" }) });
      await mgr.load();
      expect(mgr.get("extra_key")).toBe("extra_val");
    });
  });

  describe("destroy", () => {
    it("should stop hot reload timer without throwing", () => {
      const m = new ConfigManager({ reloadIntervalMs: 60000 });
      expect(() => m.destroy()).not.toThrow();
    });
  });

  describe("fallback on source error", () => {
    it("should use last known good config when source throws", async () => {
      let callCount = 0;
      const source: ConfigSource = {
        name: "flaky",
        priority: 1,
        load: () => {
          callCount++;
          if (callCount > 1) throw new Error("source down");
          return { key: "good_value" };
        },
      };
      mgr = new ConfigManager({ sources: [source] });
      await mgr.load();
      expect(mgr.get("key")).toBe("good_value");
      await mgr.reload();
      expect(mgr.get("key")).toBe("good_value");
    });
  });
});
