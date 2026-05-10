import { describe, it, expect, afterEach } from "vitest";
import { HeartbeatMonitor, HeartbeatManager, heartbeatManager } from "../lib/agent/monitoring/heartbeat";

describe("HeartbeatMonitor", () => {
  afterEach(() => {
    // ensure no leaked intervals
  });

  it("should start as disconnected", () => {
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    expect(monitor.isConnected()).toBe(false);
  });

  it("should become connected after start", async () => {
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(monitor.isConnected()).toBe(true);
    monitor.stop();
  });

  it("should emit heartbeat event on success", async () => {
    const events: string[] = [];
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    monitor.on((e) => events.push(e.type));
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toContain("heartbeat");
    monitor.stop();
  });

  it("should emit failure event when ping throws", async () => {
    const events: string[] = [];
    const monitor = new HeartbeatMonitor(
      async () => { throw new Error("ping failed"); },
      { interval: 60000, maxFailures: 10, timeout: 100, maxReconnectAttempts: 0 }
    );
    monitor.on((e) => events.push(e.type));
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toContain("failure");
    monitor.stop();
  });

  it("should emit disconnect after maxFailures", async () => {
    const events: string[] = [];
    const monitor = new HeartbeatMonitor(
      async () => { throw new Error("down"); },
      { interval: 60000, maxFailures: 1, timeout: 100, reconnectDelay: 0, maxReconnectAttempts: 0 }
    );
    monitor.on((e) => events.push(e.type));
    monitor.start();
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toContain("disconnect");
  });

  it("should stop and emit disconnect", async () => {
    const events: string[] = [];
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    monitor.on((e) => events.push(e.type));
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    monitor.stop();
    expect(events).toContain("disconnect");
    expect(monitor.isConnected()).toBe(false);
  });

  it("should not start twice", async () => {
    let pingCount = 0;
    const monitor = new HeartbeatMonitor(async () => { pingCount++; }, { interval: 60000 });
    monitor.start();
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(pingCount).toBe(1);
    monitor.stop();
  });

  it("should unsubscribe via returned function", async () => {
    const events: string[] = [];
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    const unsub = monitor.on((e) => events.push(e.type));
    unsub();
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(0);
    monitor.stop();
  });

  it("should track latency history", async () => {
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(monitor.getLatencyHistory().length).toBeGreaterThan(0);
    monitor.stop();
  });

  it("should return status snapshot", async () => {
    const monitor = new HeartbeatMonitor(async () => {}, { interval: 60000 });
    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    const status = monitor.getStatus();
    expect(status.connected).toBe(true);
    expect(status.consecutiveFailures).toBe(0);
    monitor.stop();
  });
});

describe("HeartbeatManager", () => {
  it("should add and retrieve a connection", async () => {
    const manager = new HeartbeatManager();
    manager.addConnection("rpc", async () => {}, { interval: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.getMonitor("rpc")).not.toBeNull();
    manager.stopAll();
  });

  it("should throw when adding duplicate connection", () => {
    const manager = new HeartbeatManager();
    manager.addConnection("rpc", async () => {}, { interval: 60000 });
    expect(() => manager.addConnection("rpc", async () => {})).toThrow();
    manager.stopAll();
  });

  it("should remove a connection", () => {
    const manager = new HeartbeatManager();
    manager.addConnection("rpc", async () => {}, { interval: 60000 });
    const removed = manager.removeConnection("rpc");
    expect(removed).toBe(true);
    expect(manager.getMonitor("rpc")).toBeNull();
  });

  it("should return false when removing non-existent connection", () => {
    const manager = new HeartbeatManager();
    expect(manager.removeConnection("nonexistent")).toBe(false);
  });

  it("should report healthy when all connected", async () => {
    const manager = new HeartbeatManager();
    manager.addConnection("a", async () => {}, { interval: 60000 });
    manager.addConnection("b", async () => {}, { interval: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.isHealthy()).toBe(true);
    manager.stopAll();
  });

  it("should get all statuses", async () => {
    const manager = new HeartbeatManager();
    manager.addConnection("a", async () => {}, { interval: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    const statuses = manager.getAllStatus();
    expect(statuses["a"]).toBeDefined();
    expect(statuses["a"].connected).toBe(true);
    manager.stopAll();
  });

  it("should get statistics", async () => {
    const manager = new HeartbeatManager();
    manager.addConnection("a", async () => {}, { interval: 60000 });
    manager.addConnection("b", async () => {}, { interval: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    const stats = manager.getStatistics();
    expect(stats.totalConnections).toBe(2);
    expect(stats.connectedCount).toBe(2);
    manager.stopAll();
  });

  it("should stop all monitors", async () => {
    const manager = new HeartbeatManager();
    manager.addConnection("a", async () => {}, { interval: 60000 });
    await Promise.resolve();
    await Promise.resolve();
    manager.stopAll();
    expect(manager.isHealthy()).toBe(false);
  });
});

describe("heartbeatManager — shared instance", () => {
  it("should be a HeartbeatManager instance", () => {
    expect(heartbeatManager).toBeInstanceOf(HeartbeatManager);
  });

  it("getStatistics should return an object with totalConnections", () => {
    const stats = heartbeatManager.getStatistics();
    expect(stats).toHaveProperty("totalConnections");
    expect(typeof stats.totalConnections).toBe("number");
  });
});
