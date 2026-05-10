import { describe, it, expect, beforeEach } from "vitest";
import { IntervalTree } from "../lib/agent/interval-tree";
import type { Interval } from "../lib/agent/interval-tree";

describe("IntervalTree", () => {
  let tree: IntervalTree<string>;

  beforeEach(() => {
    tree = new IntervalTree<string>();
  });

  describe("insert / size", () => {
    it("should track size", () => {
      expect(tree.size).toBe(0);
      tree.insert({ start: 1, end: 5 });
      tree.insert({ start: 3, end: 8 });
      expect(tree.size).toBe(2);
    });

    it("should store data with interval", () => {
      tree.insert({ start: 1, end: 5, data: "meeting" });
      const results = tree.queryPoint(3);
      expect(results[0].data).toBe("meeting");
    });
  });

  describe("queryPoint", () => {
    beforeEach(() => {
      tree.insert({ start: 1, end: 5 });
      tree.insert({ start: 3, end: 8 });
      tree.insert({ start: 10, end: 15 });
      tree.insert({ start: 6, end: 12 });
    });

    it("should find intervals containing a point", () => {
      const results = tree.queryPoint(4);
      const ranges = results.map((r) => `${r.start}-${r.end}`).sort();
      expect(ranges).toContain("1-5");
      expect(ranges).toContain("3-8");
    });

    it("should return empty for point outside all intervals", () => {
      expect(tree.queryPoint(0)).toHaveLength(0);
      expect(tree.queryPoint(20)).toHaveLength(0);
    });

    it("should include intervals where point equals start", () => {
      const results = tree.queryPoint(1);
      expect(results.some((r) => r.start === 1 && r.end === 5)).toBe(true);
    });

    it("should include intervals where point equals end", () => {
      const results = tree.queryPoint(5);
      expect(results.some((r) => r.start === 1 && r.end === 5)).toBe(true);
    });

    it("should find single interval at exact point", () => {
      const results = tree.queryPoint(11);
      const ranges = results.map((r) => `${r.start}-${r.end}`).sort();
      expect(ranges).toContain("6-12");
      expect(ranges).toContain("10-15");
    });
  });

  describe("queryRange", () => {
    beforeEach(() => {
      tree.insert({ start: 1, end: 3 });
      tree.insert({ start: 5, end: 8 });
      tree.insert({ start: 10, end: 15 });
      tree.insert({ start: 7, end: 12 });
    });

    it("should find all overlapping intervals", () => {
      const results = tree.queryRange(6, 11);
      const ranges = results.map((r) => `${r.start}-${r.end}`).sort();
      expect(ranges).toContain("5-8");
      expect(ranges).toContain("7-12");
      expect(ranges).toContain("10-15");
    });

    it("should return empty when no overlap", () => {
      expect(tree.queryRange(20, 25)).toHaveLength(0);
    });

    it("should find interval that contains the query range", () => {
      const results = tree.queryRange(11, 12);
      expect(results.some((r) => r.start === 10 && r.end === 15)).toBe(true);
    });

    it("should find interval that is contained by query range", () => {
      const results = tree.queryRange(0, 20);
      expect(results).toHaveLength(4);
    });

    it("should handle touching intervals (end == start)", () => {
      const results = tree.queryRange(3, 5);
      const ranges = results.map((r) => `${r.start}-${r.end}`).sort();
      expect(ranges).toContain("1-3");
      expect(ranges).toContain("5-8");
    });
  });

  describe("overlaps", () => {
    it("should return true for overlapping intervals", () => {
      const a: Interval = { start: 1, end: 5 };
      const b: Interval = { start: 3, end: 8 };
      expect(tree.overlaps(a, b)).toBe(true);
    });

    it("should return false for non-overlapping intervals", () => {
      const a: Interval = { start: 1, end: 3 };
      const b: Interval = { start: 5, end: 8 };
      expect(tree.overlaps(a, b)).toBe(false);
    });

    it("should return true for touching intervals", () => {
      const a: Interval = { start: 1, end: 5 };
      const b: Interval = { start: 5, end: 8 };
      expect(tree.overlaps(a, b)).toBe(true);
    });

    it("should return true when one contains the other", () => {
      const a: Interval = { start: 1, end: 10 };
      const b: Interval = { start: 3, end: 7 };
      expect(tree.overlaps(a, b)).toBe(true);
    });
  });

  describe("delete", () => {
    it("should delete an interval", () => {
      tree.insert({ start: 1, end: 5 });
      tree.insert({ start: 3, end: 8 });
      const deleted = tree.delete({ start: 1, end: 5 });
      expect(deleted).toBe(true);
      expect(tree.size).toBe(1);
      expect(tree.queryPoint(2)).toHaveLength(0);
    });

    it("should return false for non-existing interval", () => {
      tree.insert({ start: 1, end: 5 });
      expect(tree.delete({ start: 99, end: 100 })).toBe(false);
    });

    it("should maintain correct queries after deletion", () => {
      tree.insert({ start: 1, end: 5 });
      tree.insert({ start: 3, end: 8 });
      tree.insert({ start: 6, end: 10 });
      tree.delete({ start: 3, end: 8 });
      const results = tree.queryPoint(4);
      expect(results.some((r) => r.start === 3 && r.end === 8)).toBe(false);
      expect(results.some((r) => r.start === 1 && r.end === 5)).toBe(true);
    });
  });

  describe("allIntervals", () => {
    it("should return all intervals in order", () => {
      tree.insert({ start: 5, end: 10 });
      tree.insert({ start: 1, end: 3 });
      tree.insert({ start: 8, end: 15 });
      const all = tree.allIntervals();
      expect(all).toHaveLength(3);
      // In-order by start
      expect(all[0].start).toBe(1);
    });

    it("should return empty array for empty tree", () => {
      expect(tree.allIntervals()).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should remove all intervals", () => {
      tree.insert({ start: 1, end: 5 });
      tree.insert({ start: 3, end: 8 });
      tree.clear();
      expect(tree.size).toBe(0);
      expect(tree.allIntervals()).toEqual([]);
    });
  });

  describe("complex scenarios", () => {
    it("should handle many overlapping intervals", () => {
      for (let i = 0; i < 20; i++) {
        tree.insert({ start: i, end: i + 5, data: `interval_${i}` });
      }
      const results = tree.queryPoint(10);
      // Point 10 is covered by intervals starting at 5,6,7,8,9,10
      expect(results.length).toBeGreaterThanOrEqual(6);
    });

    it("should handle non-overlapping intervals correctly", () => {
      tree.insert({ start: 1, end: 2 });
      tree.insert({ start: 4, end: 5 });
      tree.insert({ start: 7, end: 8 });
      expect(tree.queryPoint(3)).toHaveLength(0);
      expect(tree.queryPoint(6)).toHaveLength(0);
    });
  });
});
