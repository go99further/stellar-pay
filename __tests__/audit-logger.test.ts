import { describe, it, expect, beforeEach } from "vitest";
import { AuditLogger, auditLogger } from "../lib/agent/monitoring/audit-logger";

describe("AuditLogger", () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger();
  });

  describe("log", () => {
    it("should return an audit entry", () => {
      const entry = logger.log("swap_initiated", "user-1", "pool-A", "success");
      expect(entry.id.startsWith("audit_")).toBe(true);
      expect(entry.action).toBe("swap_initiated");
      expect(entry.actor).toBe("user-1");
      expect(entry.resource).toBe("pool-A");
      expect(entry.outcome).toBe("success");
    });

    it("should assign sequential sequence numbers", () => {
      const e1 = logger.log("swap_initiated", "u", "r", "success");
      const e2 = logger.log("swap_completed", "u", "r", "success");
      expect(e2.sequence).toBe(e1.sequence + 1);
    });

    it("should set previousHash to genesis for first entry", () => {
      const entry = logger.log("swap_initiated", "u", "r", "success");
      expect(entry.previousHash).toBe("genesis");
    });

    it("should chain hashes between entries", () => {
      const e1 = logger.log("swap_initiated", "u", "r", "success");
      const e2 = logger.log("swap_completed", "u", "r", "success");
      expect(e2.previousHash).toBe(e1.hash);
    });

    it("should store details", () => {
      const entry = logger.log("swap_initiated", "u", "r", "success", { amount: 100 });
      expect(entry.details.amount).toBe(100);
    });

    it("should set timestamp", () => {
      const before = Date.now();
      const entry = logger.log("swap_initiated", "u", "r", "success");
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      logger.log("swap_initiated", "alice", "pool-A", "success");
      logger.log("swap_completed", "alice", "pool-A", "success");
      logger.log("swap_failed", "bob", "pool-B", "failure");
      logger.log("session_started", "alice", "session-1", "success");
    });

    it("should return all entries with no filter", () => {
      expect(logger.query()).toHaveLength(4);
    });

    it("should filter by action", () => {
      const results = logger.query({ action: "swap_initiated" });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("swap_initiated");
    });

    it("should filter by actor", () => {
      const results = logger.query({ actor: "alice" });
      expect(results).toHaveLength(3);
    });

    it("should filter by resource", () => {
      const results = logger.query({ resource: "pool-B" });
      expect(results).toHaveLength(1);
    });

    it("should filter by outcome", () => {
      const results = logger.query({ outcome: "failure" });
      expect(results).toHaveLength(1);
      expect(results[0].actor).toBe("bob");
    });

    it("should filter by startTime", () => {
      const future = Date.now() + 100000;
      const results = logger.query({ startTime: future });
      expect(results).toHaveLength(0);
    });

    it("should filter by endTime", () => {
      const past = Date.now() - 100000;
      const results = logger.query({ endTime: past });
      expect(results).toHaveLength(0);
    });

    it("should respect limit", () => {
      const results = logger.query({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("should return results newest first", () => {
      const results = logger.query();
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp).toBeGreaterThanOrEqual(results[i].timestamp);
      }
    });
  });

  describe("generateReport", () => {
    beforeEach(() => {
      logger.log("swap_initiated", "alice", "pool-A", "success");
      logger.log("swap_failed", "bob", "pool-B", "failure");
      logger.log("swap_initiated", "alice", "pool-A", "success");
    });

    it("should count total entries", () => {
      const report = logger.generateReport();
      expect(report.summary.total).toBe(3);
    });

    it("should count by action", () => {
      const report = logger.generateReport();
      expect(report.summary.byAction["swap_initiated"]).toBe(2);
      expect(report.summary.byAction["swap_failed"]).toBe(1);
    });

    it("should count by outcome", () => {
      const report = logger.generateReport();
      expect(report.summary.byOutcome["success"]).toBe(2);
      expect(report.summary.byOutcome["failure"]).toBe(1);
    });

    it("should count by actor", () => {
      const report = logger.generateReport();
      expect(report.summary.byActor["alice"]).toBe(2);
      expect(report.summary.byActor["bob"]).toBe(1);
    });

    it("should report integrityValid true for unmodified log", () => {
      const report = logger.generateReport();
      expect(report.integrityValid).toBe(true);
    });

    it("should include timeRange", () => {
      const report = logger.generateReport();
      expect(report.summary.timeRange.start).toBeGreaterThan(0);
      expect(report.summary.timeRange.end).toBeGreaterThanOrEqual(report.summary.timeRange.start);
    });

    it("should return zero timeRange for empty log", () => {
      const empty = new AuditLogger();
      const report = empty.generateReport();
      expect(report.summary.timeRange.start).toBe(0);
      expect(report.summary.timeRange.end).toBe(0);
    });
  });

  describe("verifyIntegrity", () => {
    it("should return true for empty log", () => {
      expect(logger.verifyIntegrity()).toBe(true);
    });

    it("should return true for single entry", () => {
      logger.log("swap_initiated", "u", "r", "success");
      expect(logger.verifyIntegrity()).toBe(true);
    });

    it("should return true for multiple entries", () => {
      logger.log("swap_initiated", "u", "r", "success");
      logger.log("swap_completed", "u", "r", "success");
      logger.log("swap_failed", "u", "r", "failure");
      expect(logger.verifyIntegrity()).toBe(true);
    });
  });

  describe("export", () => {
    it("should return valid JSON string", () => {
      logger.log("swap_initiated", "u", "r", "success");
      const json = logger.export();
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should include entries in export", () => {
      logger.log("swap_initiated", "u", "r", "success");
      const parsed = JSON.parse(logger.export());
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.exportedAt).toBeDefined();
    });
  });

  describe("getRecent", () => {
    it("should return most recent entries in reverse order", () => {
      for (let i = 0; i < 5; i++) {
        logger.log("swap_initiated", "u", "r", "success");
      }
      const recent = logger.getRecent(3);
      expect(recent).toHaveLength(3);
      // newest first
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i - 1].sequence).toBeGreaterThanOrEqual(recent[i].sequence);
      }
    });

    it("should default to 20 entries", () => {
      for (let i = 0; i < 25; i++) {
        logger.log("swap_initiated", "u", "r", "success");
      }
      expect(logger.getRecent()).toHaveLength(20);
    });
  });

  describe("global instance", () => {
    it("auditLogger should be a shared instance", () => {
      expect(auditLogger).toBeInstanceOf(AuditLogger);
    });
  });
});

