/**
 * Git-style Persistence
 *
 * Inspired by Aider's git-style state management:
 * - Versioned state snapshots
 * - Commit-like state changes
 * - Diff between states
 * - Rollback to previous states
 * - Branch-like state isolation
 *
 * Pattern: State → Commit → History → Diff → Rollback
 */

export interface StateSnapshot<T = unknown> {
  id: string;
  timestamp: number;
  state: T;
  metadata: SnapshotMetadata;
  parent?: string; // Parent snapshot ID
  hash: string; // Content hash for integrity
}

export interface SnapshotMetadata {
  author: string;
  message: string;
  tags: string[];
  branch: string;
  version: string;
}

export interface StateDiff<T = unknown> {
  from: string; // Snapshot ID
  to: string; // Snapshot ID
  changes: Change[];
  summary: DiffSummary;
}

export interface Change {
  path: string;
  type: "added" | "modified" | "deleted";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffSummary {
  additions: number;
  modifications: number;
  deletions: number;
  totalChanges: number;
}

export interface Branch {
  name: string;
  head: string; // Current snapshot ID
  created: number;
  lastModified: number;
}

/**
 * Git-style State Manager
 * Manages versioned state with git-like operations
 */
export class GitStyleStateManager<T = unknown> {
  private snapshots: Map<string, StateSnapshot<T>> = new Map();
  private branches: Map<string, Branch> = new Map();
  private currentBranch = "main";
  private head: string | null = null;

  constructor() {
    // Initialize main branch
    this.branches.set("main", {
      name: "main",
      head: "",
      created: Date.now(),
      lastModified: Date.now(),
    });
  }

  /**
   * Commit current state
   */
  commit(state: T, message: string, metadata: Partial<SnapshotMetadata> = {}): string {
    const snapshotId = this.generateSnapshotId();
    const hash = this.hashState(state);

    const snapshot: StateSnapshot<T> = {
      id: snapshotId,
      timestamp: Date.now(),
      state: this.deepClone(state),
      metadata: {
        author: metadata.author || "agent",
        message,
        tags: metadata.tags || [],
        branch: this.currentBranch,
        version: metadata.version || "1.0.0",
      },
      parent: this.head || undefined,
      hash,
    };

    this.snapshots.set(snapshotId, snapshot);
    this.head = snapshotId;

    // Update branch head
    const branch = this.branches.get(this.currentBranch);
    if (branch) {
      branch.head = snapshotId;
      branch.lastModified = Date.now();
    }

    return snapshotId;
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId: string): StateSnapshot<T> | null {
    return this.snapshots.get(snapshotId) || null;
  }

  /**
   * Get current state
   */
  getCurrentState(): T | null {
    if (!this.head) return null;
    const snapshot = this.snapshots.get(this.head);
    return snapshot ? this.deepClone(snapshot.state) : null;
  }

  /**
   * Rollback to previous snapshot
   */
  rollback(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    this.head = snapshotId;

    // Update branch head
    const branch = this.branches.get(this.currentBranch);
    if (branch) {
      branch.head = snapshotId;
      branch.lastModified = Date.now();
    }

    return true;
  }

  /**
   * Calculate diff between two snapshots
   */
  diff(fromId: string, toId: string): StateDiff<T> | null {
    const fromSnapshot = this.snapshots.get(fromId);
    const toSnapshot = this.snapshots.get(toId);

    if (!fromSnapshot || !toSnapshot) return null;

    const changes = this.calculateChanges(fromSnapshot.state, toSnapshot.state);

    return {
      from: fromId,
      to: toId,
      changes,
      summary: {
        additions: changes.filter((c) => c.type === "added").length,
        modifications: changes.filter((c) => c.type === "modified").length,
        deletions: changes.filter((c) => c.type === "deleted").length,
        totalChanges: changes.length,
      },
    };
  }

  /**
   * Get commit history
   */
  getHistory(limit: number = 10): StateSnapshot<T>[] {
    const history: StateSnapshot<T>[] = [];
    let current = this.head;

    while (current && history.length < limit) {
      const snapshot = this.snapshots.get(current);
      if (!snapshot) break;

      history.push(snapshot);
      current = snapshot.parent || null;
    }

    return history;
  }

  /**
   * Create a new branch
   */
  createBranch(name: string, fromSnapshot?: string): boolean {
    if (this.branches.has(name)) return false;

    const head = fromSnapshot || this.head || "";

    this.branches.set(name, {
      name,
      head,
      created: Date.now(),
      lastModified: Date.now(),
    });

    return true;
  }

  /**
   * Switch to a different branch
   */
  checkout(branchName: string): boolean {
    const branch = this.branches.get(branchName);
    if (!branch) return false;

    this.currentBranch = branchName;
    this.head = branch.head || null;

    return true;
  }

  /**
   * Merge branch into current branch
   */
  merge(sourceBranch: string, message: string): string | null {
    const source = this.branches.get(sourceBranch);
    if (!source || !source.head) return null;

    const sourceSnapshot = this.snapshots.get(source.head);
    if (!sourceSnapshot) return null;

    // Simple merge: commit source state to current branch
    return this.commit(sourceSnapshot.state, message, {
      tags: ["merge", `from:${sourceBranch}`],
    });
  }

