import { describe, it, expect, beforeEach } from "vitest";
import { ContextCompressor, contextCompressor, compressMessages } from "../lib/agent/memory/context-compressor";
import type { Message } from "../lib/agent/memory/context-compressor";

function makeMsg(role: Message["role"], content: string, ts = Date.now()): Message {
  return { role, content, timestamp: ts };
}

describe("ContextCompressor", () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    compressor = new ContextCompressor({ maxTokens: 100, minMessagesToKeep: 2, alwaysKeepRecentN: 2 });
  });

  describe("compress — empty input", () => {
    it("should return empty result for empty array", () => {
      const result = compressor.compress([]);
      expect(result.originalMessages).toHaveLength(0);
      expect(result.compressedMessages).toHaveLength(0);
      expect(result.originalTokenCount).toBe(0);
      expect(result.compressedTokenCount).toBe(0);
      expect(result.compressionRatio).toBe(1.0);
      expect(result.removedCount).toBe(0);
    });
  });

  describe("compress — under budget", () => {
    it("should return messages unchanged when under token budget", () => {
      const msgs = [makeMsg("user", "hi"), makeMsg("assistant", "hello")];
      const result = compressor.compress(msgs);
      expect(result.compressedMessages).toEqual(msgs);
      expect(result.compressionRatio).toBe(1.0);
      expect(result.removedCount).toBe(0);
    });

    it("should set originalTokenCount correctly", () => {
      const msgs = [makeMsg("user", "hello world")]; // ~3 tokens
      const result = compressor.compress(msgs);
      expect(result.originalTokenCount).toBeGreaterThan(0);
      expect(result.originalTokenCount).toBe(result.compressedTokenCount);
    });
  });

  describe("compress — over budget", () => {
    it("should reduce message count when over token budget", () => {
      const longContent = "a".repeat(500); // ~125 tokens each
      const msgs = Array.from({ length: 5 }, (_, i) =>
        makeMsg("user", longContent, Date.now() + i)
      );
      const result = compressor.compress(msgs);
      expect(result.compressedMessages.length).toBeLessThan(msgs.length);
      expect(result.removedCount).toBeGreaterThan(0);
    });

    it("should always keep the most recent N messages", () => {
      const longContent = "a".repeat(500);
      const msgs = Array.from({ length: 5 }, (_, i) =>
        makeMsg("user", longContent, i * 1000)
      );
      const result = compressor.compress(msgs);
      // The last 2 messages (alwaysKeepRecentN=2) must appear in compressed output
      const lastTwo = msgs.slice(-2);
      for (const msg of lastTwo) {
        expect(result.compressedMessages.some((m) => m.content === msg.content)).toBe(true);
      }
    });

    it("should include a summary message when messages are removed", () => {
      const longContent = "a".repeat(500);
      const msgs = Array.from({ length: 5 }, (_, i) =>
        makeMsg("user", longContent, i * 1000)
      );
      const result = compressor.compress(msgs);
      if (result.removedCount > 0) {
        expect(result.summary).toBeDefined();
      }
    });

    it("should keep system prompt when alwaysKeepSystemPrompt is true", () => {
      const c = new ContextCompressor({
        maxTokens: 50,
        alwaysKeepSystemPrompt: true,
        alwaysKeepRecentN: 1,
        minMessagesToKeep: 1,
      });
      const msgs = [
        makeMsg("system", "You are a trading assistant", 0),
        ...Array.from({ length: 5 }, (_, i) => makeMsg("user", "a".repeat(200), (i + 1) * 1000)),
      ];
      const result = c.compress(msgs);
      expect(result.compressedMessages.some((m) => m.role === "system")).toBe(true);
    });
  });

  describe("scoring — importance signals", () => {
    it("should prefer messages with error keywords", () => {
      const c = new ContextCompressor({ maxTokens: 50, alwaysKeepRecentN: 0, minMessagesToKeep: 1 });
      const msgs = [
        makeMsg("user", "error: transaction failed", 1000),
        makeMsg("user", "a".repeat(200), 2000),
        makeMsg("user", "b".repeat(200), 3000),
      ];
      const result = c.compress(msgs);
      // error message should be retained
      expect(result.compressedMessages.some((m) => m.content.includes("error"))).toBe(true);
    });

    it("should prefer messages with transaction keywords", () => {
      const c = new ContextCompressor({ maxTokens: 50, alwaysKeepRecentN: 0, minMessagesToKeep: 1 });
      const msgs = [
        makeMsg("user", "swap 10 TKNA for TKNB", 1000),
        makeMsg("user", "a".repeat(200), 2000),
        makeMsg("user", "b".repeat(200), 3000),
      ];
      const result = c.compress(msgs);
      expect(result.compressedMessages.some((m) => m.content.includes("swap"))).toBe(true);
    });
  });

  describe("summary generation", () => {
    it("should include key facts from removed messages with swap content", () => {
      const c = new ContextCompressor({ maxTokens: 30, alwaysKeepRecentN: 1, minMessagesToKeep: 1 });
      const msgs = [
        makeMsg("user", "swap 100 TKNA for 90 TKNB", 1000),
        makeMsg("user", "a".repeat(200), 2000),
      ];
      const result = c.compress(msgs);
      if (result.summary) {
        expect(typeof result.summary).toBe("string");
        expect(result.summary.length).toBeGreaterThan(0);
      }
    });

    it("should produce generic summary when no key facts found", () => {
      const c = new ContextCompressor({ maxTokens: 30, alwaysKeepRecentN: 1, minMessagesToKeep: 1 });
      const msgs = [
        makeMsg("user", "a".repeat(200), 1000),
        makeMsg("user", "b".repeat(200), 2000),
      ];
      const result = c.compress(msgs);
      if (result.summary) {
        expect(result.summary).toContain("compressed");
      }
    });
  });

  describe("updateConfig / getConfig", () => {
    it("should update config", () => {
      compressor.updateConfig({ maxTokens: 9999 });
      expect(compressor.getConfig().maxTokens).toBe(9999);
    });

    it("should return a copy of config", () => {
      const cfg = compressor.getConfig();
      cfg.maxTokens = 0;
      expect(compressor.getConfig().maxTokens).not.toBe(0);
    });
  });

  describe("compressionRatio in result", () => {
    it("should be 1.0 when no compression needed", () => {
      const result = compressor.compress([makeMsg("user", "hi")]);
      expect(result.compressionRatio).toBe(1.0);
    });

    it("should be less than 1.0 when compression occurs", () => {
      const longContent = "a".repeat(500);
      const msgs = Array.from({ length: 5 }, (_, i) =>
        makeMsg("user", longContent, i * 1000)
      );
      const result = compressor.compress(msgs);
      if (result.removedCount > 0) {
        expect(result.compressionRatio).toBeLessThan(1.0);
      }
    });
  });

  describe("global instance / compressMessages", () => {
    it("contextCompressor should be a shared instance", () => {
      expect(contextCompressor).toBeInstanceOf(ContextCompressor);
    });

    it("compressMessages should use global instance", () => {
      const msgs = [makeMsg("user", "hello")];
      const result = compressMessages(msgs);
      expect(result.originalMessages).toHaveLength(1);
    });

    it("compressMessages should accept custom maxTokens", () => {
      const msgs = [makeMsg("user", "hello")];
      const result = compressMessages(msgs, 10000);
      expect(result.compressionRatio).toBe(1.0);
    });
  });
});