describe("AuditLogger — additional coverage", () => {
  it("verifyIntegrity should return true for unmodified log", () => {
    const logger = new AuditLogger();
    logger.log("swap_initiated", "u", "r", "success");
    logger.log("swap_completed", "u", "r", "success");
    expect(logger.verifyIntegrity()).toBe(true);
  });

  it("query with startTime and endTime should filter correctly", () => {
    const logger = new AuditLogger();
    const before = Date.now();
    logger.log("swap_initiated", "u", "r", "success");
    const after = Date.now();
    logger.log("swap_completed", "u", "r", "success");

    const results = logger.query({ startTime: before, endTime: after });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("generateReport should include integrityValid=true for fresh log", () => {
    const logger = new AuditLogger();
    logger.log("swap_initiated", "u", "r", "success");
    const report = logger.generateReport();
    expect(report.integrityValid).toBe(true);
  });

  it("generateReport byActor should count correctly", () => {
    const logger = new AuditLogger();
    logger.log("swap_initiated", "alice", "r", "success");
    logger.log("swap_initiated", "alice", "r", "success");
    logger.log("swap_initiated", "bob", "r", "success");
    const report = logger.generateReport();
    expect(report.summary.byActor["alice"]).toBe(2);
    expect(report.summary.byActor["bob"]).toBe(1);
  });

  it("export should include entries and exportedAt fields", () => {
    const logger = new AuditLogger();
    logger.log("swap_initiated", "u", "r", "success");
    const parsed = JSON.parse(logger.export());
    expect(parsed.entries).toBeDefined();
    expect(parsed.exportedAt).toBeDefined();
  });
});
