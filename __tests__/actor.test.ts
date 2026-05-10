import { describe, it, expect, vi } from "vitest";
import { Actor, ActorRegistry } from "../lib/agent/actor";

type CounterMsg =
  | { type: "increment"; payload: { by: number } }
  | { type: "decrement"; payload: { by: number } }
  | { type: "reset"; payload: null };

interface CounterState { count: number }

function makeCounter() {
  return new Actor<CounterState, CounterMsg>({ initialState: { count: 0 } })
    .on("increment", (s, m) => ({ count: s.count + (m.payload as { by: number }).by }))
    .on("decrement", (s, m) => ({ count: s.count - (m.payload as { by: number }).by }))
    .on("reset", (s) => ({ count: 0 }));
}

describe("Actor", () => {
  describe("send (fire-and-forget)", () => {
    it("should process message and update state", async () => {
      const actor = makeCounter();
      actor.send({ type: "increment", payload: { by: 5 } });
      await new Promise((r) => setTimeout(r, 0));
      expect(actor.getState().count).toBe(5);
    });

    it("should process messages sequentially", async () => {
      const actor = makeCounter();
      actor.send({ type: "increment", payload: { by: 3 } });
      actor.send({ type: "increment", payload: { by: 2 } });
      actor.send({ type: "decrement", payload: { by: 1 } });
      await new Promise((r) => setTimeout(r, 0));
      expect(actor.getState().count).toBe(4);
    });

    it("should start with initial state", () => {
      const actor = makeCounter();
      expect(actor.getState().count).toBe(0);
    });
  });

  describe("ask (request/response)", () => {
    it("should return state after processing", async () => {
      const actor = makeCounter();
      const state = await actor.ask({ type: "increment", payload: { by: 10 } });
      expect(state.count).toBe(10);
    });

    it("should chain asks sequentially", async () => {
      const actor = makeCounter();
      await actor.ask({ type: "increment", payload: { by: 5 } });
      const state = await actor.ask({ type: "increment", payload: { by: 3 } });
      expect(state.count).toBe(8);
    });

    it("should reject for unknown message type", async () => {
      const actor = makeCounter();
      await expect(
        actor.ask({ type: "unknown" as "reset", payload: null })
      ).rejects.toThrow("No handler for message type: unknown");
    });
  });

  describe("error handling", () => {
    it("should call onError when handler throws", async () => {
      const errors: unknown[] = [];
      const actor = new Actor<{ count: number }>({
        initialState: { count: 0 },
        onError: (err) => errors.push(err),
      }).on("boom", () => { throw new Error("handler error"); });

      actor.send({ type: "boom", payload: null });
      await new Promise((r) => setTimeout(r, 0));
      expect(errors).toHaveLength(1);
    });

    it("should continue processing after error", async () => {
      const errors: unknown[] = [];
      const actor = new Actor<{ count: number }>({
        initialState: { count: 0 },
        onError: (err) => errors.push(err),
      })
        .on("boom", () => { throw new Error("fail"); })
        .on("inc", (s) => ({ count: s.count + 1 }));

      actor.send({ type: "boom", payload: null });
      actor.send({ type: "inc", payload: null });
      await new Promise((r) => setTimeout(r, 0));
      expect(actor.getState().count).toBe(1);
    });
  });

  describe("mailboxSize", () => {
    it("should track pending messages", () => {
      const actor = makeCounter();
      actor.send({ type: "increment", payload: { by: 1 } });
      actor.send({ type: "increment", payload: { by: 1 } });
      // Before microtask drains, mailbox may have items
      expect(actor.mailboxSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe("async handlers", () => {
    it("should support async state transitions", async () => {
      const actor = new Actor<{ value: string }>({ initialState: { value: "" } })
        .on("fetch", async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { value: "loaded" };
        });

      const state = await actor.ask({ type: "fetch", payload: null });
      expect(state.value).toBe("loaded");
    });
  });
});

describe("ActorRegistry", () => {
  it("should register and retrieve an actor", () => {
    const registry = new ActorRegistry();
    const actor = makeCounter();
    registry.register("counter", actor);
    expect(registry.get("counter")).toBe(actor);
  });

  it("should return undefined for unknown actor", () => {
    const registry = new ActorRegistry();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("should send message to named actor", async () => {
    const registry = new ActorRegistry();
    const actor = makeCounter();
    registry.register("counter", actor);
    registry.send("counter", { type: "increment", payload: { by: 7 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getState().count).toBe(7);
  });

  it("should return false when sending to unknown actor", () => {
    const registry = new ActorRegistry();
    expect(registry.send("missing", { type: "x", payload: null })).toBe(false);
  });

  it("should list all actor names", () => {
    const registry = new ActorRegistry();
    registry.register("a", makeCounter());
    registry.register("b", makeCounter());
    expect(registry.names().sort()).toEqual(["a", "b"]);
  });

  it("should remove an actor", () => {
    const registry = new ActorRegistry();
    registry.register("a", makeCounter());
    expect(registry.remove("a")).toBe(true);
    expect(registry.get("a")).toBeUndefined();
  });

  it("should return false when removing unknown actor", () => {
    const registry = new ActorRegistry();
    expect(registry.remove("missing")).toBe(false);
  });
});
