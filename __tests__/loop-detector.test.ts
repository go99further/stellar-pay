import { describe, it, expect } from "vitest";
import { LoopDetector, LoopDetectedError } from "../lib/agent/loop-detector";

describe("LoopDetector", () => {
  describe("consecutive detection", () => {
    it("does not throw for 2 identical calls", () => {
      const d = new LoopDetector();
      d.record("get_pool_stats", {});
      expect(() => d.record("get_pool_stats", {})).not.toThrow();
    });

    it("throws on 3rd consecutive identical call", () => {
      const d = new LoopDetector();
      d.record("get_pool_stats", {});
      d.record("get_pool_stats", {});
      expect(() => d.record("get_pool_stats", {})).toThrowError(LoopDetectedError);
    });

    it("error has kind=consecutive", () => {
      const d = new LoopDetector();
      d.record("get_pool_stats", {});
      d.record("get_pool_stats", {});
      try {
        d.record("get_pool_stats", {});
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(LoopDetectedError);
        expect((err as LoopDetectedError).kind).toBe("consecutive");
      }
    });

    it("does not throw when inputs differ", () => {
      const d = new LoopDetector();
      d.record("get_pool_stats", { a: 1 });
      d.record("get_pool_stats", { a: 2 });
      expect(() => d.record("get_pool_stats", { a: 3 })).not.toThrow();
    });

    it("resets consecutive count when a different call is interleaved", () => {
      const d = new LoopDetector();
      d.record("get_pool_stats", {});
      d.record("get_pool_stats", {});
      d.record("get_metrics", {});  // breaks the streak
      d.record("get_pool_stats", {});
      expect(() => d.record("get_pool_stats", {})).not.toThrow();
    });

    it("respects custom maxConsecutive", () => {
      const d = new LoopDetector(5);
      for (let i = 0; i < 4; i++) d.record("tool", {});
      expect(() => d.record("tool", {})).toThrowError(LoopDetectedError);
    });
  });

  describe("sequence detection", () => {
    it("throws when a 4-call sequence repeats", () => {
      const d = new LoopDetector(10, 4); // high consecutive threshold so only sequence fires
      const seq = ["a", "b", "c", "d"];
      for (const name of seq) d.record(name, {});
      // Second sequence — last call triggers the error
      d.record("a", {}); d.record("b", {}); d.record("c", {});
      expect(() => d.record("d", {})).toThrowError(LoopDetectedError);
    });

    it("detects repeating sequence and throws LoopDetectedError with kind=sequence", () => {
      const d = new LoopDetector(10, 3);
      // First sequence: a, b, c
      d.record("a", {});
      d.record("b", {});
      d.record("c", {});
      // Second sequence: a, b — no throw yet
      d.record("a", {});
      d.record("b", {});
      // Third call of second sequence should trigger
      expect(() => d.record("c", {})).toThrowError(LoopDetectedError);
    });

    it("sequence error has kind=sequence", () => {
      const d = new LoopDetector(10, 3);
      d.record("a", {}); d.record("b", {}); d.record("c", {});
      d.record("a", {}); d.record("b", {});
      try {
        d.record("c", {});
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as LoopDetectedError).kind).toBe("sequence");
      }
    });

    it("does not throw when sequence inputs differ", () => {
      const d = new LoopDetector(10, 2);
      d.record("a", { x: 1 }); d.record("b", { x: 1 });
      // Second pair with different inputs — should not trigger
      d.record("a", { x: 2 }); expect(() => d.record("b", { x: 2 })).not.toThrow();
    });
  });

  describe("reset", () => {
    it("clears state so consecutive count restarts", () => {
      const d = new LoopDetector();
      d.record("tool", {});
      d.record("tool", {});
      d.reset();
      d.record("tool", {});
      d.record("tool", {});
      expect(() => d.record("tool", {})).toThrowError(LoopDetectedError);
    });
  });

  describe("window bounding", () => {
    it("handles many calls without memory growth issues", () => {
      const d = new LoopDetector(3, 4);
      // Alternate between two different tools — should never trigger
      for (let i = 0; i < 100; i++) {
        d.record(i % 2 === 0 ? "tool_a" : "tool_b", { i });
      }
    });
  });
});
