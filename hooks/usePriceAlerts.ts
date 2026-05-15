"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getReserves } from "@/lib/amm-contract";
import { getReadOnlyReader } from "@/lib/read-only-reader";
import {
  type PriceAlert,
  loadAlerts,
  createAlert,
  deleteAlert,
  deleteAllAlerts,
  checkAlerts,
  calculatePrice,
  getActiveAlerts,
  getTriggeredAlerts,
} from "@/lib/agent/price-alerts";
import { recordOutcome } from "@/lib/agent/alert-feedback";
import { settleAllPending } from "@/lib/agent/security-feedback";

const POLL_INTERVAL = 30000; // 30 seconds

export interface PriceData {
  priceAtoB: number; // TKNA/TKNB
  priceBtoA: number; // TKNB/TKNA
  reserveA: bigint;
  reserveB: bigint;
  lastUpdate: number;
}

export interface UsePriceAlertsReturn {
  alerts: PriceAlert[];
  activeAlerts: PriceAlert[];
  triggeredAlerts: PriceAlert[];
  priceData: PriceData | null;
  isLoading: boolean;
  error: string | null;
  createNewAlert: (
    tokenPair: "TKNA/TKNB" | "TKNB/TKNA",
    targetPrice: number,
    condition: "above" | "below"
  ) => Promise<{ success: boolean; error?: string }>;
  removeAlert: (id: string) => void;
  clearAllAlerts: () => void;
  refreshPrice: () => Promise<void>;
  newlyTriggered: string[];
  clearNewlyTriggered: () => void;
}

export function usePriceAlerts(
  walletAddress: string | null,
  enabled = true
): UsePriceAlertsReturn {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newlyTriggered, setNewlyTriggered] = useState<string[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load alerts from localStorage
  const loadAlertsFromStorage = useCallback(() => {
    const loaded = loadAlerts();
    setAlerts(loaded);
  }, []);

  // Fetch current price from reserves
  const fetchPrice = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    try {
      const reader = getReadOnlyReader(walletAddress);
      const [reserveA, reserveB] = await getReserves(reader);
      const priceAtoB = calculatePrice(reserveA, reserveB, "TKNA/TKNB");
      const priceBtoA = calculatePrice(reserveA, reserveB, "TKNB/TKNA");
      const observedAt = Date.now();

      setPriceData({
        priceAtoB,
        priceBtoA,
        reserveA,
        reserveB,
        lastUpdate: observedAt,
      });

      // Settle any pending feedback records for both directions before we
      // evaluate new triggers. Each call only settles records whose triggered
      // pair matches the observed price stream (above/below check is direction-
      // agnostic; the price magnitude lives on each record).
      recordOutcome(priceAtoB, observedAt);
      recordOutcome(priceBtoA, observedAt);

      // Settle security feedback records (Issue 1 fix):
      // - liquidity_flow: use current reserves as TVL proxy
      // - sandwich: settled via decoded events (requires event-decoder, done async)
      // - anomaly: settled via decoded events (1h follow-up check)
      // - stale_price / imbalance: settled via reserves change (30min)
      // - expired: 24h safety net
      const reserveANum = Number(reserveA) / 1e7;
      const reserveBNum = Number(reserveB) / 1e7;
      try {
        settleAllPending({
          tvlChange: { currentReserveA: reserveANum, currentReserveB: reserveBNum, observedAt },
          expireNow: observedAt,
        });
      } catch {
        // Non-critical: settlement failure should not block price alerts
      }

      // Check alerts against current prices
      const triggered = checkAlerts(priceAtoB, priceBtoA);
      if (triggered.length > 0) {
        setNewlyTriggered((prev) => [...prev, ...triggered]);
        loadAlertsFromStorage(); // Reload to get updated triggered status

        // Show browser notification if supported
        if ("Notification" in window && Notification.permission === "granted") {
          triggered.forEach((id) => {
            const alert = alerts.find((a) => a.id === id);
            if (alert) {
              new Notification("Price Alert Triggered!", {
                body: `${alert.tokenPair} is now ${alert.condition} ${alert.targetPrice.toFixed(4)}`,
                icon: "/favicon.ico",
              });
            }
          });
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch price");
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, enabled, alerts, loadAlertsFromStorage]);

  // Initial load
  useEffect(() => {
    loadAlertsFromStorage();
  }, [loadAlertsFromStorage]);

  // Set up polling
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    // Fetch immediately
    fetchPrice();

    // Set up interval
    intervalRef.current = setInterval(() => {
      fetchPrice();
    }, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, walletAddress, fetchPrice]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const createNewAlert = useCallback(
    async (
      tokenPair: "TKNA/TKNB" | "TKNB/TKNA",
      targetPrice: number,
      condition: "above" | "below"
    ): Promise<{ success: boolean; error?: string }> => {
      const result = createAlert(tokenPair, targetPrice, condition);
      if (result.success) {
        loadAlertsFromStorage();
        // Immediately check if the new alert should trigger
        if (priceData) {
          await fetchPrice();
        }
      }
      return {
        success: result.success,
        error: result.error,
      };
    },
    [loadAlertsFromStorage, priceData, fetchPrice]
  );

  const removeAlert = useCallback(
    (id: string) => {
      deleteAlert(id);
      loadAlertsFromStorage();
      // Remove from newly triggered list if present
      setNewlyTriggered((prev) => prev.filter((tid) => tid !== id));
    },
    [loadAlertsFromStorage]
  );

  const clearAllAlerts = useCallback(() => {
    deleteAllAlerts();
    loadAlertsFromStorage();
    setNewlyTriggered([]);
  }, [loadAlertsFromStorage]);

  const refreshPrice = useCallback(async () => {
    setIsLoading(true);
    await fetchPrice();
  }, [fetchPrice]);

  const clearNewlyTriggered = useCallback(() => {
    setNewlyTriggered([]);
  }, []);

  const activeAlerts = getActiveAlerts();
  const triggeredAlerts = getTriggeredAlerts();

  return {
    alerts,
    activeAlerts,
    triggeredAlerts,
    priceData,
    isLoading,
    error,
    createNewAlert,
    removeAlert,
    clearAllAlerts,
    refreshPrice,
    newlyTriggered,
    clearNewlyTriggered,
  };
}
