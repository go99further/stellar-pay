import { describe, it, expect } from "vitest";
import {
  Ok,
  Err,
  Result,
  AgentErrors,
  mapOk,
  mapErr,
  andThen,
  unwrap,
  unwrapOr,
  combine,
  trySync,
  tryAsync,
  handleError,
  isRetryable,
  getRetryDelay,
} from "../lib/agent/types/result";

describe("Result Type", () => {
  describe("Ok and Err constructors", () => {
    it("should create Ok result", () => {
      const result = Ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should create Err result", () => {
      const error = AgentErrors.validation("field", "message");
      const result = Err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
      }
    });
  });

  describe("mapOk", () => {
    it("should map Ok value", () => {
      const result = Ok(10);
      const mapped = mapOk(result, (x: number) => x * 2);
      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.value).toBe(20);
      }
    });

    it("should not map Err value", () => {
      const error = AgentErrors.validation("field", "message");
      const result: Result<number> = Err(error);
      const mapped = mapOk(result, (x: number) => x * 2);
      expect(mapped.ok).toBe(false);
    });
  });

  describe("mapErr", () => {
    it("should map Err value", () => {
      const error = AgentErrors.validation("field", "message");
      const result: Result<number> = Err(error);
      const mapped = mapErr(result, (e) => AgentErrors.system("component", "new message"));
      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error.kind).toBe("system");
      }
    });

    it("should not map Ok value", () => {
      const result = Ok(10);
      const mapped = mapErr(result, (e) => AgentErrors.system("component", "new message"));
      expect(mapped.ok).toBe(true);
    });
  });

  describe("andThen", () => {
    it("should chain Ok results", () => {
      const result = Ok(10);
      const chained = andThen(result, (x: number) => Ok(x * 2));
      expect(chained.ok).toBe(true);
      if (chained.ok) {
        expect(chained.value).toBe(20);
      }
    });

    it("should short-circuit on Err", () => {
      const error = AgentErrors.validation("field", "message");
      const result: Result<number> = Err(error);
      const chained = andThen(result, (x: number) => Ok(x * 2));
      expect(chained.ok).toBe(false);
    });
  });

  describe("unwrap", () => {
    it("should unwrap Ok value", () => {
      const result = Ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it("should throw on Err", () => {
      const error = AgentErrors.validation("field", "message");
      const result: Result<number> = Err(error);
      expect(() => unwrap(result)).toThrow();
    });
  });

  describe("unwrapOr", () => {
    it("should unwrap Ok value", () => {
      const result = Ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it("should return default on Err", () => {
      const error = AgentErrors.validation("field", "message");
      const result: Result<number> = Err(error);
      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe("combine", () => {
    it("should combine all Ok results", () => {
      const results = [Ok(1), Ok(2), Ok(3)];
      const combined = combine(results);
      expect(combined.ok).toBe(true);
      if (combined.ok) {
        expect(combined.value).toEqual([1, 2, 3]);
      }
    });

    it("should return first Err", () => {
      const error = AgentErrors.validation("field", "message");
      const results: Result<number>[] = [Ok(1), Err(error), Ok(3)];
      const combined = combine(results);
      expect(combined.ok).toBe(false);
    });
  });

  describe("trySync", () => {
    it("should wrap successful function", () => {
      const result = trySync(() => 42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should catch and classify errors", () => {
      const result = trySync(() => {
        throw new Error("validation failed");
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
      }
    });
  });

  describe("tryAsync", () => {
    it("should wrap successful async function", async () => {
      const result = await tryAsync(async () => 42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("should catch and classify async errors", async () => {
      const result = await tryAsync(async () => {
        throw new Error("network error");
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("network");
      }
    });
  });

  describe("handleError", () => {
    it("should format validation error", () => {
      const error = AgentErrors.validation("amount", "must be positive", "use value > 0");
      const message = handleError(error);
      expect(message).toContain("amount");
      expect(message).toContain("must be positive");
      expect(message).toContain("use value > 0");
    });

    it("should format network error", () => {
      const error = AgentErrors.network("connection failed", true, 500);
      const message = handleError(error);
      expect(message).toContain("500");
      expect(message).toContain("retryable");
    });

    it("should format all error types", () => {
      const errors = [
        AgentErrors.validation("field", "message"),
        AgentErrors.network("message", true),
        AgentErrors.contract("contract", "method", "message"),
        AgentErrors.user("action", "message"),
        AgentErrors.system("component", "message"),
        AgentErrors.timeout("operation", 5000),
        AgentErrors.rateLimit("service", 1000),
      ];

      errors.forEach((error) => {
        const message = handleError(error);
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(0);
      });
    });
  });

  describe("isRetryable", () => {
    it("should identify retryable errors", () => {
      expect(isRetryable(AgentErrors.network("message", true))).toBe(true);
      expect(isRetryable(AgentErrors.rateLimit("service", 1000))).toBe(true);
      expect(isRetryable(AgentErrors.timeout("operation", 5000))).toBe(true);
    });

    it("should identify non-retryable errors", () => {
      expect(isRetryable(AgentErrors.validation("field", "message"))).toBe(false);
      expect(isRetryable(AgentErrors.user("action", "message"))).toBe(false);
      expect(isRetryable(AgentErrors.contract("contract", "method", "message"))).toBe(false);
    });
  });

  describe("getRetryDelay", () => {
    it("should return correct delay for rate limit", () => {
      const error = AgentErrors.rateLimit("service", 5000);
      expect(getRetryDelay(error)).toBe(5000);
    });

    it("should return correct delay for timeout", () => {
      const error = AgentErrors.timeout("operation", 5000);
      expect(getRetryDelay(error)).toBe(1000);
    });

    it("should return correct delay for network", () => {
      const error = AgentErrors.network("message", true);
      expect(getRetryDelay(error)).toBe(2000);
    });

    it("should return 0 for non-retryable errors", () => {
      const error = AgentErrors.validation("field", "message");
      expect(getRetryDelay(error)).toBe(0);
    });
  });
});

describe("handleError — individual error types", () => {
  it("should format contract error with contractId and method", () => {
    const msg = handleError(AgentErrors.contract("CXXX", "swap", "insufficient balance"));
    expect(msg).toContain("CXXX");
    expect(msg).toContain("swap");
    expect(msg).toContain("insufficient balance");
  });

  it("should include panicCode when present", () => {
    const msg = handleError(AgentErrors.contract("CXXX", "swap", "panic", "P001"));
    expect(msg).toContain("P001");
  });

  it("should format user error with action", () => {
    const msg = handleError(AgentErrors.user("submit_swap", "wallet not connected"));
    expect(msg).toContain("submit_swap");
    expect(msg).toContain("wallet not connected");
  });

  it("should format system error with component", () => {
    const msg = handleError(AgentErrors.system("router", "unexpected state"));
    expect(msg).toContain("router");
    expect(msg).toContain("unexpected state");
  });

  it("should mark fatal system errors", () => {
    const msg = handleError(AgentErrors.system("core", "crash", true));
    expect(msg).toContain("FATAL");
  });

  it("should format timeout error with operation and ms", () => {
    const msg = handleError(AgentErrors.timeout("fetchPrice", 3000));
    expect(msg).toContain("fetchPrice");
    expect(msg).toContain("3000");
  });

  it("should format rate limit error with service and retryAfter", () => {
    const msg = handleError(AgentErrors.rateLimit("horizon", 2000));
    expect(msg).toContain("horizon");
    expect(msg).toContain("2000");
  });
});
