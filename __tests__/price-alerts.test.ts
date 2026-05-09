import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createAlert,
  getAlerts,
  getActiveAlerts,
  getTriggeredAlerts,
  deleteAlert,
  deleteAllAlerts,
  checkAlerts,
  calculatePrice,
  formatPrice,
  getAlertStats,
} from "@/lib/agent/price-alerts";

describe("Price Alerts", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    // Clean up after each test
    localStorage.clear();
  });

  describe("createAlert", () => {
    it("should create a valid alert", () => {
      const result = createAlert("TKNA/TKNB", 1.5, "above");
      expect(result.success).toBe(true);
      expect(result.alert).toBeDefined();
      expect(result.alert?.tokenPair).toBe("TKNA/TKNB");
      expect(result.alert?.targetPrice).toBe(1.5);
      expect(result.alert?.condition).toBe("above");
      expect(result.alert?.triggered).toBe(false);
    });

    it("should reject negative target price", () => {
      const result = createAlert("TKNA/TKNB", -1, "above");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject zero target price", () => {
      const result = createAlert("TKNA/TKNB", 0, "above");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should enforce max alerts limit", () => {
      // Create 10 alerts (max)
      for (let i = 0; i < 10; i++) {
        const result = createAlert("TKNA/TKNB", 1.0 + i, "above");
        expect(result.success).toBe(true);
      }

      // 11th alert should fail
      const result = createAlert("TKNA/TKNB", 20, "above");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Maximum");
    });
  });

  describe("getAlerts", () => {
    it("should return empty array when no alerts", () => {
      const alerts = getAlerts();
      expect(alerts).toEqual([]);
    });

    it("should return all alerts", () => {
      createAlert("TKNA/TKNB", 1.5, "above");
      createAlert("TKNB/TKNA", 0.5, "below");

      const alerts = getAlerts();
      expect(alerts).toHaveLength(2);
    });
  });

  describe("deleteAlert", () => {
    it("should delete an alert by id", () => {
      const result = createAlert("TKNA/TKNB", 1.5, "above");
      expect(result.success).toBe(true);

      const alertId = result.alert!.id;
      const deleted = deleteAlert(alertId);
      expect(deleted).toBe(true);

      const alerts = getAlerts();
      expect(alerts).toHaveLength(0);
    });
  });

  describe("deleteAllAlerts", () => {
    it("should delete all alerts", () => {
      createAlert("TKNA/TKNB", 1.5, "above");
      createAlert("TKNB/TKNA", 0.5, "below");

      const deleted = deleteAllAlerts();
      expect(deleted).toBe(true);

      const alerts = getAlerts();
      expect(alerts).toHaveLength(0);
    });
  });

  describe("checkAlerts", () => {
    it("should trigger alert when price goes above target", () => {
      const result = createAlert("TKNA/TKNB", 1.5, "above");
      const alertId = result.alert!.id;

      // Price is now 2.0, above target of 1.5
      const triggered = checkAlerts(2.0, 0.5);
      expect(triggered).toContain(alertId);

      const alerts = getAlerts();
      const alert = alerts.find((a) => a.id === alertId);
      expect(alert?.triggered).toBe(true);
      expect(alert?.triggeredAt).toBeDefined();
    });

    it("should trigger alert when price goes below target", () => {
      const result = createAlert("TKNA/TKNB", 1.5, "below");
      const alertId = result.alert!.id;

      // Price is now 1.0, below target of 1.5
      const triggered = checkAlerts(1.0, 1.0);
      expect(triggered).toContain(alertId);

      const alerts = getAlerts();
      const alert = alerts.find((a) => a.id === alertId);
      expect(alert?.triggered).toBe(true);
    });

    it("should not trigger alert when condition not met", () => {
      createAlert("TKNA/TKNB", 1.5, "above");

      // Price is 1.0, below target of 1.5
      const triggered = checkAlerts(1.0, 1.0);
      expect(triggered).toHaveLength(0);

      const activeAlerts = getActiveAlerts();
      expect(activeAlerts).toHaveLength(1);
    });

    it("should not re-trigger already triggered alerts", () => {
      const result = createAlert("TKNA/TKNB", 1.5, "above");
      const alertId = result.alert!.id;

      // First trigger
      checkAlerts(2.0, 0.5);

      // Second check with same price
      const triggered = checkAlerts(2.0, 0.5);
      expect(triggered).toHaveLength(0); // Should not trigger again
    });

    it("should handle TKNB/TKNA pair correctly", () => {
      const result = createAlert("TKNB/TKNA", 0.5, "below");
      const alertId = result.alert!.id;

      // priceBtoA is 0.4, below target of 0.5
      const triggered = checkAlerts(2.0, 0.4);
      expect(triggered).toContain(alertId);
    });
  });

  describe("getActiveAlerts and getTriggeredAlerts", () => {
    it("should separate active and triggered alerts", () => {
      createAlert("TKNA/TKNB", 1.5, "above");
      createAlert("TKNA/TKNB", 2.0, "above");

      // Trigger one alert
      checkAlerts(1.8, 0.5);

      const active = getActiveAlerts();
      const triggered = getTriggeredAlerts();

      expect(active).toHaveLength(1);
      expect(triggered).toHaveLength(1);
    });
  });

  describe("calculatePrice", () => {
    it("should calculate TKNA/TKNB price correctly", () => {
      const price = calculatePrice(1000000n, 1500000n, "TKNA/TKNB");
      expect(price).toBe(1.5);
    });

    it("should calculate TKNB/TKNA price correctly", () => {
      const price = calculatePrice(1000000n, 1500000n, "TKNB/TKNA");
      expect(price).toBeCloseTo(0.6667, 4);
    });

    it("should return 0 for zero reserves", () => {
      const price1 = calculatePrice(0n, 1000000n, "TKNA/TKNB");
      const price2 = calculatePrice(1000000n, 0n, "TKNA/TKNB");
      expect(price1).toBe(0);
      expect(price2).toBe(0);
    });
  });

  describe("formatPrice", () => {
    it("should format zero correctly", () => {
      expect(formatPrice(0)).toBe("0.0000");
    });

    it("should format very small numbers in exponential notation", () => {
      const formatted = formatPrice(0.00001);
      expect(formatted).toContain("e");
    });

    it("should format small numbers with 6 decimals", () => {
      expect(formatPrice(0.123456)).toBe("0.123456");
    });

    it("should format medium numbers with 4 decimals", () => {
      expect(formatPrice(1.5)).toBe("1.5000");
    });

    it("should format large numbers with 2 decimals", () => {
      expect(formatPrice(123.456)).toBe("123.46");
    });
  });

  describe("getAlertStats", () => {
    it("should return correct stats", () => {
      createAlert("TKNA/TKNB", 1.5, "above");
      createAlert("TKNA/TKNB", 2.0, "above");
      createAlert("TKNB/TKNA", 0.5, "below");

      // Trigger one alert (price 1.8 triggers the 1.5 "above" alert, but not the 2.0 "above" alert)
      // priceBtoA 0.4 triggers the 0.5 "below" alert
      checkAlerts(1.8, 0.4);

      const stats = getAlertStats();
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.triggered).toBe(2);
    });

    it("should return zero stats when no alerts", () => {
      const stats = getAlertStats();
      expect(stats.total).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.triggered).toBe(0);
    });
  });

  describe("localStorage error handling", () => {
    it("should handle localStorage errors gracefully", () => {
      // Mock localStorage to throw an error
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => {
        throw new Error("QuotaExceededError");
      };

      const result = createAlert("TKNA/TKNB", 1.5, "above");
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Restore original
      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe("triggered alert cleanup", () => {
    it("should clean up old triggered alerts on load", () => {
      // Create and trigger an alert
      const result = createAlert("TKNA/TKNB", 1.5, "above");
      checkAlerts(2.0, 0.5);

      // Manually set triggeredAt to 25 hours ago
      const alerts = getAlerts();
      alerts[0].triggeredAt = Date.now() - 25 * 60 * 60 * 1000;
      localStorage.setItem("stellar-pay-price-alerts", JSON.stringify(alerts));

      // Load alerts should clean up old ones
      const loaded = getAlerts();
      expect(loaded).toHaveLength(0);
    });

    it("should keep recent triggered alerts", () => {
      // Create and trigger an alert
      createAlert("TKNA/TKNB", 1.5, "above");
      checkAlerts(2.0, 0.5);

      // Load alerts should keep recent ones
      const loaded = getAlerts();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].triggered).toBe(true);
    });
  });
});
