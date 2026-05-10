import { describe, it, expect } from "vitest";
import {
  withRetry,
  validateMessages,
  trimHistory,
  parseContractError,
  calculateRecommendedSlippage,
} from "../lib/agent/utils";

describe("utils", () => {
  describe("withRetry", () => {
    it("should return result on first attempt", async () => {
      const result = await withRetry(async () => 42);
      expect(result).toBe(42);
    });

    it("should retry on retryable error and succeed", async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error("rate limit exceeded");
          return "ok";
        },
        { initialDelay: 0, maxAttempts: 3 }
      );
      expect(result).toBe("ok");
      expect(attempts).toBe(2);
    });

    it("should throw immediately on terminal error", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("context window exceeded");
        }, { initialDelay: 0, maxAttempts: 3 })
      ).rejects.toThrow("context window exceeded");
      expect(attempts).toBe(1);
    });

    it("should throw after maxAttempts on non-retryable error", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("some unknown error");
        }, { initialDelay: 0, maxAttempts: 3 })
      ).rejects.toThrow("some unknown error");
      expect(attempts).toBe(1); // non-retryable, throws on first attempt
    });

    it("should retry on timeout error", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("connection timeout");
        }, { initialDelay: 0, maxAttempts: 2 })
      ).rejects.toThrow();
      expect(attempts).toBe(2);
    });

    it("should retry on temporarily error", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("service temporarily unavailable");
        }, { initialDelay: 0, maxAttempts: 2 })
      ).rejects.toThrow();
      expect(attempts).toBe(2);
    });
  });

  describe("validateMessages", () => {
    it("should return empty array unchanged", () => {
      expect(validateMessages([])).toHaveLength(0);
    });

    it("should return single message unchanged", () => {
      const msgs = [{ role: "user" as const, content: "hi" }];
      expect(validateMessages(msgs)).toHaveLength(1);
    });

    it("should pass through properly alternating messages", () => {
      const msgs = [
        { role: "user" as const, content: "hi" },
        { role: "assistant" as const, content: "hello" },
        { role: "user" as const, content: "bye" },
      ];
      expect(validateMessages(msgs)).toHaveLength(3);
    });

    it("should insert filler message between consecutive same-role messages", () => {
      const msgs = [
        { role: "user" as const, content: "msg1" },
        { role: "user" as const, content: "msg2" },
      ];
      const result = validateMessages(msgs);
      expect(result).toHaveLength(3);
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("");
    });

    it("should handle consecutive assistant messages", () => {
      const msgs = [
        { role: "assistant" as const, content: "a1" },
        { role: "assistant" as const, content: "a2" },
      ];
      const result = validateMessages(msgs);
      expect(result).toHaveLength(3);
      expect(result[1].role).toBe("user");
    });
  });

  describe("trimHistory", () => {
    it("should return messages unchanged when under limit", () => {
      const msgs = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      expect(trimHistory(msgs, 5)).toHaveLength(2);
    });

    it("should trim to maxMessages", () => {
      const msgs = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg-${i}`,
      }));
      const result = trimHistory(msgs, 4);
      expect(result).toHaveLength(4);
    });

    it("should not start with a tool-result turn", () => {
      const msgs = [
        { role: "user", content: "text" },
        { role: "assistant", content: "response" },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "result" }] },
        { role: "assistant", content: "done" },
        { role: "user", content: "follow up" },
      ];
      // Trim to 3 — would start at index 2 (tool_result), should skip to index 3
      const result = trimHistory(msgs, 3);
      expect(result[0].role).not.toBe("user");
      // or if it is user, it should not be a pure tool_result turn
      if (result[0].role === "user") {
        const content = result[0].content;
        const isToolResult =
          Array.isArray(content) &&
          content.every((b) => typeof b === "object" && b !== null && "type" in b && (b as { type: string }).type === "tool_result");
        expect(isToolResult).toBe(false);
      }
    });

    it("should return all messages when maxMessages >= length", () => {
      const msgs = [{ role: "user", content: "hi" }];
      expect(trimHistory(msgs, 10)).toHaveLength(1);
    });
  });

  describe("parseContractError", () => {
    it("should map known error strings to friendly messages", () => {
      expect(parseContractError("amount_in must be positive")).toBe("输入金额必须大于 0");
      expect(parseContractError("pool has no liquidity")).toBe("池子暂无流动性，无法交易");
      expect(parseContractError("slippage: amount_out below min_amount_out")).toBe("滑点超限，实际输出低于最小接受值");
      expect(parseContractError("zero output")).toBe("交易输出为 0，请增加输入金额");
      expect(parseContractError("pool is empty")).toBe("池子为空，无法移除流动性");
    });

    it("should return raw string for unknown errors", () => {
      const raw = "some unknown contract error";
      expect(parseContractError(raw)).toBe(raw);
    });

    it("should match substring within longer error message", () => {
      const result = parseContractError("Error: amount_in must be positive (got -5)");
      expect(result).toBe("输入金额必须大于 0");
    });
  });

  describe("calculateRecommendedSlippage", () => {
    it("should return 300 for empty pool (reserveIn = 0)", () => {
      expect(calculateRecommendedSlippage(100n, 0n, 1000n)).toBe(300);
    });

    it("should return 50 bps for small trade (<1% of pool)", () => {
      // 1n / 1000n = 0.1% → 10 bps < 100 bps threshold
      expect(calculateRecommendedSlippage(1n, 1000n, 1000n)).toBe(50);
    });

    it("should return 100 bps for medium trade (1-5% of pool)", () => {
      // 20n / 1000n = 2% → 200 bps, between 100 and 500
      expect(calculateRecommendedSlippage(20n, 1000n, 1000n)).toBe(100);
    });

    it("should return 200 bps for large trade (5-10% of pool)", () => {
      // 60n / 1000n = 6% → 600 bps, between 500 and 1000
      expect(calculateRecommendedSlippage(60n, 1000n, 1000n)).toBe(200);
    });

    it("should return 300 bps for very large trade (>10% of pool)", () => {
      // 200n / 1000n = 20% → 2000 bps > 1000
      expect(calculateRecommendedSlippage(200n, 1000n, 1000n)).toBe(300);
    });

    it("should handle exact boundary at 1% (100 bps)", () => {
      // 10n / 1000n = 1% → exactly 100 bps → medium tier
      expect(calculateRecommendedSlippage(10n, 1000n, 1000n)).toBe(100);
    });
  });
});
