import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withTiming,
  withLogging,
  withMemo,
  withRetry,
  withTimeout,
  withValidation,
  withRateLimit,
  withTap,
  withFallback,
  compose,
} from "../lib/agent/decorators";

describe("withTiming", () => {
  it("should return the original result", async () => {
    const fn = async (x: number) => x * 2;
    const timed = withTiming(fn);
    expect(await timed(5)).toBe(10);
  });

  it("should call onResult with name and duration", async () => {
    const timings: Array<{ name: string; ms: number }> = [];
    const fn = async () => "ok";
    const timed = withTiming(fn, (name, ms) => timings.push({ name, ms }), "myFn");
    await timed();
    expect(timings[0].name).toBe("myFn");
    expect(timings[0].ms).toBeGreaterThanOrEqual(0);
  });

  it("should still call onResult even if fn throws", async () => {
    const timings: number[] = [];
    const fn = async () => { throw new Error("fail"); };
    const timed = withTiming(fn, (_, ms) => timings.push(ms), "err");
    await expect(timed()).rejects.toThrow();
    expect(timings).toHaveLength(1);
  });
});

describe("withLogging", () => {
  it("should log call and success", async () => {
    const logs: string[] = [];
    const logger = { log: (msg: string) => logs.push(msg) };
    const fn = async (x: number) => x + 1;
    const logged = withLogging(fn, logger, "add");
    await logged(5);
    expect(logs.some((l) => l.includes("called"))).toBe(true);
    expect(logs.some((l) => l.includes("succeeded"))).toBe(true);
  });

  it("should log failure", async () => {
    const logs: string[] = [];
    const logger = { log: (msg: string) => logs.push(msg) };
    const fn = async () => { throw new Error("boom"); };
    const logged = withLogging(fn, logger, "fail");
    await expect(logged()).rejects.toThrow();
    expect(logs.some((l) => l.includes("failed"))).toBe(true);
  });

  it("should re-throw the original error", async () => {
    const logger = { log: () => {} };
    const fn = async () => { throw new Error("original"); };
    const logged = withLogging(fn, logger);
    await expect(logged()).rejects.toThrow("original");
  });
});

describe("withMemo", () => {
  it("should cache results", async () => {
    let calls = 0;
    const fn = async (x: number) => { calls++; return x * 2; };
    const memoized = withMemo(fn);
    await memoized(5);
    await memoized(5);
    expect(calls).toBe(1);
  });

  it("should compute for different args", async () => {
    let calls = 0;
    const fn = async (x: number) => { calls++; return x * 2; };
    const memoized = withMemo(fn);
    await memoized(5);
    await memoized(10);
    expect(calls).toBe(2);
  });

  it("should clear cache", async () => {
    let calls = 0;
    const fn = async (x: number) => { calls++; return x; };
    const memoized = withMemo(fn);
    await memoized(1);
    memoized.clear();
    await memoized(1);
    expect(calls).toBe(2);
  });

  it("should support custom key function", async () => {
    let calls = 0;
    const fn = async (obj: { id: number }) => { calls++; return obj.id; };
    const memoized = withMemo(fn, (obj) => String(obj.id));
    await memoized({ id: 1 });
    await memoized({ id: 1 }); // same key
    expect(calls).toBe(1);
  });

  it("should expose cache map", async () => {
    const fn = async (x: number) => x;
    const memoized = withMemo(fn);
    await memoized(42);
    expect(memoized.cache.has(JSON.stringify([42]))).toBe(true);
  });
});

describe("withRetry", () => {
  it("should succeed on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const retried = withRetry(fn, 3, 5);
    expect(await retried()).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++calls < 3) throw new Error("not yet");
      return "done";
    });
    const retried = withRetry(fn, 3, 5);
    expect(await retried()).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after max attempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));
    const retried = withRetry(fn, 3, 5);
    await expect(retried()).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("withTimeout", () => {
  it("should return result if within timeout", async () => {
    const fn = async () => "fast";
    const timed = withTimeout(fn, 100);
    expect(await timed()).toBe("fast");
  });

  it("should throw if exceeds timeout", async () => {
    const fn = async () => new Promise((r) => setTimeout(r, 200));
    const timed = withTimeout(fn, 50);
    await expect(timed()).rejects.toThrow(/timed out/i);
  });
});

describe("withValidation", () => {
  it("should pass when validation returns null", async () => {
    const fn = async (x: number) => x * 2;
    const validated = withValidation(fn, (x) => (x > 0 ? null : "must be positive"));
    expect(await validated(5)).toBe(10);
  });

  it("should throw when validation fails", async () => {
    const fn = async (x: number) => x * 2;
    const validated = withValidation(fn, (x) => (x > 0 ? null : "must be positive"));
    await expect(validated(-1)).rejects.toThrow(/must be positive/);
  });

  it("should not call fn when validation fails", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const validated = withValidation(fn as unknown as (...args: unknown[]) => unknown, () => "invalid");
    await expect(validated()).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("withRateLimit", () => {
  it("should allow calls within limit", async () => {
    const fn = async () => "ok";
    const limited = withRateLimit(fn, 10);
    expect(await limited()).toBe("ok");
  });

  it("should reject when rate limit exceeded", async () => {
    const fn = async () => "ok";
    const limited = withRateLimit(fn, 2);
    await limited();
    await limited();
    await expect(limited()).rejects.toThrow(/rate limit/i);
  });
});

describe("withTap", () => {
  it("should call tap with result without changing it", async () => {
    const tapped: number[] = [];
    const fn = async (x: number) => x * 3;
    const tapping = withTap(fn, (result) => tapped.push(result as number));
    const result = await tapping(4);
    expect(result).toBe(12);
    expect(tapped).toEqual([12]);
  });

  it("should pass args to tap", async () => {
    const captured: unknown[][] = [];
    const fn = async (a: number, b: number) => a + b;
    const tapping = withTap(fn, (_, args) => captured.push(args));
    await tapping(3, 4);
    expect(captured[0]).toEqual([3, 4]);
  });
});

describe("withFallback", () => {
  it("should return original result on success", async () => {
    const fn = async () => "primary";
    const withFb = withFallback(fn, () => Promise.resolve("fallback") as ReturnType<typeof fn>);
    expect(await withFb()).toBe("primary");
  });

  it("should return fallback on failure", async () => {
    const fn = async () => { throw new Error("fail"); };
    const withFb = withFallback(fn, () => Promise.resolve("fallback") as ReturnType<typeof fn>);
    expect(await withFb()).toBe("fallback");
  });
});

describe("compose", () => {
  it("should apply decorators in order (right to left)", async () => {
    const log: string[] = [];
    const logger = { log: (msg: string) => log.push(msg) };

    const fn = async (x: number) => x * 2;
    const timings: string[] = [];

    const decorated = compose<typeof fn>(
      (f) => withLogging(f, logger, "outer"),
      (f) => withTiming(f, (name) => timings.push(name), "inner")
    )(fn);

    await decorated(5);
    expect(log.some((l) => l.includes("outer"))).toBe(true);
    expect(timings).toContain("inner");
  });
});