  /**
   * Tag a snapshot
   */
  tag(snapshotId: string, tag: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    if (!snapshot.metadata.tags.includes(tag)) {
      snapshot.metadata.tags.push(tag);
    }

    return true;
  }

  /**
   * Find snapshots by tag
   */
  findByTag(tag: string): StateSnapshot<T>[] {
    return Array.from(this.snapshots.values()).filter((s) =>
      s.metadata.tags.includes(tag)
    );
  }

  /**
   * Get all branches
   */
  getBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  /**
   * Get current branch name
   */
  getCurrentBranch(): string {
    return this.currentBranch;
  }

  /**
   * Verify snapshot integrity
   */
  verifyIntegrity(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) return false;

    const currentHash = this.hashState(snapshot.state);
    return currentHash === snapshot.hash;
  }

  /**
   * Export history as JSON
   */
  exportHistory(): string {
    const history = this.getHistory(100);
    return JSON.stringify(
      {
        snapshots: history,
        branches: Array.from(this.branches.values()),
        currentBranch: this.currentBranch,
        head: this.head,
      },
      null,
      2
    );
  }

  /**
   * Import history from JSON
   */
  importHistory(json: string): boolean {
    try {
      const data = JSON.parse(json);

      // Clear current state
      this.snapshots.clear();
      this.branches.clear();

      // Import snapshots
      for (const snapshot of data.snapshots) {
        this.snapshots.set(snapshot.id, snapshot);
      }

      // Import branches
      for (const branch of data.branches) {
        this.branches.set(branch.name, branch);
      }

      this.currentBranch = data.currentBranch;
      this.head = data.head;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate changes between two states
   */
  private calculateChanges(oldState: T, newState: T, path = ""): Change[] {
    const changes: Change[] = [];

    if (typeof oldState !== "object" || typeof newState !== "object") {
      if (oldState !== newState) {
        changes.push({
          path: path || "root",
          type: "modified",
          oldValue: oldState,
          newValue: newState,
        });
      }
      return changes;
    }

    const oldKeys = new Set(Object.keys(oldState as object));
    const newKeys = new Set(Object.keys(newState as object));

    // Check for additions and modifications
    for (const key of newKeys) {
      const newPath = path ? `${path}.${key}` : key;
      const oldValue = (oldState as Record<string, unknown>)[key];
      const newValue = (newState as Record<string, unknown>)[key];

      if (!oldKeys.has(key)) {
        changes.push({
          path: newPath,
          type: "added",
          newValue,
        });
      } else if (typeof newValue === "object" && typeof oldValue === "object") {
        changes.push(...this.calculateChanges(oldValue as T, newValue as T, newPath));
      } else if (oldValue !== newValue) {
        changes.push({
          path: newPath,
          type: "modified",
          oldValue,
          newValue,
        });
      }
    }

    // Check for deletions
    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        const newPath = path ? `${path}.${key}` : key;
        changes.push({
          path: newPath,
          type: "deleted",
          oldValue: (oldState as Record<string, unknown>)[key],
        });
      }
    }

    return changes;
  }

  /**
   * Hash state for integrity checking
   */
  private hashState(state: T): string {
    const str = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  /**
   * Deep clone state
   */
  private deepClone(state: T): T {
    return JSON.parse(JSON.stringify(state));
  }

  /**
   * Generate unique snapshot ID
   */
  private generateSnapshotId(): string {
    return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalSnapshots: number;
    totalBranches: number;
    currentBranch: string;
    historyDepth: number;
  } {
    return {
      totalSnapshots: this.snapshots.size,
      totalBranches: this.branches.size,
      currentBranch: this.currentBranch,
      historyDepth: this.getHistory(1000).length,
    };
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.snapshots.clear();
    this.branches.clear();
    this.head = null;
    this.currentBranch = "main";
    this.branches.set("main", {
      name: "main",
      head: "",
      created: Date.now(),
      lastModified: Date.now(),
    });
  }
}

/**
 * Global state manager instance
 */
export const stateManager = new GitStyleStateManager();

/**
 * Usage example:
 *
 * // Commit initial state
 * const snap1 = stateManager.commit(
 *   { balance: 1000, tokens: ["TKNA"] },
 *   "Initial state"
 * );
 *
 * // Make changes and commit
 * const snap2 = stateManager.commit(
 *   { balance: 900, tokens: ["TKNA", "TKNB"] },
 *   "After swap"
 * );
 *
 * // View diff
 * const diff = stateManager.diff(snap1, snap2);
 * console.log("Changes:", diff?.summary);
 *
 * // Rollback
 * stateManager.rollback(snap1);
 * console.log("Current state:", stateManager.getCurrentState());
 *
 * // Create branch
 * stateManager.createBranch("feature");
 * stateManager.checkout("feature");
 *
 * // Commit on feature branch
 * stateManager.commit({ balance: 800 }, "Feature work");
 *
 * // Merge back to main
 * stateManager.checkout("main");
 * stateManager.merge("feature", "Merge feature branch");
 *
 * // View history
 * const history = stateManager.getHistory();
 * console.log("History:", history.map(s => s.metadata.message));
 */
