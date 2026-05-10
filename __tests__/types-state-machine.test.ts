import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine, createSwapStateMachine } from "../lib/agent/types/state-machine";

describe("StateMachine (types/state-machine)", () => {
  function makeTrafficLight() {
    return new StateMachine<{ count: number }>({
      id: "traffic",
      initial: "red",
      context: { count: 0 },
      states: {
        red: { on: { GO: { target: "green" } } },
        green: { on: { SLOW: { target: "yellow" } } },
        yellow: { on: { STOP: { target: "red" } } },
      },
    });
  }

  describe("basic transitions", () => {
    it("should start in initial state", () => {
      const m = makeTrafficLight();
      expect(m.matches("red")).toBe(true);
    });

    it("should transition on valid event string", () => {
      const m = makeTrafficLight();
      const snap = m.send("GO");
      expect(snap.state).toBe("green");
    });

    it("should transition on event object", () => {
      const m = makeTrafficLight();
      const snap = m.send({ type: "GO" });
      expect(snap.state).toBe("green");
    });

    it("should stay in current state for unknown event", () => {
      const m = makeTrafficLight();
      const snap = m.send("UNKNOWN");
      expect(snap.state).toBe("red");
    });

    it("should chain multiple transitions", () => {
      const m = makeTrafficLight();
      m.send("GO");
      m.send("SLOW");
      expect(m.matches("yellow")).toBe(true);
    });
  });

  describe("context updates via actions", () => {
    it("should update context via transition action returning new context", () => {
      const m = new StateMachine<{ value: number }>({
        id: "counter",
        initial: "idle",
        context: { value: 0 },
        states: {
          idle: {
            on: {
              INC: { target: "idle", action: (ctx) => ({ value: ctx.value + 1 }) },
            },
          },
        },
      });
      m.send("INC");
      m.send("INC");
      expect(m.snapshot().context.value).toBe(2);
    });

    it("should run entry action on initial state construction", () => {
      const m = new StateMachine<{ initialized: boolean }>({
        id: "test",
        initial: "start",
        context: { initialized: false },
        states: {
          start: {
            entry: (ctx) => ({ ...ctx, initialized: true }),
            on: {},
          },
        },
      });
      expect(m.snapshot().context.initialized).toBe(true);
    });

    it("should run exit action when leaving state", () => {
      const exited: string[] = [];
      const m = new StateMachine<{ count: number }>({
        id: "test",
        initial: "a",
        context: { count: 0 },
        states: {
          a: {
            exit: () => { exited.push("exit-a"); },
            on: { NEXT: { target: "b" } },
          },
          b: { on: {} },
        },
      });
      m.send("NEXT");
      expect(exited).toContain("exit-a");
    });

    it("should run entry action when entering new state", () => {
      const m = new StateMachine<{ entered: string }>({
        id: "test",
        initial: "a",
        context: { entered: "" },
        states: {
          a: { on: { NEXT: { target: "b" } } },
          b: {
            entry: (ctx) => ({ ...ctx, entered: "b" }),
            on: {},
          },
        },
      });
      m.send("NEXT");
      expect(m.snapshot().context.entered).toBe("b");
    });
  });

  describe("guards", () => {
    it("should block transition when guard returns false", () => {
      const m = new StateMachine<{ allowed: boolean }>({
        id: "guarded",
        initial: "locked",
        context: { allowed: false },
        states: {
          locked: {
            on: { UNLOCK: { target: "open", guard: (ctx) => ctx.allowed } },
          },
          open: { on: {} },
        },
      });
      m.send("UNLOCK");
      expect(m.matches("locked")).toBe(true);
    });

    it("should allow transition when guard returns true", () => {
      const m = new StateMachine<{ allowed: boolean }>({
        id: "guarded",
        initial: "locked",
        context: { allowed: true },
        states: {
          locked: {
            on: { UNLOCK: { target: "open", guard: (ctx) => ctx.allowed } },
          },
          open: { on: {} },
        },
      });
      m.send("UNLOCK");
      expect(m.matches("open")).toBe(true);
    });

    it("should try next transition in array when first guard fails", () => {
      const m = new StateMachine<{ value: number }>({
        id: "multi",
        initial: "start",
        context: { value: 5 },
        states: {
          start: {
            on: {
              CHECK: [
                { target: "high", guard: (ctx) => ctx.value > 10 },
                { target: "low", guard: (ctx) => ctx.value <= 10 },
              ],
            },
          },
          high: { on: {} },
          low: { on: {} },
        },
      });
      m.send("CHECK");
      expect(m.matches("low")).toBe(true);
    });
  });

  describe("final states", () => {
    it("should mark done=true for final state", () => {
      const m = new StateMachine({
        id: "test",
        initial: "running",
        context: {},
        states: {
          running: { on: { FINISH: { target: "done" } } },
          done: { type: "final" },
        },
      });
      m.send("FINISH");
      expect(m.snapshot().done).toBe(true);
    });

    it("should ignore events in final state", () => {
      const m = new StateMachine({
        id: "test",
        initial: "done",
        context: {},
        states: { done: { type: "final" } },
      });
      const snap = m.send("ANYTHING");
      expect(snap.state).toBe("done");
    });
  });

  describe("history", () => {
    it("should record transition history", () => {
      const m = makeTrafficLight();
      m.send("GO");
      m.send("SLOW");
      const history = m.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].from).toBe("red");
      expect(history[0].to).toBe("green");
    });

    it("should include event and timestamp in history entry", () => {
      const m = makeTrafficLight();
      m.send({ type: "GO", data: "payload" });
      const h = m.getHistory();
      expect(h[0].event.type).toBe("GO");
      expect(typeof h[0].timestamp).toBe("number");
    });

    it("should return a copy of history", () => {
      const m = makeTrafficLight();
      m.send("GO");
      expect(m.getHistory()).not.toBe(m.getHistory());
    });
  });

  describe("subscribe", () => {
    it("should call listener on each transition", () => {
      const m = makeTrafficLight();
      const states: string[] = [];
      m.subscribe((snap) => states.push(snap.state));
      m.send("GO");
      m.send("SLOW");
      expect(states).toEqual(["green", "yellow"]);
    });

    it("should unsubscribe when returned function is called", () => {
      const m = makeTrafficLight();
      const calls: string[] = [];
      const unsub = m.subscribe((snap) => calls.push(snap.state));
      m.send("GO");
      unsub();
      m.send("SLOW");
      expect(calls).toHaveLength(1);
    });
  });

  describe("getAvailableEvents", () => {
    it("should return events for current state", () => {
      const m = makeTrafficLight();
      expect(m.getAvailableEvents()).toEqual(["GO"]);
    });

    it("should update after transition", () => {
      const m = makeTrafficLight();
      m.send("GO");
      expect(m.getAvailableEvents()).toEqual(["SLOW"]);
    });
  });

  describe("reset", () => {
    it("should reset to initial state and clear history", () => {
      const m = makeTrafficLight();
      m.send("GO");
      m.send("SLOW");
      m.reset();
      expect(m.matches("red")).toBe(true);
      expect(m.getHistory()).toHaveLength(0);
    });

    it("should reset context to initial values", () => {
      const m = new StateMachine<{ count: number }>({
        id: "c",
        initial: "idle",
        context: { count: 0 },
        states: {
          idle: {
            on: { INC: { target: "idle", action: (ctx) => ({ count: ctx.count + 1 }) } },
          },
        },
      });
      m.send("INC");
      m.send("INC");
      m.reset();
      expect(m.snapshot().context.count).toBe(0);
    });
  });

  describe("snapshot", () => {
    it("should return current state, context, and done flag", () => {
      const m = makeTrafficLight();
      const snap = m.snapshot();
      expect(snap.state).toBe("red");
      expect(snap.done).toBe(false);
      expect(typeof snap.context).toBe("object");
    });

    it("should return a copy of context (not reference)", () => {
      const m = makeTrafficLight();
      expect(m.snapshot().context).not.toBe(m.snapshot().context);
    });
  });
});

