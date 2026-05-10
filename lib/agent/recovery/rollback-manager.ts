/**
 * Rollback Manager
 *
 * Inspired by database transaction patterns:
 * - Register compensating actions for each step
 * - Execute rollback in reverse order on failure
 * - Idempotent rollback operations
 * - Rollback history and audit
 *
 * Pattern: Register → Execute → Fail → Rollback → Compensate
 */

export type RollbackStatus = "pending" | "executed" | "rolled_back" | "rollback_failed";

export interface RollbackAction {
  id: string;
  name: string;
  description: string;
  compensate: () => Promise<void>;
  registeredAt: number;
  executedAt?: number;
  rolledBackAt?: number;
  status: RollbackStatus;
}

export interface RollbackTransaction {
  id: string;
  name: string;
  actions: RollbackAction[];
  status: "active" | "committed" | "rolled_back" | "partial_rollback";
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export interface RollbackStats {
  totalTransactions: number;
  committed: number;
  rolledBack: number;
  partialRollbacks: number;
  totalActionsRolledBack: number;
}

/**
 * Rollback Manager
 * Manages compensating transactions for safe rollback
 */
export class RollbackManager {
  private transactions: Map<string, RollbackTransaction> = new Map();
  private stats: RollbackStats = {
    totalTransactions: 0,
    committed: 0,
    rolledBack: 0,
    partialRollbacks: 0,
    totalActionsRolledBack: 0,
  };

  /**
   * Begin a new transaction
   */
  begin(name: string): string {
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.transactions.set(txId, {
      id: txId,
      name,
      actions: [],
      status: "active",
      startedAt: Date.now(),
    });
    this.stats.totalTransactions++;
    return txId;
  }

  /**
   * Register a compensating action for a step
   */
  register(
    txId: string,
    name: string,
    compensate: () => Promise<void>,
    description = ""
  ): string {
    const tx = this.getActiveTransaction(txId);
    const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    tx.actions.push({
      id: actionId,
      name,
      description,
      compensate,
      registeredAt: Date.now(),
      status: "pending",
    });

    return actionId;
  }

  /**
   * Mark an action as executed (so it will be rolled back if needed)
   */
  markExecuted(txId: string, actionId: string): void {
    const tx = this.getActiveTransaction(txId);
    const action = tx.actions.find((a) => a.id === actionId);
    if (action) {
      action.status = "executed";
      action.executedAt = Date.now();
    }
  }

  /**
   * Commit a transaction (no rollback needed)
   */
  commit(txId: string): void {
    const tx = this.getActiveTransaction(txId);
    tx.status = "committed";
    tx.endedAt = Date.now();
    this.stats.committed++;
  }

  /**
   * Rollback a transaction by executing compensating actions in reverse
   */
  async rollback(txId: string, reason?: string): Promise<RollbackResult> {
    const tx = this.getActiveTransaction(txId);
    tx.status = "rolled_back";
    tx.endedAt = Date.now();
    if (reason) tx.error = reason;

    // Execute compensating actions in reverse order
    const executedActions = tx.actions
      .filter((a) => a.status === "executed")
      .reverse();

    const results: Array<{ actionId: string; success: boolean; error?: string }> = [];
    let allSucceeded = true;

    for (const action of executedActions) {
      try {
        await action.compensate();
        action.status = "rolled_back";
        action.rolledBackAt = Date.now();
        results.push({ actionId: action.id, success: true });
        this.stats.totalActionsRolledBack++;
      } catch (err) {
        action.status = "rollback_failed";
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ actionId: action.id, success: false, error: errorMsg });
        allSucceeded = false;
      }
    }

    if (!allSucceeded) {
      tx.status = "partial_rollback";
      this.stats.partialRollbacks++;
    } else {
      this.stats.rolledBack++;
    }

    return {
      txId,
      success: allSucceeded,
      actionsRolledBack: results.filter((r) => r.success).length,
      actionsFailed: results.filter((r) => !r.success).length,
      results,
    };
  }

  /**
   * Execute a function within a managed transaction
   */
  async withTransaction<T>(
    name: string,
    fn: (txId: string) => Promise<T>
  ): Promise<T> {
    const txId = this.begin(name);
    try {
      const result = await fn(txId);
      this.commit(txId);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.rollback(txId, reason);
      throw err;
    }
  }

  /**
   * Get transaction by ID
   */
  getTransaction(txId: string): RollbackTransaction | null {
    return this.transactions.get(txId) || null;
  }

  /**
   * Get active transaction or throw
   */
  private getActiveTransaction(txId: string): RollbackTransaction {
    const tx = this.transactions.get(txId);
    if (!tx) throw new Error(`Transaction ${txId} not found`);
    if (tx.status !== "active") throw new Error(`Transaction ${txId} is not active (status: ${tx.status})`);
    return tx;
  }

  /**
   * Get statistics
   */
  getStats(): RollbackStats {
    return { ...this.stats };
  }

  /**
   * Get recent transactions
   */
  getRecentTransactions(limit = 20): RollbackTransaction[] {
    return Array.from(this.transactions.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Clear old committed transactions
   */
  cleanup(olderThanMs = 3600000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, tx] of this.transactions.entries()) {
      if (tx.status === "committed" && tx.endedAt && tx.endedAt < cutoff) {
        this.transactions.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

export interface RollbackResult {
  txId: string;
  success: boolean;
  actionsRolledBack: number;
  actionsFailed: number;
  results: Array<{ actionId: string; success: boolean; error?: string }>;
}

/**
 * Global rollback manager
 */
export const rollbackManager = new RollbackManager();

/**
 * Usage example:
 *
 * const txId = rollbackManager.begin("swap_operation");
 *
 * // Step 1: deduct balance
 * const step1 = rollbackManager.register(txId, "deduct_balance", async () => {
 *   await refundBalance(userId, amount);
 * });
 * await deductBalance(userId, amount);
 * rollbackManager.markExecuted(txId, step1);
 *
 * // Step 2: submit transaction
 * const step2 = rollbackManager.register(txId, "submit_tx", async () => {
 *   await cancelTransaction(txHash);
 * });
 * const txHash = await submitTransaction(xdr);
 * rollbackManager.markExecuted(txId, step2);
 *
 * // All good — commit
 * rollbackManager.commit(txId);
 *
 * // Or on error — rollback
 * const result = await rollbackManager.rollback(txId, "Network error");
 * console.log("Rolled back:", result.actionsRolledBack, "actions");
 */
