import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OutboxStore } from "../lib/agent/outbox";
import type { OutboxMessage, OutboxPublisher } from "../lib/agent/outbox";

function makePublisher(onPublish?: (msg: OutboxMessage) => void): OutboxPublisher {
  return {
    async publish(msg) {
      onPublish?.(msg);
    },
  };
}

function makeFailingPublisher(failTimes = Infinity): OutboxPublisher {
  let calls = 0;
  return {
    async publish() {
      if (calls++ < failTimes) throw new Error("publish failed");
    },
  };
}

describe("OutboxStore", () => {
  let store: OutboxStore;

  beforeEach(() => {
    store = new OutboxStore({ maxAttempts: 3, baseDelayMs: 0 });
  });

  afterEach(() => {
    store.stopPolling();
  });

  describe("write()", () => {
    it("should create a pending message", () => {
      const msg = store.write("payments", { amount: 100 });
      expect(msg.status).toBe("pending");
      expect(msg.topic).toBe("payments");
      expect(msg.attempts).toBe(0);
    });

    it("should assign a unique id", () => {
      const a = store.write("topic", {});
      const b = store.write("topic", {});
      expect(a.id).not.toBe(b.id);
    });

    it("should deduplicate by idempotency key", () => {
      const a = store.write("topic", { v: 1 }, "key-1");
      const b = store.write("topic", { v: 2 }, "key-1");
      expect(a.id).toBe(b.id);
      expect(store.getPending()).toHaveLength(1);
    });

    it("should allow different idempotency keys", () => {
      store.write("topic", {}, "key-1");
      store.write("topic", {}, "key-2");
      expect(store.getPending()).toHaveLength(2);
    });
  });

  describe("processNext()", () => {
    it("should deliver a pending message", async () => {
      const published: OutboxMessage[] = [];
      store.write("payments", { amount: 50 });
      const result = await store.processNext(makePublisher((m) => published.push(m)));
      expect(result?.status).toBe("delivered");
      expect(published).toHaveLength(1);
    });

    it("should return null when no pending messages", async () => {
      const result = await store.processNext(makePublisher());
      expect(result).toBeNull();
    });

    it("should increment attempts on failure", async () => {
      store.write("topic", {});
      const result = await store.processNext(makeFailingPublisher());
      expect(result?.attempts).toBe(1);
      expect(result?.status).toBe("pending");
    });

    it("should move to dead after maxAttempts failures", async () => {
      store.write("topic", {});
      for (let i = 0; i < 3; i++) {
        await store.processNext(makeFailingPublisher());
      }
      expect(store.getDead()).toHaveLength(1);
      expect(store.getPending()).toHaveLength(0);
    });

    it("should record lastError on failure", async () => {
      store.write("topic", {});
      const result = await store.processNext(makeFailingPublisher());
      expect(result?.lastError).toMatch(/publish failed/);
    });

    it("should respect nextRetryAt delay", async () => {
      const store2 = new OutboxStore({ maxAttempts: 3, baseDelayMs: 100 });
      store2.write("topic", {});
      // First attempt fails, sets nextRetryAt 100ms in the future
      await store2.processNext(makeFailingPublisher());
      // Immediate retry should find nothing (nextRetryAt is in future)
      const result = await store2.processNext(makePublisher());
      expect(result).toBeNull();
    });
  });

  describe("processAll()", () => {
    it("should process all pending messages", async () => {
      store.write("a", {});
      store.write("b", {});
      store.write("c", {});
      const results = await store.processAll(makePublisher());
      expect(results).toHaveLength(3);
      expect(store.getDelivered()).toHaveLength(3);
    });

    it("should stop when no more pending", async () => {
      const results = await store.processAll(makePublisher());
      expect(results).toHaveLength(0);
    });
  });

  describe("getDelivered() / getDead()", () => {
    it("should track delivered messages", async () => {
      store.write("topic", { x: 1 });
      await store.processAll(makePublisher());
      expect(store.getDelivered()).toHaveLength(1);
      expect(store.getDelivered()[0].status).toBe("delivered");
    });

    it("should track dead messages", async () => {
      store.write("topic", {});
      for (let i = 0; i < 3; i++) {
        await store.processNext(makeFailingPublisher());
      }
      expect(store.getDead()).toHaveLength(1);
      expect(store.getDead()[0].status).toBe("dead");
    });
  });

  describe("requeue()", () => {
    it("should move dead message back to pending", async () => {
      store.write("topic", {});
      for (let i = 0; i < 3; i++) {
        await store.processNext(makeFailingPublisher());
      }
      const dead = store.getDead()[0];
      const requeued = store.requeue(dead.id);
      expect(requeued).toBe(true);
      expect(store.getDead()).toHaveLength(0);
      expect(store.getPending()).toHaveLength(1);
    });

    it("should reset attempts on requeue", async () => {
      store.write("topic", {});
      for (let i = 0; i < 3; i++) {
        await store.processNext(makeFailingPublisher());
      }
      const dead = store.getDead()[0];
      store.requeue(dead.id);
      const pending = store.getPending()[0];
      expect(pending.attempts).toBe(0);
    });

    it("should return false for unknown id", () => {
      expect(store.requeue("nonexistent")).toBe(false);
    });
  });

  describe("getStats()", () => {
    it("should track pending/delivered/dead counts", async () => {
      store.write("a", {});
      store.write("b", {});
      store.write("c", {});

      await store.processNext(makePublisher()); // delivers a
      for (let i = 0; i < 3; i++) {
        await store.processNext(makeFailingPublisher()); // kills b
      }

      const stats = store.getStats();
      expect(stats.delivered).toBe(1);
      expect(stats.dead).toBe(1);
      expect(stats.pending).toBe(1); // c still pending
    });
  });

  describe("polling", () => {
    it("should auto-process messages via polling", async () => {
      const published: OutboxMessage[] = [];
      store.write("topic", { v: 1 });
      store.startPolling(makePublisher((m) => published.push(m)));
      await new Promise((r) => setTimeout(r, 600));
      store.stopPolling();
      expect(published.length).toBeGreaterThanOrEqual(1);
    });
  });
});
