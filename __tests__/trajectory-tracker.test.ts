import { describe, it, expect, beforeEach } from "vitest";
import { TrajectoryTracker, trajectoryTracker } from "../lib/agent/trajectory/trajectory-tracker";

describe("TrajectoryTracker", () => {
  let tracker: TrajectoryTracker;

  beforeEach(() => {
    tracker = new TrajectoryTracker();
  });

  describe("startTrajectory", () => {
    it("should return a trajectory ID", () => {
      const id = tracker.startTrajectory("swap", "user-1");
      expect(typeof id).toBe("string");
      expect(id.startsWith("traj_")).toBe(true);
    });

    it("should store the trajectory", () => {
      const id = tracker.startTrajectory("swap", "user-1");
      expect(tracker.getTrajectory(id)).not.toBeNull();
    });

    it("should set operationType and userId", () => {
      const id = tracker.startTrajectory("add_liquidity", "user-42");
      const traj = tracker.getTrajectory(id)!;
      expect(traj.operationType).toBe("add_liquidity");
      expect(traj.userId).toBe("user-42");
    });

    it("should set current trajectory", () => {
      tracker.startTrajectory("swap", "user-1");
      expect(tracker.getCurrentTrajectory()).not.toBeNull();
    });
  });

  describe("recordAction", () => {
    it("should record an action and return an ID", () => {
      tracker.startTrajectory("swap", "user-1");
      const actionId = tracker.recordAction("validation", { amount: 100 });
      expect(actionId).not.toBeNull();
      expect(actionId!.startsWith("act_")).toBe(true);
    });

    it("should return null when no active trajectory", () => {
      const actionId = tracker.recordAction("validation", {});
      expect(actionId).toBeNull();
    });

    it("should append action to current trajectory", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      tracker.recordAction("validation", { amount: 100 });
      tracker.recordAction("simulation", { result: "ok" });
      const traj = tracker.getTrajectory(trajId)!;
      expect(traj.actions).toHaveLength(2);
    });
  });

  describe("completeAction", () => {
    it("should update action output and duration", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      const actionId = tracker.recordAction("validation", { amount: 100 })!;
      const ok = tracker.completeAction(actionId, { valid: true });
      expect(ok).toBe(true);
      const action = tracker.getTrajectory(trajId)!.actions[0];
      expect(action.output).toEqual({ valid: true });
      expect(action.duration).toBeGreaterThanOrEqual(0);
    });

    it("should return false when no active trajectory", () => {
      expect(tracker.completeAction("nonexistent")).toBe(false);
    });

    it("should return false for unknown action ID", () => {
      tracker.startTrajectory("swap", "user-1");
      expect(tracker.completeAction("act_unknown")).toBe(false);
    });
  });

  describe("snapshot", () => {
    it("should add a snapshot to current trajectory", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      tracker.snapshot({ reserves: { TKNA: 1000, TKNB: 1000 } });
      const traj = tracker.getTrajectory(trajId)!;
      expect(traj.snapshots).toHaveLength(1);
      expect(traj.snapshots[0].state).toEqual({ reserves: { TKNA: 1000, TKNB: 1000 } });
    });

    it("should deep-clone state (immutable)", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      const state = { reserves: { TKNA: 1000 } };
      tracker.snapshot(state);
      state.reserves.TKNA = 9999;
      const snap = tracker.getTrajectory(trajId)!.snapshots[0];
      expect(snap.state).toEqual({ reserves: { TKNA: 1000 } });
    });

    it("should silently ignore when no active trajectory", () => {
      expect(() => tracker.snapshot({ x: 1 })).not.toThrow();
    });
  });

  describe("endTrajectory", () => {
    it("should set finalState and endTime", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      tracker.endTrajectory("success");
      const traj = tracker.getTrajectory(trajId)!;
      expect(traj.finalState).toBe("success");
      expect(traj.endTime).toBeDefined();
    });

    it("should clear current trajectory", () => {
      tracker.startTrajectory("swap", "user-1");
      tracker.endTrajectory("success");
      expect(tracker.getCurrentTrajectory()).toBeNull();
    });

    it("should return false when no active trajectory", () => {
      expect(tracker.endTrajectory("success")).toBe(false);
    });
  });

  describe("queryTrajectories", () => {
    beforeEach(() => {
      const id1 = tracker.startTrajectory("swap", "alice");
      tracker.endTrajectory("success");
      const id2 = tracker.startTrajectory("add_liquidity", "bob");
      tracker.endTrajectory("failed");
      tracker.startTrajectory("swap", "alice");
      tracker.endTrajectory("cancelled");
    });

    it("should return all trajectories with no filter", () => {
      expect(tracker.queryTrajectories()).toHaveLength(3);
    });

    it("should filter by userId", () => {
      const results = tracker.queryTrajectories({ userId: "alice" });
      expect(results).toHaveLength(2);
    });

    it("should filter by operationType", () => {
      const results = tracker.queryTrajectories({ operationType: "add_liquidity" });
      expect(results).toHaveLength(1);
    });

    it("should filter by finalState", () => {
      const results = tracker.queryTrajectories({ finalState: "success" });
      expect(results).toHaveLength(1);
    });

    it("should respect limit", () => {
      const results = tracker.queryTrajectories({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("should sort newest first", () => {
      const results = tracker.queryTrajectories();
      expect(results[0].startTime).toBeGreaterThanOrEqual(results[1].startTime);
    });
  });

  describe("replayTrajectory", () => {
    it("should return null for unknown ID", () => {
      expect(tracker.replayTrajectory("unknown")).toBeNull();
    });

    it("should return merged timeline sorted by timestamp", () => {
      const trajId = tracker.startTrajectory("swap", "user-1");
      tracker.recordAction("validation", {});
      tracker.snapshot({ step: 1 });
      tracker.recordAction("simulation", {});
      tracker.endTrajectory("success");

      const replay = tracker.replayTrajectory(trajId)!;
      expect(replay.trajectory.id).toBe(trajId);
      expect(replay.timeline.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < replay.timeline.length; i++) {
        expect(replay.timeline[i].timestamp).toBeGreaterThanOrEqual(replay.timeline[i - 1].timestamp);
      }
    });
  });

  describe("getStatistics", () => {
    it("should count by finalState", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("failed");
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("cancelled");

      const stats = tracker.getStatistics();
      expect(stats.successfulTrajectories).toBe(1);
      expect(stats.failedTrajectories).toBe(1);
      expect(stats.cancelledTrajectories).toBe(1);
      expect(stats.totalTrajectories).toBe(3);
    });

    it("should compute averageActions", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.recordAction("validation", {});
      tracker.recordAction("simulation", {});
      tracker.endTrajectory("success");

      const stats = tracker.getStatistics();
      expect(stats.averageActions).toBe(2);
    });

    it("should group by operationType", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      tracker.startTrajectory("add_liquidity", "u1");
      tracker.endTrajectory("success");

      const stats = tracker.getStatistics();
      expect(stats.byOperationType["swap"]).toBe(2);
      expect(stats.byOperationType["add_liquidity"]).toBe(1);
    });
  });

  describe("exportTrajectory / exportAll", () => {
    it("should export trajectory as JSON string", () => {
      const trajId = tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      const json = tracker.exportTrajectory(trajId);
      expect(typeof json).toBe("string");
      const parsed = JSON.parse(json!);
      expect(parsed.id).toBe(trajId);
    });

    it("should return null for unknown ID", () => {
      expect(tracker.exportTrajectory("unknown")).toBeNull();
    });

    it("should export all as JSON array", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      tracker.startTrajectory("swap", "u2");
      tracker.endTrajectory("failed");
      const json = tracker.exportAll();
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });
  });

  describe("clearAll", () => {
    it("should remove all trajectories", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.endTrajectory("success");
      tracker.clearAll();
      expect(tracker.queryTrajectories()).toHaveLength(0);
    });

    it("should clear current trajectory", () => {
      tracker.startTrajectory("swap", "u1");
      tracker.clearAll();
      expect(tracker.getCurrentTrajectory()).toBeNull();
    });
  });

  describe("global instance", () => {
    it("trajectoryTracker should be a shared instance", () => {
      expect(trajectoryTracker).toBeInstanceOf(TrajectoryTracker);
    });
  });
});
