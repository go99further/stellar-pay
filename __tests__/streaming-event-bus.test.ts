import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBus, eventBus } from "../lib/agent/streaming/event-bus";

describe("EventBus (streaming/event-bus)", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus({ maxReplayBuffer: 50, deadLetterEnabled: true, maxRetries: 3 });
  });

  describe("subscribe / publish", () => {
    it("should deliver event to subscriber", async () => {
      const received: unknown[] = [];
      bus.subscribe("test.topic", (evt) => { received.push(evt.payload); });
      await bus.publish("test.topic", { value: 42 });
      expect(received).toHaveLength(1);
      expect((received[0] as { value: number }).value).toBe(42);
    });

    it("should return a subscription ID starting with sub_", () => {
      const id = bus.subscribe("topic", vi.fn());
      expect(id.startsWith("sub_")).toBe(true);
    });

    it("should deliver to multiple subscribers on same topic", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe("topic", h1);
      bus.subscribe("topic", h2);
      await bus.publish("topic", "data");
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("should not deliver to subscriber on different topic", async () => {
      const handler = vi.fn();
      bus.subscribe("other.topic", handler);
      await bus.publish("test.topic", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should include event metadata in envelope", async () => {
      let envelope: unknown;
      bus.subscribe("topic", (evt) => { envelope = evt; });
      await bus.publish("topic", "payload", { source: "test", correlationId: "corr-1" });
      const env = envelope as { id: string; topic: string; source: string; correlationId: string };
      expect(env.id.startsWith("evt_")).toBe(true);
      expect(env.topic).toBe("topic");
      expect(env.source).toBe("test");
      expect(env.correlationId).toBe("corr-1");
    });
  });

  describe("once subscription", () => {
    it("should auto-unsubscribe after first delivery", async () => {
      const handler = vi.fn();
      bus.once("topic", handler);
      await bus.publish("topic", "first");
      await bus.publish("topic", "second");
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("unsubscribe", () => {
    it("should stop receiving events after unsubscribe", async () => {
      const handler = vi.fn();
      const id = bus.subscribe("topic", handler);
      bus.unsubscribe(id);
      await bus.publish("topic", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should return true when unsubscribing existing subscription", () => {
      const id = bus.subscribe("topic", vi.fn());
      expect(bus.unsubscribe(id)).toBe(true);
    });

    it("should return false for unknown subscription ID", () => {
      expect(bus.unsubscribe("sub_nonexistent")).toBe(false);
    });

    it("should decrement activeSubscriptions count", () => {
      const id = bus.subscribe("topic", vi.fn());
      const before = bus.getStats().activeSubscriptions;
      bus.unsubscribe(id);
      expect(bus.getStats().activeSubscriptions).toBe(before - 1);
    });
  });

  describe("wildcard subscriptions", () => {
    it("should match * wildcard for any topic", async () => {
      const handler = vi.fn();
      bus.subscribe("*", handler);
      await bus.publish("swap.completed", "data");
      await bus.publish("liquidity.added", "data");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should match prefix wildcard swap.*", async () => {
      const handler = vi.fn();
      bus.subscribe("swap.*", handler);
      await bus.publish("swap.completed", "data");
      await bus.publish("swap.failed", "data");
      await bus.publish("liquidity.added", "data");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should not match prefix wildcard for different prefix", async () => {
      const handler = vi.fn();
      bus.subscribe("swap.*", handler);
      await bus.publish("liquidity.added", "data");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("filter option", () => {
    it("should only deliver events matching filter", async () => {
      const received: number[] = [];
      bus.subscribe<{ amount: number }>(
        "swap",
        (evt) => { received.push(evt.payload.amount); },
        { filter: (evt) => (evt.payload as { amount: number }).amount > 100 }
      );
      await bus.publish("swap", { amount: 50 });
      await bus.publish("swap", { amount: 200 });
      expect(received).toEqual([200]);
    });
  });

  describe("middleware", () => {
    it("should run middleware before handler", async () => {
      const order: string[] = [];
      bus.use(async (_evt, next) => {
        order.push("middleware");
        await next();
      });
      bus.subscribe("topic", () => { order.push("handler"); });
      await bus.publish("topic", "data");
      expect(order).toEqual(["middleware", "handler"]);
    });

    it("should run multiple middlewares in order", async () => {
      const order: string[] = [];
      bus.use(async (_e, next) => { order.push("mw1"); await next(); });
      bus.use(async (_e, next) => { order.push("mw2"); await next(); });
      bus.subscribe("topic", () => { order.push("handler"); });
      await bus.publish("topic", "data");
      expect(order).toEqual(["mw1", "mw2", "handler"]);
    });
  });

  describe("dead letter queue", () => {
    it("should add to dead letter queue when no subscribers", async () => {
      await bus.publish("unhandled.topic", "data");
      expect(bus.getDeadLetterQueue()).toHaveLength(1);
    });

    it("should not add to dead letter queue when deadLetterEnabled=false", async () => {
      const noDlq = new EventBus({ deadLetterEnabled: false });
      await noDlq.publish("unhandled", "data");
      expect(noDlq.getDeadLetterQueue()).toHaveLength(0);
    });

    it("should retry dead-lettered events", async () => {
      await bus.publish("unhandled.topic", "data");
      const handler = vi.fn();
      bus.subscribe("unhandled.topic", handler);
      const retried = await bus.retryDeadLetters();
      expect(retried).toBe(1);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("replay", () => {
    it("should replay buffered events to a subscriber", async () => {
      await bus.publish("topic", "first");
      await bus.publish("topic", "second");
      const received: unknown[] = [];
      const id = bus.subscribe("topic", (evt) => { received.push(evt.payload); });
      await bus.replay(id);
      expect(received).toContain("first");
      expect(received).toContain("second");
    });

    it("should replay only events from given timestamp", async () => {
      await bus.publish("topic", "old");
      // Add a small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 5));
      const ts = Date.now();
      await bus.publish("topic", "new");
      const received: unknown[] = [];
      const id = bus.subscribe("topic", (evt) => { received.push(evt.payload); });
      await bus.replay(id, ts);
      expect(received).toContain("new");
      expect(received).not.toContain("old");
    });

    it("should return 0 for unknown subscription ID", async () => {
      const count = await bus.replay("sub_nonexistent");
      expect(count).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should track published count", async () => {
      await bus.publish("topic", "a");
      await bus.publish("topic", "b");
      expect(bus.getStats().published).toBe(2);
    });

    it("should track delivered count", async () => {
      bus.subscribe("topic", vi.fn());
      await bus.publish("topic", "a");
      expect(bus.getStats().delivered).toBe(1);
    });

    it("should track activeSubscriptions", () => {
      bus.subscribe("topic", vi.fn());
      bus.subscribe("topic", vi.fn());
      expect(bus.getStats().activeSubscriptions).toBe(2);
    });
  });

  describe("clear", () => {
    it("should remove all subscriptions", async () => {
      const handler = vi.fn();
      bus.subscribe("topic", handler);
      bus.clear();
      await bus.publish("topic", "data");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should reset activeSubscriptions to 0", () => {
      bus.subscribe("topic", vi.fn());
      bus.clear();
      expect(bus.getStats().activeSubscriptions).toBe(0);
    });
  });

  describe("global instance", () => {
    it("should export a global eventBus instance", () => {
      expect(eventBus).toBeInstanceOf(EventBus);
    });
  });
});
