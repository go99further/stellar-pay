/**
 * Price Alert Manager
 * Manages price alerts for TKNA/TKNB token pairs with localStorage persistence.
 */

export interface PriceAlert {
  id: string;
  tokenPair: "TKNA/TKNB" | "TKNB/TKNA";
  targetPrice: number;
  condition: "above" | "below";
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
}

const STORAGE_KEY = "stellar-pay-price-alerts";
const MAX_ALERTS = 10;
const TRIGGERED_ALERT_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

/**
 * Generate a unique alert ID
 */
function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Load alerts from localStorage with error handling
 */
export function loadAlerts(): PriceAlert[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const alerts = JSON.parse(stored) as PriceAlert[];
    // Clean up old triggered alerts
    const now = Date.now();
    const cleaned = alerts.filter((alert) => {
      if (!alert.triggered) return true;
      if (!alert.triggeredAt) return true;
      return now - alert.triggeredAt < TRIGGERED_ALERT_TTL;
    });
    // Save cleaned list if we removed any
    if (cleaned.length !== alerts.length) {
      saveAlerts(cleaned);
    }
    return cleaned;
  } catch (error) {
    console.error("Failed to load price alerts:", error);
    return [];
  }
}

/**
 * Save alerts to localStorage with error handling
 */
export function saveAlerts(alerts: PriceAlert[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    return true;
  } catch (error) {
    console.error("Failed to save price alerts:", error);
    return false;
  }
}

/**
 * Create a new price alert
 */
export function createAlert(
  tokenPair: "TKNA/TKNB" | "TKNB/TKNA",
  targetPrice: number,
  condition: "above" | "below"
): { success: boolean; alert?: PriceAlert; error?: string } {
  // Validate inputs
  if (targetPrice <= 0) {
    return { success: false, error: "Target price must be positive" };
  }

  const alerts = loadAlerts();

  // Check max alerts limit
  const activeAlerts = alerts.filter((a) => !a.triggered);
  if (activeAlerts.length >= MAX_ALERTS) {
    return {
      success: false,
      error: `Maximum ${MAX_ALERTS} active alerts allowed`,
    };
  }

  // Create new alert
  const newAlert: PriceAlert = {
    id: generateId(),
    tokenPair,
    targetPrice,
    condition,
    createdAt: Date.now(),
    triggered: false,
  };

  const updated = [...alerts, newAlert];
  const saved = saveAlerts(updated);

  if (!saved) {
    return { success: false, error: "Failed to save alert" };
  }

  return { success: true, alert: newAlert };
}

/**
 * Get all alerts
 */
export function getAlerts(): PriceAlert[] {
  return loadAlerts();
}

/**
 * Get active (non-triggered) alerts
 */
export function getActiveAlerts(): PriceAlert[] {
  return loadAlerts().filter((a) => !a.triggered);
}

/**
 * Get triggered alerts
 */
export function getTriggeredAlerts(): PriceAlert[] {
  return loadAlerts().filter((a) => a.triggered);
}

/**
 * Delete an alert by ID
 */
export function deleteAlert(id: string): boolean {
  const alerts = loadAlerts();
  const filtered = alerts.filter((a) => a.id !== id);
  return saveAlerts(filtered);
}

/**
 * Delete all alerts
 */
export function deleteAllAlerts(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Failed to delete all alerts:", error);
    return false;
  }
}

/**
 * Check alerts against current prices and trigger if conditions are met
 * Returns list of newly triggered alert IDs
 */
export function checkAlerts(
  priceAtoB: number,
  priceBtoA: number
): string[] {
  const alerts = loadAlerts();
  const triggered: string[] = [];

  const updated = alerts.map((alert) => {
    // Skip already triggered alerts
    if (alert.triggered) return alert;

    // Get current price for this pair
    const currentPrice =
      alert.tokenPair === "TKNA/TKNB" ? priceAtoB : priceBtoA;

    // Check if condition is met
    const conditionMet =
      alert.condition === "above"
        ? currentPrice >= alert.targetPrice
        : currentPrice <= alert.targetPrice;

    if (conditionMet) {
      triggered.push(alert.id);
      return {
        ...alert,
        triggered: true,
        triggeredAt: Date.now(),
      };
    }

    return alert;
  });

  if (triggered.length > 0) {
    saveAlerts(updated);
  }

  return triggered;
}

/**
 * Calculate current price from reserves
 * Returns price as a number (e.g., 1.5 means 1 TKNA = 1.5 TKNB)
 */
export function calculatePrice(
  reserveA: bigint,
  reserveB: bigint,
  direction: "TKNA/TKNB" | "TKNB/TKNA"
): number {
  if (reserveA === 0n || reserveB === 0n) return 0;

  // Convert to numbers for price calculation (precision is sufficient for display)
  const rA = Number(reserveA);
  const rB = Number(reserveB);

  // Price = reserve_out / reserve_in
  return direction === "TKNA/TKNB" ? rB / rA : rA / rB;
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  if (price === 0) return "0.0000";
  if (price < 0.0001) return price.toExponential(4);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2);
}

/**
 * Get alert summary statistics
 */
export function getAlertStats(): {
  total: number;
  active: number;
  triggered: number;
} {
  const alerts = loadAlerts();
  return {
    total: alerts.length,
    active: alerts.filter((a) => !a.triggered).length,
    triggered: alerts.filter((a) => a.triggered).length,
  };
}
