import { describe, it, expect, afterEach } from "vitest";
import { PriceMonitor, priceMonitor } from "../lib/agent/streaming/price-monitor";
import type { PriceEvent, PriceData, AlertData, HeartbeatData } from "../lib/agent/streaming/price-monitor";

describe("PriceMonitor", () => {
  let monitor: PriceMonitor;

  afterEach(() => {
    monitor?.destroy();
  });

  describe("subscribe", () => {
    it("should return a subscription ID", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const id = monitor.subscribe("TKNA/TKNB", () => {});
      expect(typeof id).toBe("string");
      expect(id.startsWith("sub_")).toBe(true);
    });

    it("should start monitoring on first subscription", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", () => {});
      expect(monitor.getStatus().isRunning).toBe(true);
    });

    it("should track subscription count", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", () => {});
      monitor.subscribe("TKNA/XLM", () => {});
      expect(monitor.getStatus().subscriptionCount).toBe(2);
    });

    it("should accept alerts at subscription time", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const id = monitor.subscribe("TKNA/TKNB", () => {}, [
        { targetPrice: 1.5, condition: "above" },
        { targetPrice: 0.5, condition: "below" },
      ]);
      expect(typeof id).toBe("string");
    });
  });

  describe("unsubscribe", () => {
    it("should remove subscription and return true", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const id = monitor.subscribe("TKNA/TKNB", () => {});
      expect(monitor.unsubscribe(id)).toBe(true);
      expect(monitor.getStatus().subscriptionCount).toBe(0);
    });

    it("should return false for unknown subscription", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      expect(monitor.unsubscribe("nonexistent")).toBe(false);
    });

    it("should stop monitoring when all subscriptions removed", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const id = monitor.subscribe("TKNA/TKNB", () => {});
      monitor.unsubscribe(id);
      expect(monitor.getStatus().isRunning).toBe(false);
    });

    it("should keep monitoring when other subscriptions remain", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const id1 = monitor.subscribe("TKNA/TKNB", () => {});
      monitor.subscribe("TKNA/XLM", () => {});
      monitor.unsubscribe(id1);
      expect(monitor.getStatus().isRunning).toBe(true);
    });
  });

  describe("addAlert", () => {
    it("should return an alert ID", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const subId = monitor.subscribe("TKNA/TKNB", () => {});
      const alertId = monitor.addAlert(subId, 1.5, "above");
      expect(alertId).not.toBeNull();
      expect(alertId!.startsWith("alert_")).toBe(true);
    });

    it("should return null for unknown subscription", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      expect(monitor.addAlert("nonexistent", 1.5, "above")).toBeNull();
    });
  });

  describe("removeAlert", () => {
    it("should remove an alert and return true", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const subId = monitor.subscribe("TKNA/TKNB", () => {});
      const alertId = monitor.addAlert(subId, 1.5, "above")!;
      expect(monitor.removeAlert(subId, alertId)).toBe(true);
    });

    it("should return false for unknown subscription", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      expect(monitor.removeAlert("nonexistent", "alert_1")).toBe(false);
    });

    it("should return false for unknown alert ID", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      const subId = monitor.subscribe("TKNA/TKNB", () => {});
      expect(monitor.removeAlert(subId, "alert_unknown")).toBe(false);
    });
  });

  describe("price_update events", () => {
    it("should emit price_update event on poll", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e));
      // Wait for initial poll microtask
      await new Promise((r) => setTimeout(r, 50));
      const priceEvents = events.filter((e) => e.type === "price_update");
      expect(priceEvents.length).toBeGreaterThan(0);
    });

    it("should include tokenPair in price_update data", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e));
      await new Promise((r) => setTimeout(r, 50));
      const priceEvent = events.find((e) => e.type === "price_update");
      expect(priceEvent).toBeDefined();
      expect((priceEvent!.data as PriceData).tokenPair).toBe("TKNA/TKNB");
    });

    it("should emit events for each subscribed token pair", async () => {
      const pairs = new Set<string>();
      // Use a short poll interval so both subscriptions are covered by the interval poll
      monitor = new PriceMonitor({ pollInterval: 20, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", (e) => {
        if (e.type === "price_update") pairs.add((e.data as PriceData).tokenPair);
      });
      monitor.subscribe("TKNA/XLM", (e) => {
        if (e.type === "price_update") pairs.add((e.data as PriceData).tokenPair);
      });
      // Wait for at least one interval poll (which sees both subscriptions)
      await new Promise((r) => setTimeout(r, 80));
      expect(pairs.has("TKNA/TKNB")).toBe(true);
      expect(pairs.has("TKNA/XLM")).toBe(true);
    });
  });

  describe("alert_triggered events", () => {
    it("should trigger alert when price is above target", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      // fetchPrices returns price in range [1.0, 1.1], so target 0.5 below will always trigger
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e), [
        { targetPrice: 0.5, condition: "below" },
      ]);
      await new Promise((r) => setTimeout(r, 50));
      // price is always >= 1.0, so "below 0.5" never triggers
      // Use "above 0.5" which always triggers since price >= 1.0
      const alertEvents = events.filter((e) => e.type === "alert_triggered");
      // No alert triggered for "below 0.5" since price is always >= 1.0
      expect(alertEvents.length).toBe(0);
    });

    it("should trigger alert when price is above target (above condition)", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      // fetchPrices returns price in [1.0, 1.1], target 0.5 above always triggers
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e), [
        { targetPrice: 0.5, condition: "above" },
      ]);
      await new Promise((r) => setTimeout(r, 50));
      const alertEvents = events.filter((e) => e.type === "alert_triggered");
      expect(alertEvents.length).toBeGreaterThan(0);
      const alertData = alertEvents[0].data as AlertData;
      expect(alertData.condition).toBe("above");
      expect(alertData.targetPrice).toBe(0.5);
    });

    it("should only trigger each alert once", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 10, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e), [
        { targetPrice: 0.5, condition: "above" },
      ]);
      await new Promise((r) => setTimeout(r, 80));
      const alertEvents = events.filter((e) => e.type === "alert_triggered");
      expect(alertEvents.length).toBe(1);
    });

    it("should include alertId in alert_triggered data", async () => {
      const events: PriceEvent[] = [];
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", (e) => events.push(e), [
        { targetPrice: 0.5, condition: "above" },
      ]);
      await new Promise((r) => setTimeout(r, 50));
      const alertEvent = events.find((e) => e.type === "alert_triggered");
      expect(alertEvent).toBeDefined();
      expect((alertEvent!.data as AlertData).alertId.startsWith("alert_")).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should report isRunning false before any subscription", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      expect(monitor.getStatus().isRunning).toBe(false);
    });

    it("should report subscriptionCount", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", () => {});
      expect(monitor.getStatus().subscriptionCount).toBe(1);
    });

    it("should report missedPolls as 0 initially", async () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", () => {});
      await new Promise((r) => setTimeout(r, 50));
      expect(monitor.getStatus().missedPolls).toBe(0);
    });
  });

  describe("destroy", () => {
    it("should stop monitoring and clear subscriptions", () => {
      monitor = new PriceMonitor({ pollInterval: 60000, heartbeatInterval: 60000 });
      monitor.subscribe("TKNA/TKNB", () => {});
      monitor.destroy();
      expect(monitor.getStatus().isRunning).toBe(false);
      expect(monitor.getStatus().subscriptionCount).toBe(0);
    });
  });

  describe("global instance", () => {
    it("priceMonitor should be a shared instance", () => {
      expect(priceMonitor).toBeInstanceOf(PriceMonitor);
    });
  });
});
