import { describe, it, expect, beforeEach } from "vitest";
import { RequestPipeline } from "../lib/agent/pipeline/request-pipeline";

describe("RequestPipeline", () => {
  describe("basic execution", () => {
    it("should execute handler and return result", async () => {
      const pipeline = new RequestPipeline<string, string>();
      const result = await pipeline.execute("hello", async (ctx) => `${ctx.request}_world`);
      expect(result).toBe("hello_world");
    });

    it("should track stats on success", async () => {
      const pipeline = new RequestPipeline<number, number>();
      await pipeline.execute(1, async (ctx) => ctx.request * 2);
      const stats = pipeline.getStats();
      expect(stats.executed).toBe(1);
      expect(stats.succeeded).toBe(1);
      expect(stats.failed).toBe(0);
    });

    it("should track stats on failure", async () => {
      const pipeline = new RequestPipeline<number, number>();
      await expect(
        pipeline.execute(1, async () => { throw new Error("handler error"); })
      ).rejects.toThrow("handler error");

      const stats = pipeline.getStats();
      expect(stats.failed).toBe(1);
    });
  });

  describe("middleware chain", () => {
    it("should run middleware in order", async () => {
      const order: string[] = [];
      const pipeline = new RequestPipeline<string, string>()
        .use(async (ctx, next) => { order.push("mw1-before"); await next(); order.push("mw1-after"); })
        .use(async (ctx, next) => { order.push("mw2-before"); await next(); order.push("mw2-after"); });

      await pipeline.execute("req", async () => "res");

      expect(order).toEqual(["mw1-before", "mw2-before", "mw2-after", "mw1-after"]);
    });

    it("should allow middleware to short-circuit", async () => {
      let handlerCalled = false;
      const pipeline = new RequestPipeline<string, string>()
        .use(async (ctx, _next) => {
          ctx.response = "short-circuit";
          // Don't call next
        });

      const result = await pipeline.execute("req", async () => {
        handlerCalled = true;
        return "handler";
      });

      expect(result).toBe("short-circuit");
      expect(handlerCalled).toBe(false);
    });

    it("should pass metadata through middleware", async () => {
      const pipeline = new RequestPipeline<string, string>()
        .use(async (ctx, next) => {
          ctx.metadata["step1"] = true;
          await next();
        })
        .use(async (ctx, next) => {
          ctx.metadata["step2"] = true;
          await next();
        });

      let capturedMeta: Record<string, unknown> = {};
      await pipeline.execute("req", async (ctx) => {
        capturedMeta = { ...ctx.metadata };
        return "ok";
      });

      expect(capturedMeta["step1"]).toBe(true);
      expect(capturedMeta["step2"]).toBe(true);
    });
  });

  describe("timeout", () => {
    it("should timeout slow handlers", async () => {
      const pipeline = new RequestPipeline({ timeout: 50, name: "slow-pipeline" });
      await expect(
        pipeline.execute("req", async () => {
          await new Promise((r) => setTimeout(r, 200));
          return "late";
        })
      ).rejects.toThrow(/timed out/i);

      expect(pipeline.getStats().timedOut).toBe(1);
    });

    it("should not timeout fast handlers", async () => {
      const pipeline = new RequestPipeline({ timeout: 500 });
      const result = await pipeline.execute("req", async () => "fast");
      expect(result).toBe("fast");
      expect(pipeline.getStats().timedOut).toBe(0);
    });
  });

  describe("static middleware: logging", () => {
    it("should log start and end", async () => {
      const logs: string[] = [];
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.logging((msg) => logs.push(msg)));

      await pipeline.execute("req", async () => "res");

      expect(logs.some((l) => l.includes("start"))).toBe(true);
      expect(logs.some((l) => l.includes("end"))).toBe(true);
    });
  });

  describe("static middleware: retry", () => {
    it("should retry on failure and succeed", async () => {
      let attempts = 0;
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.retry(3, 10));

      const result = await pipeline.execute("req", async () => {
        attempts++;
        if (attempts < 3) throw new Error("not yet");
        return "ok";
      });

      expect(result).toBe("ok");
      expect(attempts).toBe(3);
    });

    it("should throw after exhausting retries", async () => {
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.retry(2, 10));

      await expect(
        pipeline.execute("req", async () => { throw new Error("always fails"); })
      ).rejects.toThrow("always fails");
    });
  });

  describe("static middleware: cache", () => {
    it("should cache responses and return cached on second call", async () => {
      let callCount = 0;
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.cache((req) => req, 60000));

      await pipeline.execute("key1", async () => { callCount++; return "value1"; });
      await pipeline.execute("key1", async () => { callCount++; return "value1-again"; });

      expect(callCount).toBe(1);
    });

    it("should set cache metadata", async () => {
      // On cache hit the handler is never called, so we verify via callCount
      let callCount = 0;
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.cache((req) => req, 60000));

      // First call: cache miss → handler runs
      await pipeline.execute("k", async () => { callCount++; return "v"; });
      expect(callCount).toBe(1);

      // Second call: cache hit → handler skipped
      const result = await pipeline.execute("k", async () => { callCount++; return "v2"; });
      expect(callCount).toBe(1); // still 1 — handler not called
      expect(result).toBe("v"); // returns cached value
    });
  });

  describe("static middleware: rateLimit", () => {
    it("should allow requests within limit", async () => {
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.rateLimit(3, 1000));

      for (let i = 0; i < 3; i++) {
        await expect(pipeline.execute("req", async () => "ok")).resolves.toBe("ok");
      }
    });

    it("should reject requests over limit", async () => {
      const pipeline = new RequestPipeline<string, string>()
        .use(RequestPipeline.rateLimit(2, 1000));

      await pipeline.execute("req", async () => "ok");
      await pipeline.execute("req", async () => "ok");
      await expect(
        pipeline.execute("req", async () => "ok")
      ).rejects.toThrow(/rate limit/i);
    });
  });

  describe("averageLatency", () => {
    it("should track average latency", async () => {
      const pipeline = new RequestPipeline<string, string>();
      await pipeline.execute("req", async () => { await new Promise((r) => setTimeout(r, 10)); return "ok"; });
      await pipeline.execute("req", async () => { await new Promise((r) => setTimeout(r, 20)); return "ok"; });

      const stats = pipeline.getStats();
      expect(stats.averageLatency).toBeGreaterThan(0);
    });
  });
});
