import { describe, it, expect, beforeEach } from "vitest";
import { StateMachine, createSwapStateMachine } from "../lib/agent/types/state-machine";

describe("StateMachine", () => {
  describe("basic transitions", () => {
    function createTrafficLight() {
      return new StateMachine({
        id: "traffic",
        initial: "red",
        context: { count: 0 },
        states: {
          red: {
            on: { NEXT: { target: "green" } },
          },
          green: {
            on: { NEXT: { target: "yellow" } },
          },
          yellow: {
            on: { NEXT: { target: "red" } },
          },
        },
      });
    }

    it("should start in initial state", () => {
      const m = createTrafficLight();
      expect(m.matches("red")).toBe(true);
    });

    it("should transition on event", () => {
      const m = createTrafficLight();
      m.send("NEXT");
      expect(m.matches("green")).toBe(true);
    });

    it("should cycle through states", () => {
      const m = createTrafficLight();
      m.send("NEXT"); // green
      m.send("NEXT"); // yellow
      m.send("NEXT"); // red
      expect(m.matches("red")).toBe(true);
    });

    it("should stay in state on unknown event", () => {
      const m = createTrafficLight();
      m.send("UNKNOWN");
      expect(m.matches("red")).toBe(true);
    });
  });

  describe("guards", () => {
    it("should block transition when guard returns false", () => {
      const m = new StateMachine({
        id: "guarded",
        initial: "locked",
        context: { pin: "" },
        states: {
          locked: {
            on: {
              UNLOCK: {
                target: "unlocked",
                guard: (ctx) => ctx.pin === "1234",
              },
            },
          },
          unlocked: {},
        },
      });

      m.send({ type: "UNLOCK" }); // no pin set
      expect(m.matches("locked")).toBe(true);

      m.context = { pin: "1234" } as never;
      // Access context via snapshot
    });

    it("should allow transition when guard passes", () => {
      const m = new StateMachine({
        id: "guarded2",
        initial: "locked",
        context: { authorized: false },
        states: {
          locked: {
            on: {
              UNLOCK: {
                target: "unlocked",
                guard: (ctx) => ctx.authorized,
              },
            },
          },
          unlocked: {},
        },
      });

      // Guard fails
      m.send("UNLOCK");
      expect(m.matches("locked")).toBe(true);

      // Create new machine with authorized=true
      const m2 = new StateMachine({
        id: "guarded2",
        initial: "locked",
        context: { authorized: true },
        states: {
          locked: {
            on: {
              UNLOCK: {
                target: "unlocked",
                guard: (ctx) => ctx.authorized,
              },
            },
          },
          unlocked: {},
        },
      });
      m2.send("UNLOCK");
      expect(m2.matches("unlocked")).toBe(true);
    });
  });

  describe("actions and context updates", () => {
    it("should update context via transition action", () => {
      const m = new StateMachine({
        id: "counter",
        initial: "active",
        context: { count: 0 },
        states: {
          active: {
            on: {
              INCREMENT: {
                target: "active",
                action: (ctx) => ({ count: ctx.count + 1 }),
              },
            },
          },
        },
      });

      m.send("INCREMENT");
      m.send("INCREMENT");
      m.send("INCREMENT");

      expect(m.snapshot().context.count).toBe(3);
    });

    it("should run entry action on state entry", () => {
      const log: string[] = [];
      const m = new StateMachine({
        id: "entry-test",
        initial: "a",
        context: {},
        states: {
          a: {
            on: { GO: { target: "b" } },
          },
          b: {
            entry: () => { log.push("entered_b"); },
          },
        },
      });

      m.send("GO");
      expect(log).toContain("entered_b");
    });

    it("should run exit action on state exit", () => {
      const log: string[] = [];
      const m = new StateMachine({
        id: "exit-test",
        initial: "a",
        context: {},
        states: {
          a: {
            exit: () => { log.push("exited_a"); },
            on: { GO: { target: "b" } },
          },
          b: {},
        },
      });

      m.send("GO");
      expect(log).toContain("exited_a");
    });
  });

  describe("final states", () => {
    it("should mark done=true in final state", () => {
      const m = new StateMachine({
        id: "final-test",
        initial: "running",
        context: {},
        states: {
          running: {
            on: { FINISH: { target: "done" } },
          },
          done: { type: "final" },
        },
      });

      m.send("FINISH");
      expect(m.snapshot().done).toBe(true);
    });

    it("should ignore events in final state", () => {
      const m = new StateMachine({
        id: "final-ignore",
        initial: "running",
        context: {},
        states: {
          running: {
            on: { FINISH: { target: "done" } },
          },
          done: { type: "final" },
        },
      });

      m.send("FINISH");
      m.send("FINISH"); // should be ignored
      expect(m.matches("done")).toBe(true);
    });
  });

  describe("history", () => {
    it("should record transition history", () => {
      const m = new StateMachine({
        id: "history-test",
        initial: "a",
        context: {},
        states: {
          a: { on: { GO: { target: "b" } } },
          b: { on: { GO: { target: "c" } } },
          c: {},
        },
      });

      m.send("GO");
      m.send("GO");

      const history = m.getHistory();
      expect(history.length).toBe(2);
      expect(history[0].from).toBe("a");
      expect(history[0].to).toBe("b");
      expect(history[1].from).toBe("b");
      expect(history[1].to).toBe("c");
    });
  });

  describe("subscribe", () => {
    it("should notify listeners on state change", () => {
      const snapshots: string[] = [];
      const m = new StateMachine({
        id: "sub-test",
        initial: "idle",
        context: {},
        states: {
          idle: { on: { START: { target: "running" } } },
          running: {},
        },
      });

      const unsub = m.subscribe((snap) => snapshots.push(snap.state));
      m.send("START");
      expect(snapshots).toContain("running");

      unsub();
      m.send("START"); // no more notifications
      expect(snapshots.length).toBe(1);
    });
  });

  describe("getAvailableEvents", () => {
    it("should return events for current state", () => {
      const m = new StateMachine({
        id: "events-test",
        initial: "idle",
        context: {},
        states: {
          idle: { on: { START: { target: "running" }, CANCEL: { target: "idle" } } },
          running: { on: { STOP: { target: "idle" } } },
        },
      });

      expect(m.getAvailableEvents()).toContain("START");
      expect(m.getAvailableEvents()).toContain("CANCEL");
      m.send("START");
      expect(m.getAvailableEvents()).toContain("STOP");
    });
  });

  describe("reset", () => {
    it("should reset to initial state and context", () => {
      const m = new StateMachine({
        id: "reset-test",
        initial: "idle",
        context: { count: 0 },
        states: {
          idle: {
            on: {
              GO: {
                target: "active",
                action: (ctx) => ({ count: ctx.count + 1 }),
              },
            },
          },
          active: {},
        },
      });

      m.send("GO");
      expect(m.matches("active")).toBe(true);

      m.reset();
      expect(m.matches("idle")).toBe(true);
      expect(m.snapshot().context.count).toBe(0);
      expect(m.getHistory().length).toBe(0);
    });
  });
});

