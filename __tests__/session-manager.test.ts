import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager, sessionManager } from "../lib/agent/memory/session-manager";

describe("SessionManager", () => {
  let mgr: SessionManager;

  beforeEach(() => {
    localStorage.clear();
    mgr = new SessionManager({
      sessionTimeout: 60000,
      maxHistorySize: 10,
      compressionThreshold: 5,
    });
  });

  afterEach(() => {
    mgr.stopCleanupTimer();
    localStorage.clear();
  });

  describe("createSession", () => {
    it("should create a session and return it", () => {
      const session = mgr.createSession("user-1");
      expect(session.sessionId.startsWith("session_")).toBe(true);
      expect(session.userId).toBe("user-1");
    });

    it("should set expiry in the future", () => {
      const session = mgr.createSession("user-1");
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should initialize empty conversation history", () => {
      const session = mgr.createSession("user-1");
      expect(session.context.conversationHistory).toHaveLength(0);
    });

    it("should store metadata", () => {
      const session = mgr.createSession("user-1", { source: "web" });
      expect(session.metadata.source).toBe("web");
    });
  });

  describe("getSession", () => {
    it("should retrieve an existing session", () => {
      const created = mgr.createSession("user-1");
      const retrieved = mgr.getSession(created.sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
    });

    it("should return null for unknown session", () => {
      expect(mgr.getSession("nonexistent")).toBeNull();
    });

    it("should return null for expired session", () => {
      const mgr2 = new SessionManager({ sessionTimeout: 1 });
      const session = mgr2.createSession("user-1");
      // Force expiry
      session.expiresAt = Date.now() - 1;
      expect(mgr2.getSession(session.sessionId)).toBeNull();
      mgr2.stopCleanupTimer();
    });

    it("should update lastAccessedAt on access", () => {
      const session = mgr.createSession("user-1");
      const before = session.lastAccessedAt;
      const retrieved = mgr.getSession(session.sessionId)!;
      expect(retrieved.lastAccessedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("addMessage", () => {
    it("should add a message to conversation history", () => {
      const session = mgr.createSession("user-1");
      const ok = mgr.addMessage(session.sessionId, {
        role: "user",
        content: "Hello",
        timestamp: Date.now(),
      });
      expect(ok).toBe(true);
      expect(mgr.getSession(session.sessionId)!.context.conversationHistory).toHaveLength(1);
    });

    it("should return false for unknown session", () => {
      expect(mgr.addMessage("unknown", { role: "user", content: "hi", timestamp: Date.now() })).toBe(false);
    });

    it("should trim history when exceeding maxHistorySize", () => {
      const session = mgr.createSession("user-1");
      for (let i = 0; i < 15; i++) {
        mgr.addMessage(session.sessionId, { role: "user", content: `msg-${i}`, timestamp: Date.now() });
      }
      const history = mgr.getSession(session.sessionId)!.context.conversationHistory;
      expect(history.length).toBeLessThanOrEqual(10);
    });
  });

  describe("updateSession", () => {
    it("should update session context", () => {
      const session = mgr.createSession("user-1");
      const ok = mgr.updateSession(session.sessionId, {
        userPreferences: {
          defaultSlippage: 2.0,
          defaultDeadline: 600,
          autoConfirm: true,
          theme: "dark",
        },
      });
      expect(ok).toBe(true);
      const updated = mgr.getSession(session.sessionId)!;
      expect(updated.context.userPreferences.defaultSlippage).toBe(2.0);
    });

    it("should return false for unknown session", () => {
      expect(mgr.updateSession("unknown", {})).toBe(false);
    });

    it("should compress when history reaches compressionThreshold", () => {
      // compressionThreshold=5, keep last 10 → with 5 msgs: 0 old + 5 recent = 5 (no summary)
      // Need more than 10 to actually produce a summary. Use threshold=3 to force it.
      const mgr2 = new SessionManager({ compressionThreshold: 3, maxHistorySize: 50 });
      const session = mgr2.createSession("user-1");
      for (let i = 0; i < 15; i++) {
        mgr2.addMessage(session.sessionId, { role: "user", content: `msg-${i}`, timestamp: Date.now() });
      }
      mgr2.updateSession(session.sessionId, {});
      const history = mgr2.getSession(session.sessionId)!.context.conversationHistory;
      // After compression: 1 summary + 10 recent = 11
      expect(history.length).toBeLessThanOrEqual(11);
      expect(history[0].metadata?.compressed).toBe(true);
      mgr2.stopCleanupTimer();
    });
  });

  describe("pendingOperations", () => {
    it("should add a pending operation", () => {
      const session = mgr.createSession("user-1");
      const opId = mgr.addPendingOperation(session.sessionId, {
        type: "swap",
        status: "pending",
        data: { amountIn: "10" },
      });
      expect(opId).not.toBeNull();
      expect(opId!.startsWith("op_")).toBe(true);
    });

    it("should return null for unknown session", () => {
      expect(mgr.addPendingOperation("unknown", { type: "swap", status: "pending", data: {} })).toBeNull();
    });

    it("should update operation status", () => {
      const session = mgr.createSession("user-1");
      const opId = mgr.addPendingOperation(session.sessionId, {
        type: "swap",
        status: "pending",
        data: {},
      })!;
      const ok = mgr.updatePendingOperation(session.sessionId, opId, "executing");
      expect(ok).toBe(true);
      const op = mgr.getSession(session.sessionId)!.context.pendingOperations[0];
      expect(op.status).toBe("executing");
    });

    it("should return false when updating unknown operation", () => {
      const session = mgr.createSession("user-1");
      expect(mgr.updatePendingOperation(session.sessionId, "unknown-op", "completed")).toBe(false);
    });

    it("should remove a pending operation", () => {
      const session = mgr.createSession("user-1");
      const opId = mgr.addPendingOperation(session.sessionId, {
        type: "swap",
        status: "pending",
        data: {},
      })!;
      const ok = mgr.removePendingOperation(session.sessionId, opId);
      expect(ok).toBe(true);
      expect(mgr.getSession(session.sessionId)!.context.pendingOperations).toHaveLength(0);
    });

    it("should return false when removing unknown operation", () => {
      const session = mgr.createSession("user-1");
      expect(mgr.removePendingOperation(session.sessionId, "unknown")).toBe(false);
    });
  });

  describe("deleteSession", () => {
    it("should delete an existing session", () => {
      const session = mgr.createSession("user-1");
      expect(mgr.deleteSession(session.sessionId)).toBe(true);
      expect(mgr.getSession(session.sessionId)).toBeNull();
    });

    it("should return false for unknown session", () => {
      expect(mgr.deleteSession("unknown")).toBe(false);
    });
  });

  describe("getUserSessions", () => {
    it("should return all sessions for a user", () => {
      mgr.createSession("alice");
      mgr.createSession("alice");
      mgr.createSession("bob");
      expect(mgr.getUserSessions("alice")).toHaveLength(2);
      expect(mgr.getUserSessions("bob")).toHaveLength(1);
    });

    it("should return empty array for unknown user", () => {
      expect(mgr.getUserSessions("nobody")).toHaveLength(0);
    });
  });

  describe("getStatistics", () => {
    it("should count sessions and messages", () => {
      const s1 = mgr.createSession("user-1");
      mgr.addMessage(s1.sessionId, { role: "user", content: "hi", timestamp: Date.now() });
      mgr.addMessage(s1.sessionId, { role: "assistant", content: "hello", timestamp: Date.now() });
      const s2 = mgr.createSession("user-2");
      mgr.addPendingOperation(s2.sessionId, { type: "swap", status: "pending", data: {} });

      const stats = mgr.getStatistics();
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);
      expect(stats.totalMessages).toBe(2);
      expect(stats.totalPendingOperations).toBe(1);
    });
  });

  describe("global instance", () => {
    it("sessionManager should be a shared instance", () => {
      expect(sessionManager).toBeInstanceOf(SessionManager);
    });
  });
});
