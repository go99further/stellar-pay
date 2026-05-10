import { describe, it, expect, vi } from "vitest";
import {
  withRequestContext,
  getRequestContext,
  log,
  createAgentLogger,
  generateRequestId,
  measureTime,
  logError,
} from "../lib/agent/logger";

describe("logger", () => {
  describe("withRequestContext / getRequestContext", () => {
    it("should provide context within the callback", async () => {
      let ctx: ReturnType<typeof getRequestContext>;
      await withRequestContext({ requestId: "req-1", userId: "user-1" }, async () => {
        ctx = getRequestContext();
      });
      expect(ctx!.requestId).toBe("req-1");
      expect(ctx!.userId).toBe("user-1");
    });

    it("should return undefined outside context", () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it("should propagate context to nested async calls", async () => {
      let inner: ReturnType<typeof getRequestContext>;
      await withRequestContext({ requestId: "req-nested" }, async () => {
        await Promise.resolve();
        inner = getRequestContext();
      });
      expect(inner!.requestId).toBe("req-nested");
    });

    it("should return the function result", async () => {
      const result = await withRequestContext({ requestId: "r" }, async () => 42);
      expect(result).toBe(42);
    });

    it("should support agentName in context", async () => {
      let ctx: ReturnType<typeof getRequestContext>;
      await withRequestContext({ requestId: "r", agentName: "trading" }, async () => {
        ctx = getRequestContext();
      });
      expect(ctx!.agentName).toBe("trading");
    });
  });

  describe("log", () => {
    it("should call console.info for info level", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      log("info", "test message");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("should call console.debug for debug level", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      log("debug", "debug msg");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("should call console.warn for warn level", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      log("warn", "warn msg");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("should call console.error for error level", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      log("error", "error msg");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("should output valid JSON", () => {
      let output = "";
      const spy = vi.spyOn(console, "info").mockImplementation((s) => { output = s; });
      log("info", "hello", { foo: "bar" });
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.message).toBe("hello");
      expect(parsed.level).toBe("info");
      expect(parsed.foo).toBe("bar");
      expect(parsed.timestamp).toBeDefined();
    });

    it("should include context fields when inside withRequestContext", async () => {
      let output = "";
      const spy = vi.spyOn(console, "info").mockImplementation((s) => { output = s; });
      await withRequestContext({ requestId: "req-ctx", userId: "u1" }, async () => {
        log("info", "in context");
      });
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.requestId).toBe("req-ctx");
      expect(parsed.userId).toBe("u1");
    });
  });

  describe("createAgentLogger", () => {
    it("should create a logger with all four methods", () => {
      const logger = createAgentLogger("trading");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });

    it("should include agentName in log output", () => {
      let output = "";
      const spy = vi.spyOn(console, "info").mockImplementation((s) => { output = s; });
      const logger = createAgentLogger("analytics");
      logger.info("pool stats fetched");
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.agentName).toBe("analytics");
    });

    it("should pass metadata through", () => {
      let output = "";
      const spy = vi.spyOn(console, "warn").mockImplementation((s) => { output = s; });
      const logger = createAgentLogger("security");
      logger.warn("anomaly detected", { score: 0.9 });
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.score).toBe(0.9);
    });
  });

  describe("generateRequestId", () => {
    it("should return a string starting with req_", () => {
      const id = generateRequestId();
      expect(id.startsWith("req_")).toBe(true);
    });

    it("should generate unique IDs", () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateRequestId()));
      expect(ids.size).toBe(10);
    });
  });

  describe("measureTime", () => {
    it("should return the function result", async () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const result = await measureTime("test op", async () => 99);
      spy.mockRestore();
      expect(result).toBe(99);
    });

    it("should log completion with durationMs", async () => {
      let output = "";
      const spy = vi.spyOn(console, "info").mockImplementation((s) => { output = s; });
      await measureTime("my op", async () => "done");
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.message).toContain("my op");
      expect(typeof parsed.durationMs).toBe("number");
    });

    it("should rethrow errors and log failure", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(
        measureTime("failing op", async () => { throw new Error("boom"); })
      ).rejects.toThrow("boom");
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });
  });

  describe("logError", () => {
    it("should log at error level", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      logError("something failed", new Error("oops"));
      expect(spy).toHaveBeenCalledOnce();
      spy.mockRestore();
    });

    it("should include error name and message in output", () => {
      let output = "";
      const spy = vi.spyOn(console, "error").mockImplementation((s) => { output = s; });
      logError("test error", new Error("test message"));
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.errorMessage).toBe("test message");
      expect(parsed.errorName).toBe("Error");
    });

    it("should handle non-Error objects", () => {
      let output = "";
      const spy = vi.spyOn(console, "error").mockImplementation((s) => { output = s; });
      logError("test", "string error");
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.error).toBe("string error");
    });

    it("should include metadata", () => {
      let output = "";
      const spy = vi.spyOn(console, "error").mockImplementation((s) => { output = s; });
      logError("test", new Error("e"), { userId: "u1" });
      spy.mockRestore();
      const parsed = JSON.parse(output);
      expect(parsed.userId).toBe("u1");
    });
  });
});
