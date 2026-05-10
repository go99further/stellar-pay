import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveTransaction,
  getTransactionHistory,
  clearHistory,
  getRecentTransactions,
  getStellarExpertLink,
} from "../lib/agent/transaction-history";

describe("transaction-history", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("saveTransaction", () => {
    it("should save a transaction and retrieve it", () => {
      saveTransaction({ type: "swap", details: { amount: 100 }, txHash: "abc123", status: "success" });
      const history = getTransactionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe("swap");
      expect(history[0].txHash).toBe("abc123");
    });

    it("should assign an id and timestamp", () => {
      const before = Date.now();
      saveTransaction({ type: "swap", details: {}, txHash: "h1", status: "success" });
      const [record] = getTransactionHistory();
      expect(typeof record.id).toBe("string");
      expect(record.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("should prepend new transactions (newest first)", () => {
      saveTransaction({ type: "swap", details: {}, txHash: "h1", status: "success" });
      saveTransaction({ type: "add_liquidity", details: {}, txHash: "h2", status: "success" });
      const history = getTransactionHistory();
      expect(history[0].txHash).toBe("h2");
      expect(history[1].txHash).toBe("h1");
    });

    it("should trim to MAX_TRANSACTIONS (50)", () => {
      for (let i = 0; i < 55; i++) {
        saveTransaction({ type: "swap", details: {}, txHash: `h${i}`, status: "success" });
      }
      expect(getTransactionHistory()).toHaveLength(50);
    });

    it("should save all three transaction types", () => {
      saveTransaction({ type: "swap", details: {}, txHash: "h1", status: "success" });
      saveTransaction({ type: "add_liquidity", details: {}, txHash: "h2", status: "success" });
      saveTransaction({ type: "remove_liquidity", details: {}, txHash: "h3", status: "failed" });
      const history = getTransactionHistory();
      const types = history.map((r) => r.type);
      expect(types).toContain("swap");
      expect(types).toContain("add_liquidity");
      expect(types).toContain("remove_liquidity");
    });
  });

  describe("getTransactionHistory", () => {
    it("should return empty array when no history", () => {
      expect(getTransactionHistory()).toHaveLength(0);
    });

    it("should return empty array for invalid JSON", () => {
      localStorage.setItem("stellar-pay-transaction-history", "not-json");
      expect(getTransactionHistory()).toHaveLength(0);
    });

    it("should return empty array for non-array JSON", () => {
      localStorage.setItem("stellar-pay-transaction-history", JSON.stringify({ foo: "bar" }));
      expect(getTransactionHistory()).toHaveLength(0);
    });

    it("should filter out invalid records", () => {
      const valid = { id: "1", type: "swap", timestamp: Date.now(), details: {}, txHash: "h1", status: "success" };
      const invalid = { id: 2, type: "unknown", timestamp: "bad" };
      localStorage.setItem("stellar-pay-transaction-history", JSON.stringify([valid, invalid]));
      expect(getTransactionHistory()).toHaveLength(1);
    });
  });

  describe("clearHistory", () => {
    it("should remove all transactions", () => {
      saveTransaction({ type: "swap", details: {}, txHash: "h1", status: "success" });
      clearHistory();
      expect(getTransactionHistory()).toHaveLength(0);
    });
  });

  describe("getRecentTransactions", () => {
    it("should return the most recent N transactions", () => {
      for (let i = 0; i < 15; i++) {
        saveTransaction({ type: "swap", details: {}, txHash: `h${i}`, status: "success" });
      }
      expect(getRecentTransactions(5)).toHaveLength(5);
    });

    it("should default to 10", () => {
      for (let i = 0; i < 15; i++) {
        saveTransaction({ type: "swap", details: {}, txHash: `h${i}`, status: "success" });
      }
      expect(getRecentTransactions()).toHaveLength(10);
    });

    it("should return all if fewer than limit", () => {
      saveTransaction({ type: "swap", details: {}, txHash: "h1", status: "success" });
      expect(getRecentTransactions(10)).toHaveLength(1);
    });
  });

  describe("getStellarExpertLink", () => {
    it("should return testnet link by default", () => {
      const link = getStellarExpertLink("abc123");
      expect(link).toBe("https://stellar.expert/explorer/testnet/tx/abc123");
    });

    it("should return public link when specified", () => {
      const link = getStellarExpertLink("abc123", "public");
      expect(link).toBe("https://stellar.expert/explorer/public/tx/abc123");
    });
  });
});
