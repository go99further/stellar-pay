import { describe, it, expect, beforeEach } from "vitest";
import { EventStore, Aggregate, Projection } from "../lib/agent/event-sourcing";

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => { store = new EventStore(); });

  describe("append", () => {
    it("should append an event and return it", () => {
      const evt = store.append("agg-1", "UserCreated", { name: "Alice" });
      expect(evt.id).toBeDefined();
      expect(evt.aggregateId).toBe("agg-1");
      expect(evt.type).toBe("UserCreated");
      expect(evt.version).toBe(1);
    });

    it("should auto-increment version per aggregate", () => {
      store.append("agg-1", "A", {});
      store.append("agg-1", "B", {});
      const evt = store.append("agg-1", "C", {});
      expect(evt.version).toBe(3);
    });

    it("should version independently per aggregate", () => {
      store.append("agg-1", "A", {});
      store.append("agg-1", "B", {});
      const evt2 = store.append("agg-2", "X", {});
      expect(evt2.version).toBe(1);
    });

    it("should record timestamp", () => {
      const before = Date.now();
      const evt = store.append("agg-1", "A", {});
      expect(evt.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe("getEvents", () => {
    it("should return all events for an aggregate", () => {
      store.append("agg-1", "A", {});
      store.append("agg-1", "B", {});
      store.append("agg-2", "X", {});
      expect(store.getEvents("agg-1")).toHaveLength(2);
    });

    it("should filter by fromVersion", () => {
      store.append("agg-1", "A", {});
      store.append("agg-1", "B", {});
      store.append("agg-1", "C", {});
      const events = store.getEvents("agg-1", 1);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("B");
    });

    it("should return empty for unknown aggregate", () => {
      expect(store.getEvents("unknown")).toHaveLength(0);
    });
  });

  describe("snapshots", () => {
    it("should save and retrieve a snapshot", () => {
      store.saveSnapshot("agg-1", { count: 5 }, 5);
      const snap = store.getSnapshot<{ count: number }>("agg-1");
      expect(snap?.state.count).toBe(5);
      expect(snap?.version).toBe(5);
    });

    it("should return undefined for missing snapshot", () => {
      expect(store.getSnapshot("missing")).toBeUndefined();
    });

    it("should overwrite existing snapshot", () => {
      store.saveSnapshot("agg-1", { count: 3 }, 3);
      store.saveSnapshot("agg-1", { count: 7 }, 7);
      expect(store.getSnapshot<{ count: number }>("agg-1")?.state.count).toBe(7);
    });
  });

  describe("getLastVersion", () => {
    it("should return 0 for new aggregate", () => {
      expect(store.getLastVersion("new")).toBe(0);
    });

    it("should return latest version", () => {
      store.append("agg-1", "A", {});
      store.append("agg-1", "B", {});
      expect(store.getLastVersion("agg-1")).toBe(2);
    });
  });

  describe("eventCount", () => {
    it("should count all events", () => {
      store.append("a", "X", {});
      store.append("b", "Y", {});
      expect(store.eventCount()).toBe(2);
    });

    it("should count events for specific aggregate", () => {
      store.append("a", "X", {});
      store.append("a", "Y", {});
      store.append("b", "Z", {});
      expect(store.eventCount("a")).toBe(2);
    });
  });

  describe("clear", () => {
    it("should remove all events and snapshots", () => {
      store.append("a", "X", {});
      store.saveSnapshot("a", {}, 1);
      store.clear();
      expect(store.eventCount()).toBe(0);
      expect(store.getSnapshot("a")).toBeUndefined();
    });
  });
});

describe("Aggregate", () => {
  interface CounterState { count: number }

  function makeCounter(id: string) {
    return new Aggregate<CounterState>(id, { count: 0 }, (state, event) => {
      if (event.type === "Incremented") return { count: state.count + (event.payload as { by: number }).by };
      if (event.type === "Decremented") return { count: state.count - (event.payload as { by: number }).by };
      return state;
    });
  }

  it("should start with initial state", () => {
    const agg = makeCounter("c1");
    expect(agg.getState().count).toBe(0);
    expect(agg.getVersion()).toBe(0);
  });

  it("should rehydrate from events", () => {
    const store = new EventStore();
    store.append("c1", "Incremented", { by: 5 });
    store.append("c1", "Incremented", { by: 3 });
    store.append("c1", "Decremented", { by: 2 });

    const agg = makeCounter("c1");
    agg.rehydrate(store.getEvents("c1"));
    expect(agg.getState().count).toBe(6);
    expect(agg.getVersion()).toBe(3);
  });

  it("should rehydrate from snapshot + events", () => {
    const store = new EventStore();
    // Append 5 events first so versions 1-5 exist
    for (let i = 0; i < 5; i++) store.append("c1", "Incremented", { by: 2 });
    // Save snapshot at version 5 with accumulated count=10
    store.saveSnapshot("c1", { count: 10 }, 5);
    // Append 2 more events (versions 6 and 7)
    store.append("c1", "Incremented", { by: 2 });
    store.append("c1", "Incremented", { by: 3 });

    const agg = makeCounter("c1");
    const snap = store.getSnapshot<CounterState>("c1")!;
    agg.rehydrate(store.getEvents("c1", snap.version), snap);
    expect(agg.getState().count).toBe(15);
    expect(agg.getVersion()).toBe(7);
  });

  it("should apply a single event", () => {
    const store = new EventStore();
    const agg = makeCounter("c1");
    const evt = store.append("c1", "Incremented", { by: 4 });
    agg.applyEvent(evt);
    expect(agg.getState().count).toBe(4);
  });
});

describe("Projection", () => {
  interface LeaderboardState { scores: Record<string, number> }

  function makeLeaderboard() {
    return new Projection<LeaderboardState>(
      { scores: {} },
      {
        ScoreAdded: (state, event) => {
          const { userId, points } = event.payload as { userId: string; points: number };
          return { scores: { ...state.scores, [userId]: (state.scores[userId] ?? 0) + points } };
        },
        ScoreReset: (state, event) => {
          const { userId } = event.payload as { userId: string };
          const scores = { ...state.scores };
          delete scores[userId];
          return { scores };
        },
      }
    );
  }

  it("should project events into state", () => {
    const store = new EventStore();
    store.append("game", "ScoreAdded", { userId: "alice", points: 10 });
    store.append("game", "ScoreAdded", { userId: "bob", points: 5 });
    store.append("game", "ScoreAdded", { userId: "alice", points: 3 });

    const proj = makeLeaderboard();
    const state = proj.project(store.getEvents("game"));
    expect(state.scores["alice"]).toBe(13);
    expect(state.scores["bob"]).toBe(5);
  });

  it("should handle unknown event types gracefully", () => {
    const store = new EventStore();
    store.append("game", "UnknownEvent", {});
    const proj = makeLeaderboard();
    const state = proj.project(store.getEvents("game"));
    expect(state.scores).toEqual({});
  });

  it("should apply ScoreReset", () => {
    const store = new EventStore();
    store.append("game", "ScoreAdded", { userId: "alice", points: 10 });
    store.append("game", "ScoreReset", { userId: "alice" });

    const proj = makeLeaderboard();
    const state = proj.project(store.getEvents("game"));
    expect(state.scores["alice"]).toBeUndefined();
  });

  it("should reset state", () => {
    const proj = makeLeaderboard();
    const store = new EventStore();
    store.append("game", "ScoreAdded", { userId: "alice", points: 10 });
    proj.project(store.getEvents("game"));
    proj.reset({ scores: {} });
    expect(proj.getState().scores).toEqual({});
  });
});

describe("EventStore — getAllEvents", () => {
  it("should return all events across all aggregates", () => {
    const store = new EventStore();
    store.append("agg-1", "A", {});
    store.append("agg-2", "B", {});
    store.append("agg-1", "C", {});
    const all = store.getAllEvents();
    expect(all).toHaveLength(3);
  });

  it("should return empty array when no events", () => {
    const store = new EventStore();
    expect(store.getAllEvents()).toHaveLength(0);
  });

  it("should return a copy (mutation does not affect store)", () => {
    const store = new EventStore();
    store.append("agg-1", "A", {});
    const all = store.getAllEvents();
    all.pop();
    expect(store.getAllEvents()).toHaveLength(1);
  });
});
