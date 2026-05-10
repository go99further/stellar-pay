/**
 * Immutable Trajectory Tracker
 *
 * Inspired by SWE-agent's trajectory pattern:
 * - Complete operation history
 * - Immutable state snapshots
 * - Time-travel debugging
 * - Audit trail for compliance
 *
 * Pattern: Observe → Record → Snapshot → Replay
 */

export type ActionType =
  | "validation"
  | "simulation"
  | "xdr_build"
  | "user_confirmation"
  | "execution"
  | "error"
  | "rollback";

export interface Action {
  id: string;
  type: ActionType;
  timestamp: number;
  input: unknown;
  output?: unknown;
  error?: Error;
  duration: number;
  metadata: Record<string, unknown>;
}

export interface StateSnapshot {
  timestamp: number;
  state: Record<string, unknown>;
  actionId: string;
}

export interface Trajectory {
  id: string;
  operationType: "swap" | "add_liquidity" | "remove_liquidity";
  userId: string;
  startTime: number;
  endTime?: number;
  actions: Action[];
  snapshots: StateSnapshot[];
  finalState?: "success" | "failed" | "cancelled";
  metadata: Record<string, unknown>;
}

export interface TrajectoryQuery {
  userId?: string;
  operationType?: string;
  startTime?: number;
  endTime?: number;
  finalState?: string;
  limit?: number;
}

/**
 * Immutable Trajectory Tracker
 * Records complete operation history for debugging and audit
 */
export class TrajectoryTracker {
  private trajectories: Map<string, Trajectory> = new Map();
  private currentTrajectory: Trajectory | null = null;
  private maxTrajectories = 1000;

  /**
   * Start tracking a new trajectory
   */
  startTrajectory(
    operationType: Trajectory["operationType"],
    userId: string,
    metadata: Record<string, unknown> = {}
  ): string {
    const trajectoryId = this.generateTrajectoryId();

    const trajectory: Trajectory = {
      id: trajectoryId,
      operationType,
      userId,
      startTime: Date.now(),
      actions: [],
      snapshots: [],
      metadata,
    };

    this.trajectories.set(trajectoryId, trajectory);
    this.currentTrajectory = trajectory;

    // Trim old trajectories if over limit
    if (this.trajectories.size > this.maxTrajectories) {
      this.trimOldTrajectories();
    }

    return trajectoryId;
  }

  /**
   * Record an action in the current trajectory
   */
  recordAction(
    type: ActionType,
    input: unknown,
    output?: unknown,
    error?: Error,
    metadata: Record<string, unknown> = {}
  ): string | null {
    if (!this.currentTrajectory) {
      console.warn("No active trajectory");
      return null;
    }

    const actionId = this.generateActionId();
    const timestamp = Date.now();

    const action: Action = {
      id: actionId,
      type,
      timestamp,
      input,
      output,
      error,
      duration: 0, // Will be updated when action completes
      metadata,
    };

    this.currentTrajectory.actions.push(action);

    return actionId;
  }

  /**
   * Update action duration (call when action completes)
   */
  completeAction(actionId: string, output?: unknown, error?: Error): boolean {
    if (!this.currentTrajectory) {
      return false;
    }

    const action = this.currentTrajectory.actions.find((a) => a.id === actionId);

    if (!action) {
      return false;
    }

    action.duration = Date.now() - action.timestamp;
    if (output !== undefined) action.output = output;
    if (error) action.error = error;

    return true;
  }

  /**
   * Take a snapshot of current state
   */
  snapshot(state: Record<string, unknown>, actionId?: string): void {
    if (!this.currentTrajectory) {
      return;
    }

    const snapshot: StateSnapshot = {
      timestamp: Date.now(),
      state: this.deepClone(state), // Immutable copy
      actionId: actionId || this.currentTrajectory.actions[this.currentTrajectory.actions.length - 1]?.id || "",
    };

    this.currentTrajectory.snapshots.push(snapshot);
  }

  /**
   * End the current trajectory
   */
  endTrajectory(finalState: Trajectory["finalState"]): boolean {
    if (!this.currentTrajectory) {
      return false;
    }

    this.currentTrajectory.endTime = Date.now();
    this.currentTrajectory.finalState = finalState;
    this.currentTrajectory = null;

    return true;
  }

  /**
   * Get trajectory by ID
   */
  getTrajectory(trajectoryId: string): Trajectory | null {
    return this.trajectories.get(trajectoryId) || null;
  }

