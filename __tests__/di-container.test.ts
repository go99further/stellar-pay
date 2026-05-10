import { describe, it, expect, beforeEach } from "vitest";
import { Container } from "../lib/agent/di-container";

describe("Container (DI)", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("singleton", () => {
    it("should return the same instance on multiple resolves", () => {
      container.singleton("counter", () => ({ count: 0 }));
      const a = container.resolve<{ count: number }>("counter");
      const b = container.resolve<{ count: number }>("counter");
      expect(a).toBe(b);
    });

    it("should only call factory once", () => {
      let calls = 0;
      container.singleton("svc", () => { calls++; return {}; });
      container.resolve("svc");
      container.resolve("svc");
      expect(calls).toBe(1);
    });
  });

  describe("transient", () => {
    it("should return a new instance each time", () => {
      container.transient("obj", () => ({ id: Math.random() }));
      const a = container.resolve<{ id: number }>("obj");
      const b = container.resolve<{ id: number }>("obj");
      expect(a).not.toBe(b);
    });

    it("should call factory on every resolve", () => {
      let calls = 0;
      container.transient("svc", () => { calls++; return {}; });
      container.resolve("svc");
      container.resolve("svc");
      expect(calls).toBe(2);
    });
  });

  describe("value", () => {
    it("should register and resolve a constant value", () => {
      container.value("config", { host: "localhost", port: 8080 });
      const cfg = container.resolve<{ host: string; port: number }>("config");
      expect(cfg.host).toBe("localhost");
      expect(cfg.port).toBe(8080);
    });
  });

  describe("dependency injection", () => {
    it("should inject dependencies via factory", () => {
      container.value("dbUrl", "postgres://localhost/test");
      container.singleton("db", (c) => ({ url: c.resolve<string>("dbUrl") }));
      container.singleton("repo", (c) => ({ db: c.resolve<{ url: string }>("db") }));

      const repo = container.resolve<{ db: { url: string } }>("repo");
      expect(repo.db.url).toBe("postgres://localhost/test");
    });

    it("should detect circular dependencies", () => {
      container.singleton("a", (c) => c.resolve("b"));
      container.singleton("b", (c) => c.resolve("a"));

      expect(() => container.resolve("a")).toThrow(/circular dependency/i);
    });
  });

  describe("has", () => {
    it("should return true for registered token", () => {
      container.value("x", 42);
      expect(container.has("x")).toBe(true);
    });

    it("should return false for unregistered token", () => {
      expect(container.has("missing")).toBe(false);
    });
  });

  describe("resolve errors", () => {
    it("should throw for unregistered service", () => {
      expect(() => container.resolve("unknown")).toThrow(/not registered/i);
    });
  });

  describe("scoped lifetime", () => {
    it("should return same instance within a scope", () => {
      container.scoped("req", () => ({ id: Math.random() }));
      const a = container.resolve<{ id: number }>("req");
      const b = container.resolve<{ id: number }>("req");
      expect(a).toBe(b);
    });

    it("should return different instances across scopes", () => {
      container.scoped("req", () => ({ id: Math.random() }));
      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const a = scope1.resolve<{ id: number }>("req");
      const b = scope2.resolve<{ id: number }>("req");
      expect(a).not.toBe(b);
    });

    it("should share singletons across scopes", () => {
      container.singleton("shared", () => ({ value: "shared" }));
      const scope = container.createScope();

      const fromParent = container.resolve<{ value: string }>("shared");
      const fromScope = scope.resolve<{ value: string }>("shared");
      expect(fromParent).toBe(fromScope);
    });
  });

  describe("dispose", () => {
    it("should call dispose on singleton instances", async () => {
      const disposed: string[] = [];
      container.singleton("svc", () => ({
        name: "svc",
        dispose: async () => { disposed.push("svc"); },
      }));

      container.resolve("svc"); // instantiate
      await container.dispose();

      expect(disposed).toContain("svc");
    });

    it("should clear singleton cache after dispose", async () => {
      let calls = 0;
      container.singleton("svc", () => { calls++; return {}; });
      container.resolve("svc");
      await container.dispose();
      container.resolve("svc"); // should create new instance
      expect(calls).toBe(2);
    });
  });

  describe("getStats", () => {
    it("should track registrations and resolutions", () => {
      container.singleton("a", () => ({}));
      container.transient("b", () => ({}));
      container.resolve("a");
      container.resolve("b");
      container.resolve("b");

      const stats = container.getStats();
      expect(stats.registered).toBe(2);
      expect(stats.resolutions).toBe(3);
    });
  });

  describe("endScope", () => {
    it("should clear scoped cache after endScope", () => {
      container.scoped("req", () => ({ id: Math.random() }));
      const scope = container.createScope();
      const a = scope.resolve<{ id: number }>("req");
      scope.endScope();
      const b = scope.resolve<{ id: number }>("req");
      expect(a).not.toBe(b);
    });
  });

  describe("value registration — additional", () => {
    it("should resolve the exact value registered", () => {
      const obj = { x: 42 };
      container.value("cfg", obj);
      expect(container.resolve("cfg")).toBe(obj);
    });

    it("should always return the same value on repeated resolves", () => {
      container.value("num", 99);
      expect(container.resolve("num")).toBe(99);
      expect(container.resolve("num")).toBe(99);
    });
  });
});
