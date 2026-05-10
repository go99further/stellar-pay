import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventBus } from "../lib/agent/event-bus";

type TestEvents = {
  "user.created": { id: string; name: string };
  "user.deleted": { id: string };
  "order.placed": { orderId: string; amount: number };
  "order.cancelled": { orderId: string };
  ping: { ts: number };
};

describe("EventBus", () => {
  let bus: EventBus<TestEvents>;

  beforeEach(() => {
    bus = new EventBus<TestEvents>();
  });

  describe("on / emit", () => {
    it("should call handler when event is emitted", async () => {
      const handler = vi.fn();
      bus.on("ping", handler);
      await bus.emit("ping", { ts: 1 });
      expect(handler).toHaveBeenCalledWith({ ts: 1 }, "ping");
    });

    it("should call multiple handlers for same topic", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on("ping", h1);
      bus.on("ping", h2);
      await bus.emit("ping", { ts: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("should not call handler for different topic", async () => {
      const handler = vi.fn();
      bus.on("user.created", handler);
      await bus.emit("ping", { ts: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should pass typed event payload", async () => {
      const received: Array<{ id: string; name: string }> = [];
      bus.on("user.created", (e) => received.push(e));
      await bus.emit("user.created", { id: "1", name: "Alice" });
      expect(received[0]).toEqual({ id: "1", name: "Alice" });
    });
  });

  describe("once", () => {
    it("should call handler only once", async () => {
      const handler = vi.fn();
      bus.once("ping", handler);
      await bus.emit("ping", { ts: 1 });
      await bus.emit("ping", { ts: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should auto-unsubscribe after first call", async () => {
      bus.once("ping", vi.fn());
      await bus.emit("ping", { ts: 1 });
      expect(bus.subscriberCount("ping")).toBe(0);
    });
  });

  describe("unsubscribe", () => {
    it("should stop receiving events after unsubscribe", async () => {
      const handler = vi.fn();
      const unsub = bus.on("ping", handler);
      unsub();
      await bus.emit("ping", { ts: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should not affect other subscribers", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const unsub = bus.on("ping", h1);
      bus.on("ping", h2);
      unsub();
      await bus.emit("ping", { ts: 1 });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });
  });

  describe("wildcard subscriptions", () => {
    it("should match wildcard pattern", async () => {
      const handler = vi.fn();
      bus.onPattern("user.*", handler);
      await bus.emit("user.created", { id: "1", name: "Alice" });
      await bus.emit("user.deleted", { id: "1" });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should not match non-matching pattern", async () => {
      const handler = vi.fn();
      bus.onPattern("user.*", handler);
      await bus.emit("order.placed", { orderId: "o1", amount: 100 });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should match global wildcard *", async () => {
      const handler = vi.fn();
      bus.onPattern("*", handler);
      await bus.emit("ping", { ts: 1 });
      await bus.emit("user.created", { id: "1", name: "Bob" });
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("middleware", () => {
    it("should run middleware before handlers", async () => {
      const order: string[] = [];
      bus.use((_event, _topic, next) => {
        order.push("middleware");
        next();
      });
      bus.on("ping", () => order.push("handler"));
      await bus.emit("ping", { ts: 1 });
      expect(order).toEqual(["middleware", "handler"]);
    });

    it("should run multiple middlewares in order", async () => {
      const order: string[] = [];
      bus.use((_e, _t, next) => { order.push("mw1"); next(); });
      bus.use((_e, _t, next) => { order.push("mw2"); next(); });
      bus.on("ping", () => order.push("handler"));
      await bus.emit("ping", { ts: 1 });
      expect(order).toEqual(["mw1", "mw2", "handler"]);
    });

    it("should receive event and topic in middleware", async () => {
      let capturedTopic = "";
      bus.use((_event, topic, next) => {
        capturedTopic = topic;
        next();
      });
      await bus.emit("ping", { ts: 42 });
      expect(capturedTopic).toBe("ping");
    });
  });

  describe("error isolation", () => {
    it("should call onError when handler throws", async () => {
      const errors: unknown[] = [];
      const safeBus = new EventBus<TestEvents>({ onError: (err) => errors.push(err) });
      safeBus.on("ping", () => { throw new Error("boom"); });
      await safeBus.emit("ping", { ts: 1 });
      expect(errors).toHaveLength(1);
    });

    it("should still call other handlers after one throws", async () => {
      const errors: unknown[] = [];
      const safeBus = new EventBus<TestEvents>({ onError: (err) => errors.push(err) });
      const h2 = vi.fn();
      safeBus.on("ping", () => { throw new Error("boom"); });
      safeBus.on("ping", h2);
      await safeBus.emit("ping", { ts: 1 });
      expect(h2).toHaveBeenCalledTimes(1);
    });
  });

  describe("history", () => {
    it("should record emitted events", async () => {
      await bus.emit("ping", { ts: 1 });
      await bus.emit("ping", { ts: 2 });
      const history = bus.getHistory("ping");
      expect(history).toHaveLength(2);
      expect(history[0].event).toEqual({ ts: 1 });
    });

    it("should return all history when no topic filter", async () => {
      await bus.emit("ping", { ts: 1 });
      await bus.emit("user.created", { id: "1", name: "Alice" });
      expect(bus.getHistory()).toHaveLength(2);
    });

    it("should respect maxHistory limit", async () => {
      const smallBus = new EventBus<TestEvents>({ maxHistory: 3 });
      for (let i = 0; i < 5; i++) {
        await smallBus.emit("ping", { ts: i });
      }
      expect(smallBus.getHistory()).toHaveLength(3);
    });

    it("should clear history", async () => {
      await bus.emit("ping", { ts: 1 });
      bus.clearHistory();
      expect(bus.getHistory()).toHaveLength(0);
    });
  });

  describe("subscriberCount", () => {
    it("should count subscribers for a topic", () => {
      bus.on("ping", vi.fn());
      bus.on("ping", vi.fn());
      expect(bus.subscriberCount("ping")).toBe(2);
    });

    it("should count all subscribers when no topic given", () => {
      bus.on("ping", vi.fn());
      bus.on("user.created", vi.fn());
      expect(bus.subscriberCount()).toBe(2);
    });

    it("should return 0 for topic with no subscribers", () => {
      expect(bus.subscriberCount("ping")).toBe(0);
    });
  });

  describe("emitSync", () => {
    it("should call handlers synchronously", () => {
      const results: number[] = [];
      bus.on("ping", (e) => results.push(e.ts));
      bus.emitSync("ping", { ts: 99 });
      expect(results).toEqual([99]);
    });

    it("should auto-remove once handlers", () => {
      const handler = vi.fn();
      bus.once("ping", handler);
      bus.emitSync("ping", { ts: 1 });
      bus.emitSync("ping", { ts: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("clear", () => {
    it("should remove all subscriptions and history", async () => {
      const handler = vi.fn();
      bus.on("ping", handler);
      await bus.emit("ping", { ts: 1 });
      bus.clear();
      expect(bus.getHistory()).toHaveLength(0);
      expect(bus.subscriberCount()).toBe(0);
      await bus.emit("ping", { ts: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("async handlers", () => {
    it("should await async handlers", async () => {
      const results: number[] = [];
      bus.on("ping", async (e) => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(e.ts);
      });
      await bus.emit("ping", { ts: 7 });
      expect(results).toEqual([7]);
    });
  });
});