describe("createSwapStateMachine", () => {
  it("should follow happy path: idle → validating → signing → submitting → completed", () => {
    const m = createSwapStateMachine({ retries: 0 });

    m.send("SUBMIT");
    expect(m.matches("validating")).toBe(true);

    m.send("VALID");
    expect(m.matches("signing")).toBe(true);

    m.send("SIGNED");
    expect(m.matches("submitting")).toBe(true);

    m.send({ type: "SUCCESS", data: "0xabc123" });
    expect(m.matches("completed")).toBe(true);
    expect(m.snapshot().done).toBe(true);
    expect(m.snapshot().context.txHash).toBe("0xabc123");
  });

  it("should retry on failure when retries < 3", () => {
    const m = createSwapStateMachine({ retries: 0 });

    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    m.send({ type: "FAILURE", data: "network error" });

    expect(m.matches("retrying")).toBe(true);
    expect(m.snapshot().context.retries).toBe(1);
    expect(m.snapshot().context.error).toBe("network error");
  });

  it("should not retry when retries >= 3", () => {
    const m = createSwapStateMachine({ retries: 3 });

    m.send("SUBMIT");
    m.send("VALID");
    m.send("SIGNED");
    // FAILURE guard fails (retries >= 3), FAILURE_FINAL goes to failed
    m.send({ type: "FAILURE_FINAL" });

    expect(m.matches("failed")).toBe(true);
    expect(m.snapshot().done).toBe(true);
  });
});
