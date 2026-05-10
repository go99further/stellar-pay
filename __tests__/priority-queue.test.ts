import { describe, it, expect, beforeEach } from "vitest";
import { PriorityQueue, minQueue, maxQueue, priorityQueueBy } from "../lib/agent/priority-queue";

describe("PriorityQueue", () => {
  describe("min-heap (default number)", () => {
    let pq: PriorityQueue<number>;

    beforeEach(() => {
      pq = minQueue<number>();
    });

    it("should dequeue in ascending order", () => {
      pq.enqueue(5);
      pq.enqueue(1);
      pq.enqueue(3);
      expect(pq.dequeue()).toBe(1);
      expect(pq.dequeue()).toBe(3);
      expect(pq.dequeue()).toBe(5);
    });

    it("should peek without removing", () => {
      pq.enqueue(10);
      pq.enqueue(2);
      expect(pq.peek()).toBe(2);
      expect(pq.size).toBe(2);
    });

    it("should return undefined on empty dequeue", () => {
      expect(pq.dequeue()).toBeUndefined();
    });

    it("should return undefined on empty peek", () => {
      expect(pq.peek()).toBeUndefined();
    });

    it("should track size correctly", () => {
      expect(pq.size).toBe(0);
      pq.enqueue(1);
      pq.enqueue(2);
      expect(pq.size).toBe(2);
      pq.dequeue();
      expect(pq.size).toBe(1);
    });

    it("should report isEmpty correctly", () => {
      expect(pq.isEmpty).toBe(true);
      pq.enqueue(1);
      expect(pq.isEmpty).toBe(false);
    });

    it("should handle single element", () => {
      pq.enqueue(42);
      expect(pq.dequeue()).toBe(42);
      expect(pq.isEmpty).toBe(true);
    });

    it("should handle duplicate values", () => {
      pq.enqueue(3);
      pq.enqueue(3);
      pq.enqueue(1);
      expect(pq.dequeue()).toBe(1);
      expect(pq.dequeue()).toBe(3);
      expect(pq.dequeue()).toBe(3);
    });
  });

  describe("max-heap", () => {
    it("should dequeue in descending order", () => {
      const pq = maxQueue<number>();
      pq.enqueue(5);
      pq.enqueue(1);
      pq.enqueue(3);
      expect(pq.dequeue()).toBe(5);
      expect(pq.dequeue()).toBe(3);
      expect(pq.dequeue()).toBe(1);
    });
  });

  describe("bulk insert (heapify)", () => {
    it("should build heap from initial items", () => {
      const pq = new PriorityQueue<number>((a, b) => a - b, [5, 3, 1, 4, 2]);
      const result: number[] = [];
      while (!pq.isEmpty) result.push(pq.dequeue()!);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle single-item initial array", () => {
      const pq = new PriorityQueue<number>((a, b) => a - b, [42]);
      expect(pq.dequeue()).toBe(42);
    });
  });

  describe("toArray", () => {
    it("should return sorted array without mutating queue", () => {
      const pq = minQueue<number>();
      pq.enqueue(3);
      pq.enqueue(1);
      pq.enqueue(2);
      expect(pq.toArray()).toEqual([1, 2, 3]);
      expect(pq.size).toBe(3); // not mutated
    });
  });

  describe("clear", () => {
    it("should empty the queue", () => {
      const pq = minQueue<number>();
      pq.enqueue(1);
      pq.enqueue(2);
      pq.clear();
      expect(pq.isEmpty).toBe(true);
      expect(pq.size).toBe(0);
    });
  });

  describe("has", () => {
    it("should return true when item exists", () => {
      const pq = minQueue<number>();
      pq.enqueue(5);
      expect(pq.has((x) => x === 5)).toBe(true);
    });

    it("should return false when item not found", () => {
      const pq = minQueue<number>();
      pq.enqueue(5);
      expect(pq.has((x) => x === 99)).toBe(false);
    });
  });

  describe("remove", () => {
    it("should remove a specific item", () => {
      const pq = minQueue<number>();
      pq.enqueue(1);
      pq.enqueue(2);
      pq.enqueue(3);
      const removed = pq.remove((x) => x === 2);
      expect(removed).toBe(true);
      expect(pq.size).toBe(2);
      expect(pq.toArray()).toEqual([1, 3]);
    });

    it("should return false when item not found", () => {
      const pq = minQueue<number>();
      pq.enqueue(1);
      expect(pq.remove((x) => x === 99)).toBe(false);
    });

    it("should maintain heap property after removal", () => {
      const pq = minQueue<number>();
      [5, 3, 8, 1, 4, 7, 2].forEach((n) => pq.enqueue(n));
      pq.remove((x) => x === 3);
      const result: number[] = [];
      while (!pq.isEmpty) result.push(pq.dequeue()!);
      expect(result).toEqual([1, 2, 4, 5, 7, 8]);
    });
  });

  describe("iterator", () => {
    it("should iterate in priority order", () => {
      const pq = minQueue<number>();
      pq.enqueue(3);
      pq.enqueue(1);
      pq.enqueue(2);
      const result = [...pq];
      expect(result).toEqual([1, 2, 3]);
    });

    it("should not mutate original queue during iteration", () => {
      const pq = minQueue<number>();
      pq.enqueue(1);
      pq.enqueue(2);
      [...pq]; // iterate
      expect(pq.size).toBe(2);
    });
  });

  describe("priorityQueueBy", () => {
    interface Task {
      name: string;
      priority: number;
    }

    it("should order by key ascending (lowest priority first)", () => {
      const pq = priorityQueueBy<Task>((t) => t.priority, "asc");
      pq.enqueue({ name: "low", priority: 3 });
      pq.enqueue({ name: "high", priority: 1 });
      pq.enqueue({ name: "mid", priority: 2 });
      expect(pq.dequeue()?.name).toBe("high");
      expect(pq.dequeue()?.name).toBe("mid");
      expect(pq.dequeue()?.name).toBe("low");
    });

    it("should order by key descending (highest priority first)", () => {
      const pq = priorityQueueBy<Task>((t) => t.priority, "desc");
      pq.enqueue({ name: "low", priority: 1 });
      pq.enqueue({ name: "high", priority: 10 });
      pq.enqueue({ name: "mid", priority: 5 });
      expect(pq.dequeue()?.name).toBe("high");
    });

    it("should work with large datasets", () => {
      const pq = priorityQueueBy<number>((n) => n);
      const nums = Array.from({ length: 100 }, (_, i) => 100 - i);
      nums.forEach((n) => pq.enqueue(n));
      const result: number[] = [];
      while (!pq.isEmpty) result.push(pq.dequeue()!);
      expect(result[0]).toBe(1);
      expect(result[99]).toBe(100);
    });
  });
});
