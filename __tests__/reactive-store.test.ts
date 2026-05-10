import { describe, it, expect, beforeEach } from "vitest";
import { ReactiveStore, createStore } from "../lib/agent/types/reactive-store";

interface CounterState {
  count: number;
  lastAction: string;
}

type CounterAction =
  | { type: "INCREMENT"; payload?: number }
  | { type: "DECREMENT"; payload?: number }
  | { type: "RESET" };

function counterReducer(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case "INCREMENT":
      return { ...state, count: state.count + (action.payload ?? 1), lastAction: "INCREMENT" };
    case "DECREMENT":
      return { ...state, count: state.count - (action.payload ?? 1), lastAction: "DECREMENT" };
    case "RESET":
      return { count: 0, lastAction: "RESET" };
    default:
      return state;
  }
}

describe("ReactiveStore", () => {
  let store: ReactiveStore<CounterState>;

  beforeEach(() => {
    store = createStore<CounterState, CounterAction>({ count: 0, lastAction: "" }, counterReducer);
  });

  describe("getState / dispatch", () => {
    it("should return initial state", () => {
      expect(store.getState().count).toBe(0);
    });

    it("should update state on dispatch", () => {
      store.dispatch({ type: "INCREMENT" });
      expect(store.getState().count).toBe(1);
    });

    it("should apply payload", () => {
      store.dispatch({ type: "INCREMENT", payload: 5 });
      expect(store.getState().count).toBe(5);
    });

    it("should handle multiple dispatches", () => {
      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "DECREMENT" });
      expect(store.getState().count).toBe(1);
    });

    it("should not mutate state on unknown action", () => {
      const before = store.getState();
      store.dispatch({ type: "UNKNOWN" });
      expect(store.getState()).toBe(before);
    });
  });

  describe("subscribe", () => {
    it("should notify subscriber on state change", () => {
      const states: number[] = [];
      store.subscribe((state) => states.push(state.count));

      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "INCREMENT" });

      expect(states).toEqual([1, 2]);
    });

    it("should provide previous state to subscriber", () => {
      const pairs: Array<[number, number]> = [];
      store.subscribe((state, prev) => pairs.push([prev.count, state.count]));

      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "INCREMENT", payload: 3 });

      expect(pairs[0]).toEqual([0, 1]);
      expect(pairs[1]).toEqual([1, 4]);
    });

    it("should unsubscribe when returned function is called", () => {
      const calls: number[] = [];
      const unsub = store.subscribe((s) => calls.push(s.count));

      store.dispatch({ type: "INCREMENT" });
      unsub();
      store.dispatch({ type: "INCREMENT" });

      expect(calls).toEqual([1]);
    });

    it("should not notify when state does not change", () => {
      let calls = 0;
      store.subscribe(() => calls++);
      store.dispatch({ type: "UNKNOWN" }); // no state change
      expect(calls).toBe(0);
    });
  });

  describe("select (memoized selector)", () => {
    it("should return derived state", () => {
      store.dispatch({ type: "INCREMENT", payload: 10 });
      const doubled = store.select((s) => s.count * 2);
      expect(doubled).toBe(20);
    });

    it("should memoize selector result", () => {
      let computations = 0;
      const selector = (s: CounterState) => { computations++; return s.count * 2; };

      store.select(selector);
      store.select(selector); // same state — should use cache
      expect(computations).toBe(1);
    });

    it("should recompute after state change", () => {
      let computations = 0;
      const selector = (s: CounterState) => { computations++; return s.count; };

      store.select(selector);
      store.dispatch({ type: "INCREMENT" });
      store.select(selector); // state changed — recompute
      expect(computations).toBe(2);
    });
  });

  describe("undo / redo", () => {
    it("should undo last action", () => {
      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "INCREMENT" });
      store.undo();
      expect(store.getState().count).toBe(1);
    });

    it("should redo after undo", () => {
      store.dispatch({ type: "INCREMENT", payload: 5 });
      store.undo();
      store.redo();
      expect(store.getState().count).toBe(5);
    });

    it("should clear redo stack on new dispatch", () => {
      store.dispatch({ type: "INCREMENT" });
      store.undo();
      store.dispatch({ type: "INCREMENT", payload: 10 });
      expect(store.canRedo()).toBe(false);
    });

    it("should return false when nothing to undo", () => {
      expect(store.undo()).toBe(false);
    });

    it("should return false when nothing to redo", () => {
      expect(store.redo()).toBe(false);
    });

    it("should report canUndo / canRedo correctly", () => {
      expect(store.canUndo()).toBe(false);
      store.dispatch({ type: "INCREMENT" });
      expect(store.canUndo()).toBe(true);
      store.undo();
      expect(store.canRedo()).toBe(true);
    });
  });

  describe("middleware", () => {
    it("should run middleware before reducer", () => {
      const log: string[] = [];
      store.use((s, action, next) => {
        log.push(`before:${action.type}`);
        next(action);
        log.push(`after:${action.type}`);
      });

      store.dispatch({ type: "INCREMENT" });
      expect(log).toEqual(["before:INCREMENT", "after:INCREMENT"]);
    });

    it("should allow middleware to transform action", () => {
      store.use((_s, action, next) => {
        if (action.type === "INCREMENT") {
          next({ type: "INCREMENT", payload: 100 });
        } else {
          next(action);
        }
      });

      store.dispatch({ type: "INCREMENT" });
      expect(store.getState().count).toBe(100);
    });

    it("should allow middleware to block action", () => {
      store.use((_s, action, next) => {
        if (action.type !== "RESET") next(action);
        // RESET is blocked
      });

      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "RESET" }); // blocked
      expect(store.getState().count).toBe(1);
    });
  });

  describe("reset", () => {
    it("should reset to provided state", () => {
      store.dispatch({ type: "INCREMENT", payload: 99 });
      store.reset({ count: 0, lastAction: "" });
      expect(store.getState().count).toBe(0);
      expect(store.canUndo()).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should track dispatched count and subscriptions", () => {
      const unsub = store.subscribe(() => {});
      store.dispatch({ type: "INCREMENT" });
      store.dispatch({ type: "INCREMENT" });

      const stats = store.getStats();
      expect(stats.dispatched).toBe(2);
      expect(stats.subscriptions).toBe(1);
      unsub();
    });
  });
});

describe("ReactiveStore — additional coverage", () => {
  it("createStore should return a ReactiveStore instance", () => {
    const store = createStore({ count: 0 }, (state, action) => {
      if (action.type === "INC") return { count: state.count + 1 };
      return state;
    });
    store.dispatch({ type: "INC" });
    expect(store.getState().count).toBe(1);
  });

  it("use() should return this for chaining", () => {
    const store = createStore({ v: 0 }, (s) => s);
    const result = store.use((_s, action, next) => next(action));
    expect(result).toBe(store);
  });

  it("getStats should track subscriptions after unsubscribe", () => {
    const store = createStore({ v: 0 }, (s) => s);
    const unsub1 = store.subscribe(() => {});
    const unsub2 = store.subscribe(() => {});
    expect(store.getStats().subscriptions).toBe(2);
    unsub1();
    expect(store.getStats().subscriptions).toBe(1);
    unsub2();
    expect(store.getStats().subscriptions).toBe(0);
  });

  it("select should return same reference when state unchanged", () => {
    const store = createStore({ a: 1, b: 2 }, (s) => s);
    const selector = (s: { a: number; b: number }) => s.a;
    const r1 = store.select(selector);
    const r2 = store.select(selector);
    expect(r1).toBe(r2);
  });
});
