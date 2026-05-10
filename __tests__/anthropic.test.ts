import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock env vars before module load
vi.stubEnv("ANTHROPIC_API_KEY", "");
vi.stubEnv("DEEPSEEK_API_KEY", "");

import {
  hasAnthropicKey,
  hasDeepSeekKey,
  hasAnyKey,
  getAnthropicClient,
  getOpenAIClient,
  MODEL_ROUTER,
  MODEL_ANALYTICS,
  PROVIDER,
} from "../lib/agent/anthropic";

describe("anthropic module", () => {
  describe("hasAnthropicKey", () => {
    it("should return false when ANTHROPIC_API_KEY is not set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(hasAnthropicKey()).toBe(false);
    });

    it("should return true when ANTHROPIC_API_KEY is set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      expect(hasAnthropicKey()).toBe(true);
      vi.stubEnv("ANTHROPIC_API_KEY", "");
    });
  });

  describe("hasDeepSeekKey", () => {
    it("should return false when DEEPSEEK_API_KEY is not set", () => {
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      expect(hasDeepSeekKey()).toBe(false);
    });

    it("should return true when DEEPSEEK_API_KEY is set", () => {
      vi.stubEnv("DEEPSEEK_API_KEY", "sk-ds-test");
      expect(hasDeepSeekKey()).toBe(true);
      vi.stubEnv("DEEPSEEK_API_KEY", "");
    });
  });

  describe("hasAnyKey", () => {
    it("should return false when neither key is set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      expect(hasAnyKey()).toBe(false);
    });

    it("should return true when ANTHROPIC_API_KEY is set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      expect(hasAnyKey()).toBe(true);
      vi.stubEnv("ANTHROPIC_API_KEY", "");
    });

    it("should return true when DEEPSEEK_API_KEY is set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("DEEPSEEK_API_KEY", "sk-ds-test");
      expect(hasAnyKey()).toBe(true);
      vi.stubEnv("DEEPSEEK_API_KEY", "");
    });
  });

  describe("getAnthropicClient", () => {
    it("should throw when ANTHROPIC_API_KEY is not set", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      expect(() => getAnthropicClient()).toThrow(/ANTHROPIC_API_KEY/);
    });
  });

  describe("getOpenAIClient", () => {
    it("should throw when DEEPSEEK_API_KEY is not set", () => {
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      expect(() => getOpenAIClient()).toThrow(/DEEPSEEK_API_KEY/);
    });
  });

  describe("model constants", () => {
    it("MODEL_ROUTER should be a non-empty string", () => {
      expect(typeof MODEL_ROUTER).toBe("string");
      expect(MODEL_ROUTER.length).toBeGreaterThan(0);
    });

    it("MODEL_ANALYTICS should be a non-empty string", () => {
      expect(typeof MODEL_ANALYTICS).toBe("string");
      expect(MODEL_ANALYTICS.length).toBeGreaterThan(0);
    });

    it("PROVIDER should be anthropic or deepseek", () => {
      expect(["anthropic", "deepseek"]).toContain(PROVIDER);
    });
  });
});
