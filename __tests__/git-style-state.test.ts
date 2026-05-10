import { describe, it, expect, beforeEach } from "vitest";
import { GitStyleStateManager, stateManager } from "../lib/agent/persistence/git-style-state";

interface TestState {
  balance: number;
  tokens: string[];
}

describe("GitStyleStateManager", () => {
  let mgr: GitStyleStateManager<TestState>;

  beforeEach(() => {
    mgr = new GitStyleStateManager<TestState>();
  });

  describe("commit / getCurrentState", () => {
    it("should return null before any commit", () => {
      expect(mgr.getCurrentState()).toBeNull();
    });

    it("should commit and return snapshot ID", () => {
      const id = mgr.commit({ balance: 1000, tokens: ["TKNA"] }, "init");
      expect(typeof id).toBe("string");
      expect(id.startsWith("snap_")).toBe(true);
    });

    it("should return current state after commit", () => {
      mgr.commit({ balance: 1000, tokens: ["TKNA"] }, "init");
      expect(mgr.getCurrentState()).toEqual({ balance: 1000, tokens: ["TKNA"] });
    });

    it("should deep-clone state (immutable)", () => {
      const state: TestState = { balance: 1000, tokens: ["TKNA"] };
      mgr.commit(state, "init");
      state.balance = 9999;
      expect(mgr.getCurrentState()!.balance).toBe(1000);
    });

    it("should set parent on subsequent commits", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] }, "first");
      const id2 = mgr.commit({ balance: 900, tokens: ["TKNB"] }, "second");
      const snap2 = mgr.getSnapshot(id2)!;
      expect(snap2.parent).toBe(id1);
    });

    it("should store metadata", () => {
      const id = mgr.commit({ balance: 1000, tokens: [] }, "init", {
        author: "alice",
        tags: ["v1"],
      });
      const snap = mgr.getSnapshot(id)!;
      expect(snap.metadata.author).toBe("alice");
      expect(snap.metadata.tags).toContain("v1");
      expect(snap.metadata.message).toBe("init");
    });
  });

  describe("rollback", () => {
    it("should rollback to a previous snapshot", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] }, "first");
      mgr.commit({ balance: 900, tokens: ["TKNB"] }, "second");
      mgr.rollback(id1);
      expect(mgr.getCurrentState()!.balance).toBe(1000);
    });

    it("should return false for unknown snapshot", () => {
      expect(mgr.rollback("nonexistent")).toBe(false);
    });
  });

  describe("diff", () => {
    it("should detect added fields", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] } as unknown as TestState, "a");
      const id2 = mgr.commit({ balance: 1000, tokens: [], extra: true } as unknown as TestState, "b");
      const d = mgr.diff(id1, id2)!;
      expect(d.summary.additions).toBeGreaterThan(0);
    });

    it("should detect modified fields", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] }, "a");
      const id2 = mgr.commit({ balance: 900, tokens: [] }, "b");
      const d = mgr.diff(id1, id2)!;
      expect(d.summary.modifications).toBeGreaterThan(0);
    });

    it("should detect deleted fields", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: ["TKNA"] } as unknown as TestState, "a");
      const id2 = mgr.commit({ balance: 1000 } as unknown as TestState, "b");
      const d = mgr.diff(id1, id2)!;
      expect(d.summary.deletions).toBeGreaterThan(0);
    });

    it("should return null for unknown IDs", () => {
      expect(mgr.diff("a", "b")).toBeNull();
    });

    it("should report zero changes for identical states", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] }, "a");
      const id2 = mgr.commit({ balance: 1000, tokens: [] }, "b");
      const d = mgr.diff(id1, id2)!;
      expect(d.summary.totalChanges).toBe(0);
    });
  });

  describe("getHistory", () => {
    it("should return commits in reverse chronological order", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "first");
      mgr.commit({ balance: 900, tokens: [] }, "second");
      mgr.commit({ balance: 800, tokens: [] }, "third");
      const history = mgr.getHistory();
      expect(history[0].metadata.message).toBe("third");
      expect(history[2].metadata.message).toBe("first");
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        mgr.commit({ balance: i, tokens: [] }, `commit-${i}`);
      }
      expect(mgr.getHistory(3)).toHaveLength(3);
    });
  });

  describe("branches", () => {
    it("should start on main branch", () => {
      expect(mgr.getCurrentBranch()).toBe("main");
    });

    it("should create a new branch", () => {
      const ok = mgr.createBranch("feature");
      expect(ok).toBe(true);
      expect(mgr.getBranches().some((b) => b.name === "feature")).toBe(true);
    });

    it("should not create duplicate branch", () => {
      mgr.createBranch("feature");
      expect(mgr.createBranch("feature")).toBe(false);
    });

    it("should checkout a branch", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "init");
      mgr.createBranch("feature");
      const ok = mgr.checkout("feature");
      expect(ok).toBe(true);
      expect(mgr.getCurrentBranch()).toBe("feature");
    });

    it("should return false for unknown branch checkout", () => {
      expect(mgr.checkout("nonexistent")).toBe(false);
    });

    it("should merge branch into current", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "init");
      mgr.createBranch("feature");
      mgr.checkout("feature");
      mgr.commit({ balance: 500, tokens: ["TKNB"] }, "feature work");
      mgr.checkout("main");
      const mergeId = mgr.merge("feature", "Merge feature");
      expect(mergeId).not.toBeNull();
      expect(mgr.getCurrentState()!.balance).toBe(500);
    });
  });

  describe("tag / findByTag", () => {
    it("should tag a snapshot", () => {
      const id = mgr.commit({ balance: 1000, tokens: [] }, "init");
      expect(mgr.tag(id, "v1.0")).toBe(true);
      const snap = mgr.getSnapshot(id)!;
      expect(snap.metadata.tags).toContain("v1.0");
    });

    it("should not duplicate tags", () => {
      const id = mgr.commit({ balance: 1000, tokens: [] }, "init");
      mgr.tag(id, "v1.0");
      mgr.tag(id, "v1.0");
      expect(mgr.getSnapshot(id)!.metadata.tags.filter((t) => t === "v1.0")).toHaveLength(1);
    });

    it("should find snapshots by tag", () => {
      const id1 = mgr.commit({ balance: 1000, tokens: [] }, "a");
      const id2 = mgr.commit({ balance: 900, tokens: [] }, "b");
      mgr.tag(id1, "release");
      mgr.tag(id2, "release");
      expect(mgr.findByTag("release")).toHaveLength(2);
    });

    it("should return false for unknown snapshot", () => {
      expect(mgr.tag("unknown", "v1")).toBe(false);
    });
  });

  describe("verifyIntegrity", () => {
    it("should return true for unmodified snapshot", () => {
      const id = mgr.commit({ balance: 1000, tokens: [] }, "init");
      expect(mgr.verifyIntegrity(id)).toBe(true);
    });

    it("should return false for unknown snapshot", () => {
      expect(mgr.verifyIntegrity("unknown")).toBe(false);
    });
  });

  describe("exportHistory / importHistory", () => {
    it("should export and re-import history", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "first");
      mgr.commit({ balance: 900, tokens: ["TKNB"] }, "second");
      const json = mgr.exportHistory();
      const mgr2 = new GitStyleStateManager<TestState>();
      expect(mgr2.importHistory(json)).toBe(true);
      expect(mgr2.getCurrentState()!.balance).toBe(900);
    });

    it("should return false for invalid JSON", () => {
      expect(mgr.importHistory("not json")).toBe(false);
    });
  });

  describe("getStatistics", () => {
    it("should report snapshot and branch counts", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "a");
      mgr.commit({ balance: 900, tokens: [] }, "b");
      mgr.createBranch("feature");
      const stats = mgr.getStatistics();
      expect(stats.totalSnapshots).toBe(2);
      expect(stats.totalBranches).toBe(2); // main + feature
      expect(stats.historyDepth).toBe(2);
    });
  });

  describe("clear", () => {
    it("should reset to initial state", () => {
      mgr.commit({ balance: 1000, tokens: [] }, "init");
      mgr.createBranch("feature");
      mgr.clear();
      expect(mgr.getCurrentState()).toBeNull();
      expect(mgr.getCurrentBranch()).toBe("main");
      expect(mgr.getBranches()).toHaveLength(1);
    });
  });

  describe("global instance", () => {
    it("stateManager should be a shared instance", () => {
      expect(stateManager).toBeInstanceOf(GitStyleStateManager);
    });
  });
});
