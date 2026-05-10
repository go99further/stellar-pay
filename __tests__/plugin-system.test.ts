import { describe, it, expect, beforeEach } from "vitest";
import { PluginSystem } from "../lib/agent/plugin-system";
import type { Plugin } from "../lib/agent/plugin-system";

function makePlugin(id: string, deps: string[] = []): Plugin {
  return {
    meta: { id, name: id, version: "1.0.0", description: "", dependencies: deps, tags: [] },
  };
}

describe("PluginSystem", () => {
  let system: PluginSystem;

  beforeEach(() => {
    system = new PluginSystem();
  });

  describe("register", () => {
    it("should register a plugin", () => {
      system.register(makePlugin("p1"));
      expect(system.getStatus("p1")).toBe("registered");
    });

    it("should throw on duplicate registration", () => {
      system.register(makePlugin("p1"));
      expect(() => system.register(makePlugin("p1"))).toThrow(/already registered/i);
    });
  });

  describe("install", () => {
    it("should run install hook and set status to installed", async () => {
      const log: string[] = [];
      const plugin: Plugin = {
        meta: { id: "p1", name: "p1", version: "1.0.0", description: "", tags: [] },
        install: async () => { log.push("installed"); },
      };
      system.register(plugin);
      await system.install("p1");

      expect(system.getStatus("p1")).toBe("installed");
      expect(log).toContain("installed");
    });

    it("should install dependencies first", async () => {
      const order: string[] = [];
      const dep: Plugin = {
        meta: { id: "dep", name: "dep", version: "1.0.0", description: "", tags: [] },
        install: async () => { order.push("dep"); },
      };
      const main: Plugin = {
        meta: { id: "main", name: "main", version: "1.0.0", description: "", dependencies: ["dep"], tags: [] },
        install: async () => { order.push("main"); },
      };

      system.register(dep);
      system.register(main);
      await system.install("main");

      expect(order.indexOf("dep")).toBeLessThan(order.indexOf("main"));
    });

    it("should throw when dependency is missing", async () => {
      system.register(makePlugin("p1", ["missing-dep"]));
      await expect(system.install("p1")).rejects.toThrow(/missing dependency/i);
    });

    it("should set status to error on install failure", async () => {
      const plugin: Plugin = {
        meta: { id: "bad", name: "bad", version: "1.0.0", description: "", tags: [] },
        install: async () => { throw new Error("install failed"); },
      };
      system.register(plugin);
      await expect(system.install("bad")).rejects.toThrow("install failed");
      expect(system.getStatus("bad")).toBe("error");
    });
  });

  describe("activate / deactivate", () => {
    it("should activate an installed plugin", async () => {
      const log: string[] = [];
      const plugin: Plugin = {
        meta: { id: "p1", name: "p1", version: "1.0.0", description: "", tags: [] },
        activate: async () => { log.push("activated"); },
      };
      system.register(plugin);
      await system.install("p1");
      await system.activate("p1");

      expect(system.getStatus("p1")).toBe("active");
      expect(log).toContain("activated");
    });

    it("should auto-install on activate if only registered", async () => {
      system.register(makePlugin("p1"));
      await system.activate("p1");
      expect(system.getStatus("p1")).toBe("active");
    });

    it("should deactivate an active plugin", async () => {
      const log: string[] = [];
      const plugin: Plugin = {
        meta: { id: "p1", name: "p1", version: "1.0.0", description: "", tags: [] },
        deactivate: async () => { log.push("deactivated"); },
      };
      system.register(plugin);
      await system.activate("p1");
      await system.deactivate("p1");

      expect(system.getStatus("p1")).toBe("inactive");
      expect(log).toContain("deactivated");
    });

    it("should throw when deactivating non-active plugin", async () => {
      system.register(makePlugin("p1"));
      await expect(system.deactivate("p1")).rejects.toThrow(/not active/i);
    });
  });

  describe("uninstall", () => {
    it("should remove plugin from registry", async () => {
      system.register(makePlugin("p1"));
      await system.install("p1");
      await system.uninstall("p1");
      expect(system.getStatus("p1")).toBeNull();
    });

    it("should auto-deactivate before uninstall", async () => {
      const log: string[] = [];
      const plugin: Plugin = {
        meta: { id: "p1", name: "p1", version: "1.0.0", description: "", tags: [] },
        deactivate: async () => { log.push("deactivated"); },
      };
      system.register(plugin);
      await system.activate("p1");
      await system.uninstall("p1");
      expect(log).toContain("deactivated");
    });

    it("should throw when another active plugin depends on it", async () => {
      system.register(makePlugin("dep"));
      system.register(makePlugin("main", ["dep"]));
      await system.activate("dep");
      await system.activate("main");

      await expect(system.uninstall("dep")).rejects.toThrow(/depends on it/i);
    });
  });

  describe("configure", () => {
    it("should update plugin config at runtime", () => {
      system.register(makePlugin("p1"), { timeout: 1000 });
      system.configure("p1", { timeout: 5000, retries: 3 });

      const record = system.getAll().find((r) => r.plugin.meta.id === "p1")!;
      expect(record.config.timeout).toBe(5000);
      expect(record.config.retries).toBe(3);
    });
  });

  describe("emit / on (via context)", () => {
    it("should deliver events between plugins", async () => {
      const received: unknown[] = [];
      const listener: Plugin = {
        meta: { id: "listener", name: "listener", version: "1.0.0", description: "", tags: [] },
        activate: (ctx) => {
          ctx.on("swap.completed", (data) => received.push(data));
        },
      };
      system.register(listener);
      await system.activate("listener");

      system.emit("swap.completed", { txHash: "0xabc" });
      expect(received).toHaveLength(1);
      expect((received[0] as { txHash: string }).txHash).toBe("0xabc");
    });
  });

  describe("getStats", () => {
    it("should count plugins by status", async () => {
      system.register(makePlugin("p1"));
      system.register(makePlugin("p2"));
      system.register(makePlugin("p3"));

      await system.activate("p1");
      await system.install("p2");

      const stats = system.getStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
    });
  });

  describe("getLogs", () => {
    it("should capture plugin logs", async () => {
      const plugin: Plugin = {
        meta: { id: "logger", name: "logger", version: "1.0.0", description: "", tags: [] },
        activate: (ctx) => { ctx.log("info", "plugin started"); },
      };
      system.register(plugin);
      await system.activate("logger");

      const logs = system.getLogs("logger");
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].msg).toBe("plugin started");
    });
  });
});
