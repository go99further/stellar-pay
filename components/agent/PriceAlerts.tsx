"use client";

import { useState } from "react";
import { usePriceAlerts } from "@/hooks/usePriceAlerts";
import { formatPrice } from "@/lib/agent/price-alerts";

interface PriceAlertsProps {
  walletAddress: string | null;
  enabled?: boolean;
}

export function PriceAlerts({ walletAddress, enabled = true }: PriceAlertsProps) {
  const {
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
  } = usePriceAlerts(walletAddress, enabled);

  const [showForm, setShowForm] = useState(false);
  const [tokenPair, setTokenPair] = useState<"TKNA/TKNB" | "TKNB/TKNA">("TKNA/TKNB");
  const [targetPrice, setTargetPrice] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      setFormError("Please enter a valid positive price");
      return;
    }

    setIsSubmitting(true);
    const result = await createNewAlert(tokenPair, price, condition);
    setIsSubmitting(false);

    if (result.success) {
      setTargetPrice("");
      setShowForm(false);
    } else {
      setFormError(result.error || "Failed to create alert");
    }
  };

  if (!walletAddress) {
    return (
      <div className="rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        Connect your wallet to use price alerts
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with current price */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Price Alerts</h2>
          {priceData && (
            <div className="mt-1 space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
              <div>
                TKNA/TKNB: <span className="font-mono">{formatPrice(priceData.priceAtoB)}</span>
              </div>
              <div>
                TKNB/TKNA: <span className="font-mono">{formatPrice(priceData.priceBtoA)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refreshPrice()}
            disabled={isLoading}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title="Refresh price"
          >
            {isLoading ? "..." : "Refresh"}
          </button>
          {activeAlerts.length > 0 && (
            <button
              onClick={clearAllAlerts}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
              title="Clear all alerts"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Newly triggered alerts notification */}
      {newlyTriggered.length > 0 && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-950">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                {newlyTriggered.length} Alert{newlyTriggered.length > 1 ? "s" : ""} Triggered!
              </div>
              <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                Check the triggered alerts section below
              </div>
            </div>
            <button
              onClick={clearNewlyTriggered}
              className="text-xs text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create alert form */}
      {showForm ? (
        <form onSubmit={handleSubmit} className="space-y-3 rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Create New Alert</h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError(null);
              }}
              className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Cancel
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Token Pair
            </label>
            <select
              value={tokenPair}
              onChange={(e) => setTokenPair(e.target.value as "TKNA/TKNB" | "TKNB/TKNA")}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="TKNA/TKNB">TKNA/TKNB</option>
              <option value="TKNB/TKNA">TKNB/TKNA</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Condition
            </label>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as "above" | "below")}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="above">Price goes above</option>
              <option value="below">Price goes below</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Target Price
            </label>
            <input
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="0.0000"
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800"
              required
            />
          </div>

          {formError && (
            <div className="text-xs text-red-600 dark:text-red-400">{formError}</div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !targetPrice}
            className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Create Alert"}
          </button>

          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Max {10 - activeAlerts.length} more alert{10 - activeAlerts.length !== 1 ? "s" : ""} can be created
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          disabled={activeAlerts.length >= 10}
          className="w-full rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 transition-colors hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-50 disabled:hover:border-neutral-300 disabled:hover:text-neutral-600 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
        >
          {activeAlerts.length >= 10 ? "Maximum alerts reached" : "+ Create Price Alert"}
        </button>
      )}

      {/* Active alerts */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Active Alerts ({activeAlerts.length})
          </h3>
          <div className="space-y-2">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between rounded border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {alert.tokenPair} {alert.condition === "above" ? "≥" : "≤"}{" "}
                    <span className="font-mono">{formatPrice(alert.targetPrice)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    Created {new Date(alert.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => removeAlert(alert.id)}
                  className="ml-2 text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Triggered alerts */}
      {triggeredAlerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Triggered Alerts ({triggeredAlerts.length})
          </h3>
          <div className="space-y-2">
            {triggeredAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center justify-between rounded border p-3 ${
                  newlyTriggered.includes(alert.id)
                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950"
                    : "border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                }`}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {newlyTriggered.includes(alert.id) && (
                      <span className="mr-1 text-emerald-600 dark:text-emerald-400">✓</span>
                    )}
                    {alert.tokenPair} {alert.condition === "above" ? "≥" : "≤"}{" "}
                    <span className="font-mono">{formatPrice(alert.targetPrice)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                    Triggered {alert.triggeredAt ? new Date(alert.triggeredAt).toLocaleString() : "recently"}
                  </div>
                </div>
                <button
                  onClick={() => removeAlert(alert.id)}
                  className="ml-2 text-xs text-neutral-600 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {activeAlerts.length === 0 && triggeredAlerts.length === 0 && !showForm && (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-6 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            No price alerts yet. Create one to get notified when prices change.
          </div>
        </div>
      )}
    </div>
  );
}
