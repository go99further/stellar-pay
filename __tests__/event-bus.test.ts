import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../lib/agent/streaming/event-bus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxReplayBuffer: 20, deadLetterEnabled: true, maxRetries: 1 });
  });

  describe("subscribe / publish", () => {
    it("should deliver event to subscriber", async () => {
      const received: unknown[] = [];
      bus.subscribe("test.event", (e) => { received.push(e.payload); });

      await bus.publish("test.event", { value: 42 });
      expect(received).toHaveLength(1);
      expect((received[0] as { value: number }).value).toBe(42);
    });

    it("should deliver to multiple subscribers on same topic", async () => {
      const counts = [0, 0];
      bus.subscribe("topic", () => { counts[0]++; });
      bus.subscribe("topic", () => { counts[1]++; });

      await bus.publish("topic", "data");
      expect(counts).toEqual([1, 1]);
    });

    it("should track published and delivered stats", async () => {
      bus.subscribe("x", () => {});
      await bus.publish("x", 1);
      await bus.publish("x", 2);

      const stats = bus.getStats();
      expect(stats.published).toBe(2);
      expect(stats.delivered).toBe(2);
    });
  });

  describe("unsubscribe", () => {
    it("should stop delivering after unsubscribe", async () => {
      const received: number[] = [];
      const subId = bus.subscribe<number>("evt", (e) => { received.push(e.payload); });

      await bus.publish("evt", 1);
      bus.unsubscribe(subId);
      await bus.publish("evt", 2);

      expect(received).toEqual([1]);
    });

    it("should return false for unknown subscription id", () => {
      expect(bus.unsubscribe("nonexistent")).toBe(false);
    });
  });

  describe("once", () => {
    it("should auto-unsubscribe after first delivery", async () => {
      const received: number[] = [];
      bus.once<number>("once.topic", (e) => { received.push(e.payload); });

      await bus.publish("once.topic", 10);
      await bus.publish("once.topic", 20);

      expect(received).toEqual([10]);
    });
  });

  describe("wildcard subscriptions", () => {
    it("should match '*' to any topic", async () => {
      const topics: string[] = [];
      bus.subscribe("*", (e) => { topics.push(e.topic); });

      await bus.publish("swap.completed", null);
      await bus.publish("price.alert", null);

      expect(topics).toContain("swap.completed");
      expect(topics).toContain("price.alert");
    });

    it("should match prefix wildcard 'swap.*'", async () => {
      const received: string[] = [];
      bus.subscribe("swap.*", (e) => { received.push(e.topic); });

      await bus.publish("swap.completed", null);
      await bus.publish("swap.failed", null);
      await bus.publish("price.alert", null);

      expect(received).toContain("swap.completed");
      expect(received).toContain("swap.failed");
      expect(received).not.toContain("price.alert");
    });
  });

  describe("filter", () => {
    it("should only deliver events matching filter", async () => {
      const received: number[] = [];
      bus.subscribe<number>(
        "numbers",
        (e) => { received.push(e.payload); },
        { filter: (e) => (e.payload as number) > 5 }
      );

      await bus.publish("numbers", 3);
      await bus.publish("numbers", 7);
      await bus.publish("numbers", 10);

      expect(received).toEqual([7, 10]);
    });
  });

  describe("dead letter queue", () => {
    it("should dead-letter events with no subscribers", async () => {
      await bus.publish("unhandled.topic", "orphan");

      const dlq = bus.getDeadLetterQueue();
      expect(dlq.length).toBe(1);
      expect(dlq[0].topic).toBe("unhandled.topic");
      expect(bus.getStats().deadLettered).toBe(1);
    });

    it("should retry dead-lettered events", async () => {
      await bus.publish("retry.topic", "data");
      expect(bus.getDeadLetterQueue().length).toBe(1);

      const received: unknown[] = [];
      bus.subscribe("retry.topic", (e) => { received.push(e.payload); });

      await bus.retryDeadLetters();
      expect(received).toHaveLength(1);
      expect(bus.getDeadLetterQueue().length).toBe(0);
    });
  });

  describe("replay", () => {
    it("should replay buffered events to a new subscriber", async () => {
      await bus.publish("history", "event1");
      await bus.publish("history", "event2");

      const received: unknown[] = [];
      const subId = bus.subscribe("history", (e) => { received.push(e.payload); });

      await bus.replay(subId);
      expect(received).toContain("event1");
      expect(received).toContain("event2");
    });

    it("should replay only events after fromTimestamp", async () => {
      await bus.publish("log", "old");
      // Small delay to ensure timestamps differ
      await new Promise((r) => setTimeout(r, 5));
      const t2 = Date.now();
      await new Promise((r) => setTimeout(r, 5));
      await bus.publish("log", "new");

      const received: unknown[] = [];
      const subId = bus.subscribe("log", (e) => { received.push(e.payload); });

      await bus.replay(subId, t2);
      expect(received).toContain("new");
      expect(received).not.toContain("old");
    });
  });

  describe("middleware", () => {
    it("should run middleware before handler", async () => {
      const log: string[] = [];

      bus.use(async (event, next) => {
        log.push(`before:${event.topic}`);
        await next();
        log.push(`after:${event.topic}`);
      });

      bus.subscribe("mw.test", () => { log.push("handler"); });
      await bus.publish("mw.test", null);

      expect(log[0]).toBe("before:mw.test");
      expect(log[1]).toBe("handler");
      expect(log[2]).toBe("after:mw.test");
    });
  });

  describe("clear", () => {
    it("should remove all subscriptions", async () => {
      const received: unknown[] = [];
      bus.subscribe("topic", (e) => { received.push(e); });
      bus.clear();

      await bus.publish("topic", "data");
      expect(received).toHaveLength(0);
      expect(bus.getStats().activeSubscriptions).toBe(0);
    });
  });
});