describe("createSwapStateMachine", () => {
  it("should start in idle state", () => {
    const m = createSwapStateMachine({ retries: 0 });
    expect(m.matches("idle")).toBe(true);
  });

  it("should follow happy path: idle → validating → signing → submitting → completed", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    expect(m.matches("validating")).toBe(true);
    m.send("VALID");
    expect(m.matches("signing")).toBe(true);
    m.send("SIGNED");
    expect(m.matches("submitting")).toBe(true);
    const snap = m.send({ type: "SUCCESS", data: "txhash_abc" });
    expect(snap.state).toBe("completed");
    expect(snap.done).toBe(true);
    expect(snap.context.txHash).toBe("txhash_abc");
  });

  it("should retry on FAILURE when retries < 3", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send({ type: "FAILURE", data: "network error" });
    expect(m.matches("retrying")).toBe(true);
    expect(m.snapshot().context.retries).toBe(1);
    expect(m.snapshot().context.error).toBe("network error");
  });

  it("should not retry when retries >= 3 (guard blocks transition)", () => {
    const m = createSwapStateMachine({ retries: 3 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send({ type: "FAILURE", data: "error" });
    expect(m.matches("submitting")).toBe(true);
  });

  it("should go to failed on FAILURE_FINAL", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send("FAILURE_FINAL");
    expect(m.matches("failed")).toBe(true);
    expect(m.snapshot().done).toBe(true);
  });

  it("should go to failed on INVALID", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("INVALID");
    expect(m.matches("failed")).toBe(true);
  });

  it("should go to failed on REJECTED", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("REJECTED");
    expect(m.matches("failed")).toBe(true);
  });

  it("should retry → submitting on RETRY", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send({ type: "FAILURE", data: "err" });
    m.send("RETRY");
    expect(m.matches("submitting")).toBe(true);
  });

  it("should abort from retrying to failed", () => {
    const m = createSwapStateMachine({ retries: 0 });
    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send({ type: "FAILURE", data: "err" });
    m.send("ABORT");
    expect(m.matches("failed")).toBe(true);
  });
});
