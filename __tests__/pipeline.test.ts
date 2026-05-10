import { describe, it, expect, vi } from "vitest";
import { Pipeline, parallel, sequential } from "../lib/agent/pipeline";

describe("Pipeline", () => {
  describe("pipe / run", () => {
    it("should pass value through a single stage", async () => {
      const result = await new Pipeline<number>()
        .pipe((n) => n * 2)
        .run(5);
      expect(result).toBe(10);
    });

    it("should chain multiple stages", async () => {
      const result = await new Pipeline<number>()
        .pipe((n) => n + 1)
        .pipe((n) => n * 3)
        .pipe((n) => n - 2)
        .run(4);
      expect(result).toBe(13); // (4+1)*3-2
    });

    it("should handle async stages", async () => {
      const result = await new Pipeline<string>()
        .pipe(async (s) => { await Promise.resolve(); return s.toUpperCase(); })
        .pipe(async (s) => s + "!")
        .run("hello");
      expect(result).toBe("HELLO!");
    });

    it("should work with no stages", async () => {
      const result = await new Pipeline<number>().run(42);
      expect(result).toBe(42);
    });

    it("should propagate type through stages", async () => {
      const result = await new Pipeline<number>()
        .pipe((n) => String(n))
        .pipe((s) => s.length)
        .run(12345);
      expect(result).toBe(5);
    });
  });

  describe("map", () => {
    it("should transform value", async () => {
      const result = await new Pipeline<number>()
        .map((n) => ({ value: n }))
        .run(7);
      expect(result).toEqual({ value: 7 });
    });

    it("should support async map", async () => {
      const result = await new Pipeline<string>()
        .map(async (s) => s.split(""))
        .run("abc");
      expect(result).toEqual(["a", "b", "c"]);
    });
  });

  describe("tap", () => {
    it("should call side effect without changing value", async () => {
      const seen: number[] = [];
      const result = await new Pipeline<number>()
        .tap((n) => seen.push(n))
        .pipe((n) => n * 2)
        .run(5);
      expect(result).toBe(10);
      expect(seen).toEqual([5]);
    });

    it("should support async tap", async () => {
      const log: string[] = [];
      await new Pipeline<string>()
        .tap(async (s) => { await Promise.resolve(); log.push(s); })
        .run("test");
      expect(log).toEqual(["test"]);
    });
  });

  describe("filter", () => {
    it("should pass value when predicate is true", async () => {
      const result = await new Pipeline<number>()
        .filter((n) => n > 0)
        .run(5);
      expect(result).toBe(5);
    });

    it("should throw when predicate is false and no fallback", async () => {
      await expect(
        new Pipeline<number>().filter((n) => n > 10).run(5)
      ).rejects.toThrow("Pipeline filter rejected value");
    });

    it("should return fallback when predicate is false", async () => {
      const result = await new Pipeline<number>()
        .filter((n) => n > 10, 0)
        .run(5);
      expect(result).toBe(0);
    });
  });

  describe("runSafe", () => {
    it("should return ok:true on success", async () => {
      const result = await new Pipeline<number>()
        .pipe((n) => n * 2)
        .runSafe(5);
      expect(result).toEqual({ ok: true, value: 10 });
    });

    it("should return ok:false with error and stage index on failure", async () => {
      const result = await new Pipeline<number>()
        .pipe((n) => n + 1)
        .pipe(() => { throw new Error("stage 1 failed"); })
        .pipe((n) => n * 2)
        .runSafe(5);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe("stage 1 failed");
        expect(result.stage).toBe(1);
      }
    });

    it("should not execute stages after failure", async () => {
      const stage2 = vi.fn().mockReturnValue(0);
      await new Pipeline<number>()
        .pipe(() => { throw new Error("fail"); })
        .pipe(stage2)
        .runSafe(1);
      expect(stage2).not.toHaveBeenCalled();
    });
  });

  describe("Pipeline.of", () => {
    it("should create a pipeline", () => {
      const p = Pipeline.of(42);
      expect(p).toBeInstanceOf(Pipeline);
    });
  });
});

describe("parallel", () => {
  it("should run all functions with same input", async () => {
    const fn = parallel([
      (n: number) => n * 2,
      (n: number) => n + 10,
      (n: number) => n ** 2,
    ]);
    const result = await fn(5);
    expect(result).toEqual([10, 15, 25]);
  });

  it("should run concurrently", async () => {
    const order: number[] = [];
    const fn = parallel([
      async (n: number) => { await new Promise((r) => setTimeout(r, 20)); order.push(1); return n; },
      async (n: number) => { await new Promise((r) => setTimeout(r, 5)); order.push(2); return n; },
    ]);
    await fn(1);
    expect(order).toEqual([2, 1]); // faster one finishes first
  });
});

describe("sequential", () => {
  it("should apply functions in order", async () => {
    const fn = sequential([
      (n: number) => n + 1,
      (n: number) => n * 2,
      (n: number) => n - 3,
    ]);
    expect(await fn(4)).toBe(7); // (4+1)*2-3
  });

  it("should pass output of each to next", async () => {
    const order: number[] = [];
    const fn = sequential([
      (n: number) => { order.push(n); return n + 1; },
      (n: number) => { order.push(n); return n + 1; },
    ]);
    await fn(0);
    expect(order).toEqual([0, 1]);
  });
});
