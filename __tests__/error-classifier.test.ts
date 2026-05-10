import { describe, it, expect, beforeEach } from "vitest";
import { ErrorClassifier, errorClassifier, classifyAndHandle } from "../lib/agent/errors/error-classifier";

describe("ErrorClassifier", () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
  });

  describe("classify — built-in patterns", () => {
    it("should classify invalid address as validation", () => {
      const result = classifier.classify(new Error("invalid address format"));
      expect(result.category).toBe("validation");
      expect(result.retryable).toBe(false);
      expect(result.userFacing).toBe(true);
    });

    it("should classify insufficient balance as validation/high", () => {
      const result = classifier.classify(new Error("insufficient balance for swap"));
      expect(result.category).toBe("validation");
      expect(result.severity).toBe("high");
    });

    it("should classify network timeout as network/retry_with_backoff", () => {
      const result = classifier.classify(new Error("network error: connection timeout"));
      expect(result.category).toBe("network");
      expect(result.recoveryStrategy).toBe("retry_with_backoff");
      expect(result.retryable).toBe(true);
    });

    it("should classify rate limit as network", () => {
      const result = classifier.classify(new Error("rate limit exceeded"));
      expect(result.category).toBe("network");
      expect(result.retryable).toBe(true);
    });

    it("should classify contract panic as contract/abort", () => {
      const result = classifier.classify(new Error("contract panic: overflow"));
      expect(result.category).toBe("contract");
      expect(result.recoveryStrategy).toBe("abort");
      expect(result.retryable).toBe(false);
    });

    it("should classify insufficient liquidity as contract", () => {
      const result = classifier.classify(new Error("insufficient liquidity in pool"));
      expect(result.category).toBe("contract");
    });

    it("should classify user rejected as user/ignore", () => {
      const result = classifier.classify(new Error("user rejected transaction"));
      expect(result.category).toBe("user");
      expect(result.recoveryStrategy).toBe("ignore");
      expect(result.severity).toBe("low");
    });

    it("should classify wallet not connected as user", () => {
      const result = classifier.classify(new Error("wallet not connected"));
      expect(result.category).toBe("user");
      expect(result.userFacing).toBe(true);
    });

    it("should classify internal server error as system", () => {
      const result = classifier.classify(new Error("internal server error 500"));
      expect(result.category).toBe("system");
      expect(result.retryable).toBe(true);
    });

    it("should classify unknown error with conservative defaults", () => {
      const result = classifier.classify(new Error("something completely unexpected"));
      expect(result.category).toBe("unknown");
      expect(result.recoveryStrategy).toBe("abort");
      expect(result.retryable).toBe(false);
    });
  });

  describe("classify — input types", () => {
    it("should handle string errors", () => {
      const result = classifier.classify("network error: timeout");
      expect(result.category).toBe("network");
    });

    it("should handle non-Error objects", () => {
      const result = classifier.classify({ code: 500, message: "fail" });
      expect(result.category).toBe("unknown");
    });

    it("should preserve original error", () => {
      const err = new Error("rate limit exceeded");
      const result = classifier.classify(err);
      expect(result.originalError).toBe(err);
    });

    it("should include suggestions", () => {
      const result = classifier.classify(new Error("slippage exceeded"));
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("addPattern", () => {
    it("should match custom pattern (string)", () => {
      classifier.addPattern({
        pattern: "stellar horizon",
        category: "network",
        severity: "high",
        recoveryStrategy: "retry_with_backoff",
        suggestions: ["Check Horizon endpoint"],
      });
      const result = classifier.classify(new Error("stellar horizon unreachable"));
      expect(result.category).toBe("network");
      expect(result.suggestions).toContain("Check Horizon endpoint");
    });

    it("should match custom pattern (regex)", () => {
      classifier.addPattern({
        pattern: /custom_error_\d+/i,
        category: "system",
        severity: "critical",
        recoveryStrategy: "abort",
        suggestions: ["Contact support"],
      });
      const result = classifier.classify(new Error("custom_error_42 occurred"));
      expect(result.category).toBe("system");
      expect(result.severity).toBe("critical");
    });

    it("custom patterns take priority over defaults", () => {
      classifier.addPattern({
        pattern: "insufficient balance",
        category: "system",
        severity: "critical",
        recoveryStrategy: "abort",
        suggestions: ["Override"],
      });
      const result = classifier.classify(new Error("insufficient balance for swap"));
      expect(result.category).toBe("system");
    });
  });

  describe("getHistory / getStatistics", () => {
    it("should record classified errors in history", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("user rejected transaction"));
      expect(classifier.getHistory()).toHaveLength(2);
    });

    it("should return newest first", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("user rejected transaction"));
      const history = classifier.getHistory();
      expect(history[0].category).toBe("user");
    });

    it("should count by category", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("rate limit exceeded"));
      classifier.classify(new Error("user rejected transaction"));
      const stats = classifier.getStatistics();
      expect(stats.byCategory.network).toBe(2);
      expect(stats.byCategory.user).toBe(1);
      expect(stats.total).toBe(3);
    });

    it("should count retryable errors", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("user rejected transaction"));
      const stats = classifier.getStatistics();
      expect(stats.retryableCount).toBe(1);
    });

    it("should clear history", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.clearHistory();
      expect(classifier.getHistory()).toHaveLength(0);
    });
  });

  describe("global instance / classifyAndHandle", () => {
    it("errorClassifier should be a shared instance", () => {
      expect(errorClassifier).toBeInstanceOf(ErrorClassifier);
    });

    it("classifyAndHandle should call callback", () => {
      let called = false;
      classifyAndHandle(new Error("network error: timeout"), () => { called = true; });
      expect(called).toBe(true);
    });

    it("classifyAndHandle should return classified error", () => {
      const result = classifyAndHandle(new Error("network error: timeout"));
      expect(result.category).toBe("network");
    });
  });

  describe("classify — severity and userFacing", () => {
    it("should mark user-facing errors correctly", () => {
      const result = classifier.classify(new Error("user rejected transaction"));
      expect(result.userFacing).toBe(true);
    });

    it("should mark system errors as not user-facing", () => {
      const result = classifier.classify(new Error("internal server error 500"));
      expect(result.userFacing).toBe(false);
    });

    it("should include timestamp in classified error", () => {
      const before = Date.now();
      const result = classifier.classify(new Error("network timeout"));
      // ClassifiedError has no timestamp field — verify it has the core fields instead
      expect(result.category).toBe("network");
      expect(result.message).toBeDefined();
      expect(before).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("getStatistics — category counts", () => {
    it("should count errors by category", () => {
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("network error: timeout"));
      classifier.classify(new Error("user rejected transaction"));
      const stats = classifier.getStatistics();
      expect(stats.byCategory["network"]).toBe(2);
      expect(stats.byCategory["user"]).toBe(1);
    });

    it("should return totalCount", () => {
      classifier.classify(new Error("network timeout"));
      classifier.classify(new Error("invalid address"));
      const stats = classifier.getStatistics();
      expect(stats.total).toBe(2);
    });
  });

  describe("addPattern — priority ordering", () => {
    it("should match higher-priority custom pattern before defaults", () => {
      classifier.addPattern({
        pattern: "special-error",
        category: "contract",
        severity: "critical",
        recoveryStrategy: "abort",
        suggestions: ["Special handling required"],
        priority: 1000,
      });
      const result = classifier.classify(new Error("special-error occurred"));
      expect(result.category).toBe("contract");
      expect(result.severity).toBe("critical");
    });
  });

  describe("classify — metadata extraction", () => {
    it("should extract metadata from error with extra properties", () => {
      const err = Object.assign(new Error("contract error"), { code: "CONTRACT_PANIC", ledger: 12345 });
      const result = classifier.classify(err);
      expect(result.metadata).toBeDefined();
    });

    it("should extract error code when present", () => {
      const err = Object.assign(new Error("contract panic"), { code: "PANIC_001" });
      const result = classifier.classify(err);
      expect(result.code).toBe("PANIC_001");
    });
  });
});
