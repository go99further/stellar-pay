import { describe, it, expect } from "vitest";
import { loadConfig } from "../lib/agent/config";

describe("config", () => {
  describe("loadConfig", () => {
    it("should return defaults when no env vars set", () => {
      const cfg = loadConfig();
      expect(cfg.maxHistory).toBe(20);
      expect(cfg.maxTokens).toBe(1024);
      expect(cfg.analyticsMaxTurns).toBe(5);
      expect(cfg.tradingMaxTurns).toBe(6);
      expect(cfg.securityMaxTurns).toBe(5);
      expect(cfg.turnLimitWarning).toBe(4);
    });

    it("should parse env vars when set", () => {
      const orig = {
        STELLAR_MAX_HISTORY: process.env.STELLAR_MAX_HISTORY,
        STELLAR_MAX_TOKENS: process.env.STELLAR_MAX_TOKENS,
        STELLAR_ANALYTICS_MAX_TURNS: process.env.STELLAR_ANALYTICS_MAX_TURNS,
        STELLAR_TRADING_MAX_TURNS: process.env.STELLAR_TRADING_MAX_TURNS,
        STELLAR_SECURITY_MAX_TURNS: process.env.STELLAR_SECURITY_MAX_TURNS,
        STELLAR_TURN_LIMIT_WARNING: process.env.STELLAR_TURN_LIMIT_WARNING,
      };
      process.env.STELLAR_MAX_HISTORY = "30";
      process.env.STELLAR_MAX_TOKENS = "2048";
      process.env.STELLAR_ANALYTICS_MAX_TURNS = "8";
      process.env.STELLAR_TRADING_MAX_TURNS = "10";
      process.env.STELLAR_SECURITY_MAX_TURNS = "7";
      process.env.STELLAR_TURN_LIMIT_WARNING = "6";

      const cfg = loadConfig();
      expect(cfg.maxHistory).toBe(30);
      expect(cfg.maxTokens).toBe(2048);
      expect(cfg.analyticsMaxTurns).toBe(8);
      expect(cfg.tradingMaxTurns).toBe(10);
      expect(cfg.securityMaxTurns).toBe(7);
      expect(cfg.turnLimitWarning).toBe(6);

      // Restore
      for (const [k, v] of Object.entries(orig)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("should return numeric values", () => {
      const cfg = loadConfig();
      for (const val of Object.values(cfg)) {
        expect(typeof val).toBe("number");
        expect(Number.isNaN(val)).toBe(false);
      }
    });
  });
});
