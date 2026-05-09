/**
 * Tests for error handler utility
 */

import { describe, it, expect } from "vitest";
import {
  handleAgentError,
  withErrorRecovery,
  isTransientError,
  formatErrorForDisplay,
} from "@/lib/agent/error-handler";
import {
  WalletNotFoundError,
  TransactionRejectedError,
  InsufficientBalanceError,
  SlippageError,
} from "@/lib/errors";

describe("handleAgentError", () => {
  it("should handle insufficient XLM errors", () => {
    const error = new Error("insufficient XLM for transaction fees");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("XLM for transaction fees");
    expect(recovery.suggestion).toContain("Friendbot");
    expect(recovery.retryable).toBe(false);
    expect(recovery.actionUrl).toBeDefined();
  });

  it("should handle insufficient token balance errors", () => {
    const error = new InsufficientBalanceError();
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("don't have enough");
    expect(recovery.retryable).toBe(false);
  });

  it("should handle slippage errors", () => {
    const error = new SlippageError();
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("slippage tolerance");
    expect(recovery.suggestion).toContain("increasing slippage");
    expect(recovery.retryable).toBe(true);
  });

  it("should handle wallet not found errors", () => {
    const error = new WalletNotFoundError("Freighter");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("Freighter");
    expect(recovery.suggestion).toContain("install");
    expect(recovery.retryable).toBe(false);
    expect(recovery.actionUrl).toBeDefined();
  });

  it("should handle transaction rejected errors", () => {
    const error = new TransactionRejectedError();
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("cancelled");
    expect(recovery.suggestion).toContain("No funds were moved");
    expect(recovery.retryable).toBe(true);
  });

  it("should handle network timeout errors", () => {
    const error = new Error("network timeout");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("timeout");
    expect(recovery.retryable).toBe(true);
  });

  it("should handle RPC node errors", () => {
    const error = new Error("RPC node error 503");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("RPC");
    expect(recovery.retryable).toBe(true);
  });

  it("should handle contract errors", () => {
    const error = new Error("amount_in must be positive");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("greater than 0");
    expect(recovery.retryable).toBe(false);
  });

  it("should handle unknown errors", () => {
    const error = new Error("some random error");
    const recovery = handleAgentError(error);

    expect(recovery.userMessage).toContain("unexpected error");
    expect(recovery.retryable).toBe(false);
  });
});

describe("withErrorRecovery", () => {
  it("should succeed on first attempt", async () => {
    const fn = async () => "success";
    const result = await withErrorRecovery(fn);
    expect(result).toBe("success");
  });

  it("should retry on retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error("network timeout");
      }
      return "success";
    };

    const result = await withErrorRecovery(fn, { maxAttempts: 3, initialDelay: 10 });
    expect(result).toBe("success");
    expect(attempts).toBe(2);
  });

  it("should not retry on non-retryable errors", async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new InsufficientBalanceError();
    };

    await expect(
      withErrorRecovery(fn, { maxAttempts: 3, initialDelay: 10 })
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("should call onRetry callback", async () => {
    let retryCount = 0;
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("timeout");
      }
      return "success";
    };

    await withErrorRecovery(fn, {
      maxAttempts: 3,
      initialDelay: 10,
      onRetry: () => {
        retryCount++;
      },
    });

    expect(retryCount).toBe(2);
  });
});

describe("isTransientError", () => {
  it("should identify network timeouts as transient", () => {
    const error = new Error("network timeout");
    expect(isTransientError(error)).toBe(true);
  });

  it("should identify RPC errors as transient", () => {
    const error = new Error("RPC node error 503");
    expect(isTransientError(error)).toBe(true);
  });

  it("should not identify balance errors as transient", () => {
    const error = new InsufficientBalanceError();
    expect(isTransientError(error)).toBe(false);
  });
});

describe("formatErrorForDisplay", () => {
  it("should format error with action", () => {
    const error = new WalletNotFoundError("Freighter");
    const recovery = handleAgentError(error);
    const display = formatErrorForDisplay(recovery);

    expect(display.title).toBeDefined();
    expect(display.message).toBeDefined();
    expect(display.suggestion).toBeDefined();
    expect(display.action).toBeDefined();
    expect(display.action?.label).toContain("Freighter");
  });

  it("should format error without action", () => {
    const error = new SlippageError();
    const recovery = handleAgentError(error);
    const display = formatErrorForDisplay(recovery);

    expect(display.title).toBeDefined();
    expect(display.message).toBeDefined();
    expect(display.suggestion).toBeDefined();
    expect(display.action).toBeUndefined();
  });
});
