import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "@/lib/agent/tools/utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("withRetry", () => {
  it("succeeds on first try without retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxAttempts then throws last error", async () => {
    vi.useFakeTimers();
    const err = new Error("fetch failed");
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));

    // Attach rejection handler BEFORE advancing timers to avoid unhandled-rejection window
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();

    const result = await caught;
    expect(result).toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects shouldRetry predicate — non-retryable errors throw immediately", async () => {
    vi.useFakeTimers();
    const retryableErr = new Error("fetch failed");
    const fatalErr = new Error("contract error: invalid argument");
    let call = 0;
    const fn = vi.fn().mockImplementation(() => {
      call++;
      return Promise.reject(call === 1 ? retryableErr : fatalErr);
    });

    const shouldRetry = (e: unknown) =>
      e instanceof Error && /fetch failed/i.test(e.message);

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, shouldRetry });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();

    const result = await caught;
    expect(result).toBe(fatalErr);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("linear backoff increases delay each attempt", async () => {
    vi.useFakeTimers();
    const err = new Error("timeout");
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, backoff: "linear" });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    await caught;

    // Delays should be 100ms (attempt 1) and 200ms (attempt 2)
    const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
    expect(delays).toContain(100);
    expect(delays).toContain(200);
  });

  it("calls onRetry hook with attempt number and error", async () => {
    vi.useFakeTimers();
    const err = new Error("503 Service Unavailable");
    const fn = vi.fn().mockImplementation(() => Promise.reject(err));
    const onRetry = vi.fn();

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10, onRetry });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    await caught;

    // onRetry is called before each retry (not on the final failure)
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, err);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, err);
  });

  it("succeeds after transient failures", async () => {
    vi.useFakeTimers();
    let call = 0;
    const transient = new Error("ETIMEDOUT");
    const fn = vi.fn().mockImplementation(() => {
      call++;
      if (call < 3) return Promise.reject(transient);
      return Promise.resolve("recovered");
    });

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    // Attach a no-op catch so intermediate rejections are never unhandled
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("default shouldRetry matches network/timeout/5xx patterns", async () => {
    const patterns = [
      "timeout",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "fetch failed",
      "503 error",
      "502 bad gateway",
      "504 gateway timeout",
      "network error",
    ];

    for (const msg of patterns) {
      vi.useFakeTimers();
      const fn = vi.fn().mockImplementation(() => Promise.reject(new Error(msg)));
      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 });
      const caught = promise.catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const result = await caught;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe(msg);
      // Should have retried (called twice), not bailed on first attempt
      expect(fn).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    }
  });
});
