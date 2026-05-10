import { describe, it, expect, vi, beforeEach } from "vitest";
import { retry, RetryPolicy, createRetryPolicy } from "../lib/agent/retry-policy";

describe("retry()", () => {
  describe("success on first attempt", () => {
    it("should return value on immediate success", async () => {
      const fn = vi.fn().mockResolvedValue("ok");
      const result = await retry(fn, { maxAttempts: 3, delay: 10, strategy: "fixed" });
      expect(result.success).toBe(true);
      expect(result.value).toBe("ok");
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry on failure", () => {
    it("should retry up to maxAttempts", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      const result = await retry(fn, { maxAttempts: 3, delay: 5, strategy: "fixed" });
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should succeed on second attempt", async () => {
      let calls = 0;
      const fn = vi.fn().mockImplementation(async () => {
        if (++calls < 2) throw new Error("not yet");
        return "success";
      });
      const result = await retry(fn, { maxAttempts: 3, delay: 5, strategy: "fixed" });
      expect(result.success).toBe(true);
      expect(result.value).toBe("success");
      expect(result.attempts).toBe(2);
    });

    it("should record lastError on failure", async () => {
      const err = new Error("boom");
      const fn = vi.fn().mockRejectedValue(err);
      const result = await retry(fn, { maxAttempts: 2, delay: 5, strategy: "fixed" });
      expect(result.lastError).toBe(err);
    });

    it("should track totalTime", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      const result = await retry(fn, { maxAttempts: 2, delay: 10, strategy: "fixed" });
      expect(result.totalTime).toBeGreaterThanOrEqual(10);
    });
  });

  describe("backoff strategies", () => {
    it("should use fixed delay", async () => {
      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 3,
        delay: 10,
        strategy: "fixed",
        onRetry: (_, __, d) => delays.push(d),
      });
      expect(delays).toEqual([10, 10]);
    });

    it("should use linear backoff", async () => {
      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 4,
        delay: 10,
        strategy: "linear",
        onRetry: (_, attempt, d) => delays.push(d),
      });
      // attempt 1 → delay=10*1=10, attempt 2 → 20, attempt 3 → 30
      expect(delays[0]).toBe(10);
      expect(delays[1]).toBe(20);
      expect(delays[2]).toBe(30);
    });

    it("should use exponential backoff", async () => {
      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 4,
        delay: 10,
        strategy: "exponential",
        onRetry: (_, __, d) => delays.push(d),
      });
      // attempt 1 → 10*2^0=10, attempt 2 → 10*2^1=20, attempt 3 → 10*2^2=40
      expect(delays[0]).toBe(10);
      expect(delays[1]).toBe(20);
      expect(delays[2]).toBe(40);
    });

    it("should cap delay at maxDelay", async () => {
      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 5,
        delay: 10,
        strategy: "exponential",
        maxDelay: 25,
        onRetry: (_, __, d) => delays.push(d),
      });
      expect(Math.max(...delays)).toBeLessThanOrEqual(25);
    });

    it("should use exponential-jitter (within range)", async () => {
      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 3,
        delay: 10,
        strategy: "exponential-jitter",
        onRetry: (_, __, d) => delays.push(d),
      });
      // jitter: 50-100% of exponential value
      expect(delays[0]).toBeGreaterThanOrEqual(5);
      expect(delays[0]).toBeLessThanOrEqual(10);
    });
  });

  describe("shouldRetry predicate", () => {
    it("should stop retrying when shouldRetry returns false", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("permanent"));
      const result = await retry(fn, {
        maxAttempts: 5,
        delay: 5,
        strategy: "fixed",
        shouldRetry: (err) => (err as Error).message !== "permanent",
      });
      expect(result.success).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1); // no retries
    });

    it("should retry when shouldRetry returns true", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("transient"));
      await retry(fn, {
        maxAttempts: 3,
        delay: 5,
        strategy: "fixed",
        shouldRetry: () => true,
      });
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("onRetry callback", () => {
    it("should call onRetry with error, attempt, and delay", async () => {
      const retries: Array<{ attempt: number; delay: number }> = [];
      const fn = vi.fn().mockRejectedValue(new Error("fail"));
      await retry(fn, {
        maxAttempts: 3,
        delay: 5,
        strategy: "fixed",
        onRetry: (_, attempt, delay) => retries.push({ attempt, delay }),
      });
      expect(retries).toHaveLength(2);
      expect(retries[0]).toEqual({ attempt: 1, delay: 5 });
      expect(retries[1]).toEqual({ attempt: 2, delay: 5 });
    });
  });

  describe("timeout", () => {
    it("should timeout slow attempts", async () => {
      const fn = vi.fn().mockImplementation(
        () => new Promise((r) => setTimeout(r, 200))
      );
      const result = await retry(fn, {
        maxAttempts: 2,
        delay: 5,
        strategy: "fixed",
        timeout: 50,
      });
      expect(result.success).toBe(false);
      expect((result.lastError as Error).message).toMatch(/timed out/i);
    });
  });
});

describe("RetryPolicy", () => {
  it("should execute with configured options", async () => {
    const policy = createRetryPolicy({ maxAttempts: 2, delay: 5, strategy: "fixed" });
    const fn = vi.fn().mockResolvedValue(42);
    const result = await policy.execute(fn);
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it("should be immutable — withMaxAttempts returns new policy", async () => {
    const base = createRetryPolicy({ maxAttempts: 3, delay: 5, strategy: "fixed" });
    const derived = base.withMaxAttempts(1);
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    const result = await derived.execute(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    // base still has 3 attempts
    const result2 = await base.execute(fn);
    expect(fn).toHaveBeenCalledTimes(4); // 1 + 3
  });

  it("should chain builder methods", async () => {
    const retries: number[] = [];
    const policy = createRetryPolicy<string>()
      .withMaxAttempts(3)
      .withDelay(5)
      .withStrategy("fixed")
      .withOnRetry((_, attempt) => retries.push(attempt));

    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await policy.execute(fn);
    expect(retries).toEqual([1, 2]);
  });

  it("should support shouldRetry via builder", async () => {
    const policy = createRetryPolicy<string>()
      .withMaxAttempts(5)
      .withDelay(5)
      .withShouldRetry((err) => (err as Error).message === "retry-me");

    const fn = vi.fn().mockRejectedValue(new Error("stop"));
    const result = await policy.execute(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });
});