  /**
   * Query trajectories
   */
  queryTrajectories(query: TrajectoryQuery = {}): Trajectory[] {
    let results = Array.from(this.trajectories.values());

    // Filter by userId
    if (query.userId) {
      results = results.filter((t) => t.userId === query.userId);
    }

    // Filter by operationType
    if (query.operationType) {
      results = results.filter((t) => t.operationType === query.operationType);
    }

    // Filter by time range
    if (query.startTime) {
      results = results.filter((t) => t.startTime >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter((t) => t.endTime && t.endTime <= query.endTime!);
    }

    // Filter by finalState
    if (query.finalState) {
      results = results.filter((t) => t.finalState === query.finalState);
    }

    // Sort by startTime (newest first)
    results.sort((a, b) => b.startTime - a.startTime);

    // Limit results
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Replay trajectory (for debugging)
   */
  replayTrajectory(trajectoryId: string): {
    trajectory: Trajectory;
    timeline: Array<{
      timestamp: number;
      type: "action" | "snapshot";
      data: Action | StateSnapshot;
    }>;
  } | null {
    const trajectory = this.getTrajectory(trajectoryId);

    if (!trajectory) {
      return null;
    }

    // Merge actions and snapshots into timeline
    const timeline: Array<{
      timestamp: number;
      type: "action" | "snapshot";
      data: Action | StateSnapshot;
    }> = [];

    for (const action of trajectory.actions) {
      timeline.push({
        timestamp: action.timestamp,
        type: "action",
        data: action,
      });
    }

    for (const snapshot of trajectory.snapshots) {
      timeline.push({
        timestamp: snapshot.timestamp,
        type: "snapshot",
        data: snapshot,
      });
    }

    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp - b.timestamp);

    return { trajectory, timeline };
  }

  /**
   * Get trajectory statistics
   */
  getStatistics(): {
    totalTrajectories: number;
    successfulTrajectories: number;
    failedTrajectories: number;
    cancelledTrajectories: number;
    averageDuration: number;
    averageActions: number;
    byOperationType: Record<string, number>;
  } {
    const trajectories = Array.from(this.trajectories.values());
    const completed = trajectories.filter((t) => t.endTime);

    const successful = completed.filter((t) => t.finalState === "success").length;
    const failed = completed.filter((t) => t.finalState === "failed").length;
    const cancelled = completed.filter((t) => t.finalState === "cancelled").length;

    const totalDuration = completed.reduce((sum, t) => sum + (t.endTime! - t.startTime), 0);
    const averageDuration = completed.length > 0 ? totalDuration / completed.length : 0;

    const totalActions = trajectories.reduce((sum, t) => sum + t.actions.length, 0);
    const averageActions = trajectories.length > 0 ? totalActions / trajectories.length : 0;

    const byOperationType: Record<string, number> = {};
    for (const trajectory of trajectories) {
      byOperationType[trajectory.operationType] = (byOperationType[trajectory.operationType] || 0) + 1;
    }

    return {
      totalTrajectories: trajectories.length,
      successfulTrajectories: successful,
      failedTrajectories: failed,
      cancelledTrajectories: cancelled,
      averageDuration,
      averageActions,
      byOperationType,
    };
  }

  /**
   * Export trajectory as JSON (for audit)
   */
  exportTrajectory(trajectoryId: string): string | null {
    const trajectory = this.getTrajectory(trajectoryId);

    if (!trajectory) {
      return null;
    }

    return JSON.stringify(trajectory, null, 2);
  }

  /**
   * Export all trajectories
   */
  exportAll(): string {
    const trajectories = Array.from(this.trajectories.values());
    return JSON.stringify(trajectories, null, 2);
  }

  /**
   * Clear all trajectories
   */
  clearAll(): void {
    this.trajectories.clear();
    this.currentTrajectory = null;
  }

  /**
   * Trim old trajectories to stay under limit
   */
  private trimOldTrajectories(): void {
    const trajectories = Array.from(this.trajectories.entries());

    // Sort by startTime (oldest first)
    trajectories.sort((a, b) => a[1].startTime - b[1].startTime);

    // Remove oldest trajectories
    const toRemove = trajectories.length - this.maxTrajectories + 100; // Remove 100 at a time
    for (let i = 0; i < toRemove; i++) {
      this.trajectories.delete(trajectories[i][0]);
    }
  }

  /**
   * Deep clone object (for immutable snapshots)
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Generate unique trajectory ID
   */
  private generateTrajectoryId(): string {
    return `traj_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Generate unique action ID
   */
  private generateActionId(): string {
    return `act_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get current trajectory
   */
  getCurrentTrajectory(): Trajectory | null {
    return this.currentTrajectory;
  }

  /**
   * Set max trajectories to keep
   */
  setMaxTrajectories(max: number): void {
    this.maxTrajectories = max;
  }
}

/**
 * Global trajectory tracker instance
 */
export const trajectoryTracker = new TrajectoryTracker();

/**
 * Decorator to automatically track function execution
 */
export function tracked(actionType: ActionType) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const actionId = trajectoryTracker.recordAction(actionType, args);

      try {
        const result = await originalMethod.apply(this, args);
        if (actionId) {
          trajectoryTracker.completeAction(actionId, result);
        }
        return result;
      } catch (error) {
        if (actionId) {
          trajectoryTracker.completeAction(actionId, undefined, error as Error);
        }
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Usage example:
 *
 * // Start tracking
 * const trajectoryId = trajectoryTracker.startTrajectory("swap", "user-123", {
 *   tokenIn: "TKNA",
 *   tokenOut: "TKNB",
 * });
 *
 * // Record actions
 * const actionId = trajectoryTracker.recordAction("validation", { amountIn: 100 });
 * // ... perform validation
 * trajectoryTracker.completeAction(actionId, { valid: true });
 *
 * // Take snapshot
 * trajectoryTracker.snapshot({ reserves: { TKNA: 1000, TKNB: 1000 } });
 *
 * // End trajectory
 * trajectoryTracker.endTrajectory("success");
 *
 * // Query trajectories
 * const userTrajectories = trajectoryTracker.queryTrajectories({
 *   userId: "user-123",
 *   finalState: "success",
 *   limit: 10,
 * });
 *
 * // Replay for debugging
 * const replay = trajectoryTracker.replayTrajectory(trajectoryId);
 * console.log("Timeline:", replay?.timeline);
 *
 * // Export for audit
 * const json = trajectoryTracker.exportTrajectory(trajectoryId);
 * fs.writeFileSync("audit.json", json);
 */
