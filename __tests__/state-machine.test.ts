import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateMachine } from "../lib/agent/state-machine";

type TrafficState = "red" | "yellow" | "green";
type TrafficEvent = "timer" | "emergency" | "reset";

type OrderState = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
type OrderEvent = "confirm" | "ship" | "deliver" | "cancel";

interface OrderContext {
  orderId: string;
  attempts: number;
}

describe("StateMachine", () => {
  describe("basic traffic light", () => {
    let sm: StateMachine<TrafficState, TrafficEvent>;

    beforeEach(() => {
      sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [
          { from: "red", event: "timer", to: "green" },
          { from: "green", event: "timer", to: "yellow" },
          { from: "yellow", event: "timer", to: "red" },
          { from: ["red", "green", "yellow"], event: "emergency", to: "red" },
          { from: ["red", "green", "yellow"], event: "reset", to: "red" },
        ],
      });
    });

    it("should start in initial state", () => {
      expect(sm.state).toBe("red");
    });

    it("should transition on valid event", async () => {
      await sm.send("timer");
      expect(sm.state).toBe("green");
    });

    it("should chain transitions", async () => {
      await sm.send("timer"); // red → green
      await sm.send("timer"); // green → yellow
      await sm.send("timer"); // yellow → red
      expect(sm.state).toBe("red");
    });

    it("should return true on successful transition", async () => {
      expect(await sm.send("timer")).toBe(true);
    });

    it("should return false on invalid event", async () => {
      expect(await sm.send("deliver" as TrafficEvent)).toBe(false);
    });

    it("should not change state on invalid event", async () => {
      await sm.send("deliver" as TrafficEvent);
      expect(sm.state).toBe("red");
    });

    it("should handle multi-from transitions", async () => {
      await sm.send("timer"); // → green
      await sm.send("emergency"); // green → red
      expect(sm.state).toBe("red");
    });

    it("can() should return true for valid event", () => {
      expect(sm.can("timer")).toBe(true);
    });

    it("can() should return false for invalid event", () => {
      expect(sm.can("deliver" as TrafficEvent)).toBe(false);
    });

    it("matches() should check current state", () => {
      expect(sm.matches("red")).toBe(true);
      expect(sm.matches("green")).toBe(false);
    });
  });

  describe("guard conditions", () => {
    it("should block transition when guard returns false", async () => {
      const sm = new StateMachine<OrderState, OrderEvent, OrderContext>({
        initial: "pending",
        context: { orderId: "o1", attempts: 0 },
        transitions: [
          {
            from: "pending",
            event: "confirm",
            to: "confirmed",
            guard: (ctx) => ctx.attempts < 3,
          },
        ],
      });
      sm.updateContext((ctx) => { ctx.attempts = 5; });
      expect(await sm.send("confirm")).toBe(false);
      expect(sm.state).toBe("pending");
    });

    it("should allow transition when guard returns true", async () => {
      const sm = new StateMachine<OrderState, OrderEvent, OrderContext>({
        initial: "pending",
        context: { orderId: "o1", attempts: 0 },
        transitions: [
          {
            from: "pending",
            event: "confirm",
            to: "confirmed",
            guard: (ctx) => ctx.attempts < 3,
          },
        ],
      });
      expect(await sm.send("confirm")).toBe(true);
      expect(sm.state).toBe("confirmed");
    });
  });

  describe("entry / exit actions", () => {
    it("should call onExit when leaving a state", async () => {
      const onExit = vi.fn();
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
        states: { red: { onExit } },
      });
      await sm.send("timer");
      expect(onExit).toHaveBeenCalledWith(expect.anything(), "green");
    });

    it("should call onEnter when entering a state", async () => {
      const onEnter = vi.fn();
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
        states: { green: { onEnter } },
      });
      await sm.send("timer");
      expect(onEnter).toHaveBeenCalledWith(expect.anything(), "red");
    });

    it("should call exit before enter", async () => {
      const order: string[] = [];
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
        states: {
          red: { onExit: () => { order.push("exit-red"); } },
          green: { onEnter: () => { order.push("enter-green"); } },
        },
      });
      await sm.send("timer");
      expect(order).toEqual(["exit-red", "enter-green"]);
    });
  });

  describe("transition actions", () => {
    it("should call action on transition", async () => {
      const action = vi.fn();
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green", action }],
      });
      await sm.send("timer");
      expect(action).toHaveBeenCalledWith(expect.anything(), "timer", "red", "green");
    });
  });

  describe("context", () => {
    it("should expose context via ctx", () => {
      const sm = new StateMachine<OrderState, OrderEvent, OrderContext>({
        initial: "pending",
        context: { orderId: "o42", attempts: 0 },
        transitions: [],
      });
      expect(sm.ctx.orderId).toBe("o42");
    });

    it("should update context via updateContext", () => {
      const sm = new StateMachine<OrderState, OrderEvent, OrderContext>({
        initial: "pending",
        context: { orderId: "o1", attempts: 0 },
        transitions: [],
      });
      sm.updateContext((ctx) => { ctx.attempts = 3; });
      expect(sm.ctx.attempts).toBe(3);
    });
  });

  describe("history", () => {
    it("should record transitions in history", async () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [
          { from: "red", event: "timer", to: "green" },
          { from: "green", event: "timer", to: "yellow" },
        ],
      });
      await sm.send("timer");
      await sm.send("timer");
      const history = sm.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ from: "red", to: "green", event: "timer" });
      expect(history[1]).toMatchObject({ from: "green", to: "yellow", event: "timer" });
    });

    it("should not record failed transitions", async () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
      });
      await sm.send("emergency"); // invalid
      expect(sm.getHistory()).toHaveLength(0);
    });

    it("should respect maxHistory limit", async () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        maxHistory: 2,
        transitions: [
          { from: "red", event: "timer", to: "green" },
          { from: "green", event: "timer", to: "yellow" },
          { from: "yellow", event: "timer", to: "red" },
          { from: "red", event: "emergency", to: "red" },
        ],
      });
      await sm.send("timer"); // red→green
      await sm.send("timer"); // green→yellow
      await sm.send("timer"); // yellow→red
      expect(sm.getHistory()).toHaveLength(2);
    });
  });

  describe("onTransition listener", () => {
    it("should notify listeners on transition", async () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
      });
      const entries: string[] = [];
      sm.onTransition((entry) => entries.push(`${entry.from}→${entry.to}`));
      await sm.send("timer");
      expect(entries).toEqual(["red→green"]);
    });

    it("should unsubscribe listener", async () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [
          { from: "red", event: "timer", to: "green" },
          { from: "green", event: "timer", to: "yellow" },
        ],
      });
      const calls: number[] = [];
      const unsub = sm.onTransition(() => calls.push(1));
      await sm.send("timer");
      unsub();
      await sm.send("timer");
      expect(calls).toHaveLength(1);
    });
  });

  describe("sendSync", () => {
    it("should transition synchronously", () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
      });
      expect(sm.sendSync("timer")).toBe(true);
      expect(sm.state).toBe("green");
    });

    it("should return false for invalid event", () => {
      const sm = new StateMachine<TrafficState, TrafficEvent>({
        initial: "red",
        transitions: [{ from: "red", event: "timer", to: "green" }],
      });
      expect(sm.sendSync("emergency")).toBe(false);
    });
  });

  describe("order workflow", () => {
    let sm: StateMachine<OrderState, OrderEvent, OrderContext>;

    beforeEach(() => {
      sm = new StateMachine<OrderState, OrderEvent, OrderContext>({
        initial: "pending",
        context: { orderId: "order-1", attempts: 0 },
        transitions: [
          { from: "pending", event: "confirm", to: "confirmed" },
          { from: "confirmed", event: "ship", to: "shipped" },
          { from: "shipped", event: "deliver", to: "delivered" },
          { from: ["pending", "confirmed"], event: "cancel", to: "cancelled" },
        ],
      });
    });

    it("should complete happy path", async () => {
      await sm.send("confirm");
      await sm.send("ship");
      await sm.send("deliver");
      expect(sm.state).toBe("delivered");
    });

    it("should allow cancellation from pending", async () => {
      await sm.send("cancel");
      expect(sm.state).toBe("cancelled");
    });

    it("should allow cancellation from confirmed", async () => {
      await sm.send("confirm");
      await sm.send("cancel");
      expect(sm.state).toBe("cancelled");
    });

    it("should not allow cancellation from shipped", async () => {
      await sm.send("confirm");
      await sm.send("ship");
      expect(await sm.send("cancel")).toBe(false);
      expect(sm.state).toBe("shipped");
    });
  });
});
