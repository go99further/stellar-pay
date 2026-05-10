import { describe, it, expect, beforeEach } from "vitest";
import { HistoryProcessor } from "../lib/agent/history/history-processor";

describe("HistoryProcessor", () => {
  let processor: HistoryProcessor;

  beforeEach(() => {
    processor = new HistoryProcessor();
  });

  describe("processHistory", () => {
    it("should process conversation messages", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
        { role: "assistant", content: "Simulating swap...", timestamp: Date.now() },
        { role: "assistant", content: "Swap completed successfully", timestamp: Date.now() },
      ];

      const processed = processor.processHistory(messages);
      expect(processed.length).toBeGreaterThan(0);
      expect(processed[0].role).toBe("user");
    });

    it("should classify message types", () => {
      const messages = [
        { role: "user", content: "What is the price of TKNA?", timestamp: Date.now() },
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
        { role: "assistant", content: "Error: insufficient balance", timestamp: Date.now() },
      ];

      const processed = processor.processHistory(messages);
      expect(processed[0].classification.type).toBe("query");
      expect(processed[1].classification.type).toBe("command");
      expect(processed[2].classification.type).toBe("error");
    });

    it("should extract entities", () => {
      const messages = [
        { role: "user", content: "Swap 100 TKNA for TKNB", timestamp: Date.now() },
      ];

      const processed = processor.processHistory(messages);
      const entities = processed[0].entities;

      expect(entities.some((e) => e.type === "token" && e.value === "TKNA")).toBe(true);
      expect(entities.some((e) => e.type === "token" && e.value === "TKNB")).toBe(true);
      expect(entities.some((e) => e.type === "amount" && e.value === "100")).toBe(true);
    });

    it("should extract facts", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
      ];

      const processed = processor.processHistory(messages);
      const facts = processed[0].facts;

      expect(facts.length).toBeGreaterThan(0);
      expect(facts.some((f) => f.predicate === "swap_to")).toBe(true);
    });

    it("should deduplicate similar messages", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() + 1000 },
        { role: "user", content: "Swap 20 TKNA for TKNB", timestamp: Date.now() + 2000 },
      ];

      const processed = processor.processHistory(messages);
      expect(processed.length).toBeLessThan(messages.length);
    });
  });

  describe("getKnowledgeGraph", () => {
    it("should build knowledge graph", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
        { role: "user", content: "Check price of TKNA", timestamp: Date.now() },
      ];

      processor.processHistory(messages);
      const graph = processor.getKnowledgeGraph();

      expect(graph.facts.length).toBeGreaterThan(0);
      expect(graph.entities.size).toBeGreaterThan(0);
      expect(graph.relationships.length).toBeGreaterThan(0);
    });
  });

  describe("queryFacts", () => {
    it("should query facts by subject", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
      ];

      processor.processHistory(messages);
      const facts = processor.queryFacts("TKNA");

      expect(Array.isArray(facts)).toBe(true);
    });
  });

  describe("getEntitiesByType", () => {
    it("should get entities by type", () => {
      const messages = [
        { role: "user", content: "Swap 100 TKNA for TKNB", timestamp: Date.now() },
      ];

      processor.processHistory(messages);
      const tokens = processor.getEntitiesByType("token");
      const amounts = processor.getEntitiesByType("amount");

      expect(tokens.length).toBeGreaterThan(0);
      expect(amounts.length).toBeGreaterThan(0);
    });
  });

  describe("getStatistics", () => {
    it("should return statistics", () => {
      const messages = [
        { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
        { role: "assistant", content: "Swap completed", timestamp: Date.now() },
        { role: "user", content: "What is the price?", timestamp: Date.now() },
      ];

      processor.processHistory(messages);
      const stats = processor.getStatistics();

      expect(stats.totalMessages).toBeGreaterThan(0);
      expect(stats.byType).toBeDefined();
      expect(stats.totalEntities).toBeGreaterThan(0);
      expect(stats.totalFacts).toBeGreaterThan(0);
    });
  });
});
