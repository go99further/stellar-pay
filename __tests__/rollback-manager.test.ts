import { describe, it, expect, beforeEach, vi } from "vitest";
import { RollbackManager } from "../lib/agent/recovery/rollback-manager";

describe("RollbackManager", () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager();
  });

  describe("begin / commit", () => {
    it("should begin a transaction and return an id", () => {
      const txId = manager.begin("test_tx");
      expect(txId).toMatch(/^tx_/);
    });

    it("should commit a transaction", () => {
      const txId = manager.begin("test_tx");
      manager.commit(txId);
      const tx = manager.getTransaction(txId);
      expect(tx?.status).toBe("committed");
    });

    it("should increment stats on commit", () => {
      const txId = manager.begin("test_tx");
      manager.commit(txId);
      expect(manager.getStats().committed).toBe(1);
    });

    it("should throw when committing non-existent transaction", () => {
      expect(() => manager.commit("bad_id")).toThrow();
    });
  });

  describe("register / markExecuted / rollback", () => {
    it("should rollback executed actions in reverse order", async () => {
      const order: string[] = [];
      const txId = manager.begin("multi_step");

      const a1 = manager.register(txId, "step1", async () => { order.push("undo1"); });
      const a2 = manager.register(txId, "step2", async () => { order.push("undo2"); });
      const a3 = manager.register(txId, "step3", async () => { order.push("undo3"); });

      manager.markExecuted(txId, a1);
      manager.markExecuted(txId, a2);
      manager.markExecuted(txId, a3);

      const result = await manager.rollback(txId);

      expect(result.success).toBe(true);
      expect(result.actionsRolledBack).toBe(3);
      expect(order).toEqual(["undo3", "undo2", "undo1"]);
    });

    it("should only rollback executed actions, not pending ones", async () => {
      const compensated: string[] = [];
      const txId = manager.begin("partial");

      const a1 = manager.register(txId, "step1", async () => { compensated.push("undo1"); });
      manager.register(txId, "step2", async () => { compensated.push("undo2"); });

      manager.markExecuted(txId, a1);
      // a2 never marked executed

      const result = await manager.rollback(txId);
      expect(result.actionsRolledBack).toBe(1);
      expect(compensated).toEqual(["undo1"]);
    });

    it("should handle partial rollback when a compensate throws", async () => {
      const txId = manager.begin("failing_rollback");

      const a1 = manager.register(txId, "step1", async () => {});
      const a2 = manager.register(txId, "step2", async () => { throw new Error("compensate failed"); });

      manager.markExecuted(txId, a1);
      manager.markExecuted(txId, a2);

      const result = await manager.rollback(txId);
      expect(result.success).toBe(false);
      expect(result.actionsFailed).toBe(1);
      expect(result.actionsRolledBack).toBe(1);

      const tx = manager.getTransaction(txId);
      expect(tx?.status).toBe("partial_rollback");
    });

    it("should update stats for rolled back transactions", async () => {
      const txId = manager.begin("stats_tx");
      const a1 = manager.register(txId, "step1", async () => {});
      manager.markExecuted(txId, a1);
      await manager.rollback(txId);

      const stats = manager.getStats();
      expect(stats.rolledBack).toBe(1);
      expect(stats.totalActionsRolledBack).toBe(1);
    });
  });

  describe("withTransaction", () => {
    it("should commit on success", async () => {
      const result = await manager.withTransaction("auto_commit", async (txId) => {
        manager.register(txId, "step", async () => {});
        return "ok";
      });
      expect(result).toBe("ok");
      expect(manager.getStats().committed).toBe(1);
    });

    it("should rollback on error and rethrow", async () => {
      const compensated: boolean[] = [];

      await expect(
        manager.withTransaction("auto_rollback", async (txId) => {
          const a = manager.register(txId, "step", async () => { compensated.push(true); });
          manager.markExecuted(txId, a);
          throw new Error("operation failed");
        })
      ).rejects.toThrow("operation failed");

      expect(compensated).toEqual([true]);
      expect(manager.getStats().rolledBack).toBe(1);
    });
  });

  describe("getRecentTransactions", () => {
    it("should return transactions sorted by start time descending", () => {
      manager.begin("tx1");
      manager.begin("tx2");
      manager.begin("tx3");

      const recent = manager.getRecentTransactions(2);
      expect(recent.length).toBe(2);
      expect(recent[0].startedAt).toBeGreaterThanOrEqual(recent[1].startedAt);
    });
  });

  describe("cleanup", () => {
    it("should remove old committed transactions", () => {
      const txId = manager.begin("old_tx");
      manager.commit(txId);

      // Manually backdate the transaction
      const tx = manager.getTransaction(txId)!;
      (tx as { endedAt: number }).endedAt = Date.now() - 7200000; // 2 hours ago

      const removed = manager.cleanup(3600000); // 1 hour cutoff
      expect(removed).toBe(1);
      expect(manager.getTransaction(txId)).toBeNull();
    });

    it("should not remove active transactions", () => {
      manager.begin("active_tx");
      const removed = manager.cleanup(0);
      expect(removed).toBe(0);
    });
  });
});
