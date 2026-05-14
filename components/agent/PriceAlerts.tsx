"use client";

import { useState } from "react";
import { usePriceAlerts } from "@/hooks/usePriceAlerts";
import { formatPrice, type PriceAlert } from "@/lib/agent/price-alerts";
import { backtestAlertsV2, generateBacktestReportV2, type BacktestResultV2 } from "@/lib/agent/alert-backtest-v2";
import {
  getOnlineStats,
  suggestThreshold,
  type ThresholdSuggestion,
} from "@/lib/agent/alert-feedback";

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
  const [backtestResult, setBacktestResult] = useState<BacktestResultV2 | null>(null);
  const [showBacktest, setShowBacktest] = useState(false);

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

  const handleBacktest = () => {
    const allAlerts = [...activeAlerts, ...triggeredAlerts];
    if (allAlerts.length === 0) {
      setFormError("No alerts to backtest. Create at least one alert first.");
      return;
    }

    const result = backtestAlertsV2(allAlerts);
    setBacktestResult(result);
    setShowBacktest(true);
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
          <button
            onClick={handleBacktest}
            disabled={activeAlerts.length === 0 && triggeredAlerts.length === 0}
            className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950"
            title="Backtest alerts with historical data"
          >
            📊 Backtest
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

      {/* Backtest Results V2 */}
      {showBacktest && backtestResult && (
        <div className="rounded border border-indigo-400 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-950">
          <div className="flex items-start justify-between">
            <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">
              📊 Backtest Results V2 (防过拟合版本)
            </h3>
            <button
              onClick={() => setShowBacktest(false)}
              className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200"
            >
              Close
            </button>
          </div>

          <div className="mt-3 space-y-3 text-xs">
            {/* Data Windows */}
            <div className="rounded border border-indigo-300 bg-white p-3 dark:border-indigo-800 dark:bg-indigo-900">
              <div className="font-medium text-indigo-900 dark:text-indigo-200">Data Windows</div>
              <div className="mt-2 space-y-1 text-indigo-700 dark:text-indigo-300">
                <div className="flex justify-between">
                  <span>Training Set:</span>
                  <span className="font-mono">{backtestResult.windows.train.points.length} points</span>
                </div>
                <div className="flex justify-between">
                  <span>Validation Set:</span>
                  <span className="font-mono">{backtestResult.windows.validation.points.length} points (used)</span>
                </div>
                <div className="flex justify-between">
                  <span>Test Set:</span>
                  <span className="font-mono">{backtestResult.windows.test.points.length} points (reserved)</span>
                </div>
              </div>
            </div>

            {/* Alert Statistics */}
            <div className="rounded border border-indigo-300 bg-white p-3 dark:border-indigo-800 dark:bg-indigo-900">
              <div className="font-medium text-indigo-900 dark:text-indigo-200">Alert Statistics</div>
              <div className="mt-2 space-y-1 text-indigo-700 dark:text-indigo-300">
                <div className="flex justify-between">
                  <span>Total Alerts:</span>
                  <span className="font-mono">{backtestResult.totalAlerts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Triggered:</span>
                  <span className="font-mono">{backtestResult.triggeredAlerts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Accurate:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {backtestResult.accurateAlerts} (
                    {backtestResult.triggeredAlerts > 0
                      ? ((backtestResult.accurateAlerts / backtestResult.triggeredAlerts) * 100).toFixed(1)
                      : "0"}
                    %)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>False Alerts:</span>
                  <span className="font-mono text-red-600 dark:text-red-400">
                    {backtestResult.falseAlerts}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg Delay:</span>
                  <span className="font-mono">{(backtestResult.avgDelayMs / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>

            {/* Stability Analysis */}
            <div className={`rounded border p-3 ${
              backtestResult.stability.thresholdSensitivity < 0.3
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
                : backtestResult.stability.thresholdSensitivity < 0.6
                ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
                : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
            }`}>
              <div className={`font-medium ${
                backtestResult.stability.thresholdSensitivity < 0.3
                  ? "text-emerald-900 dark:text-emerald-200"
                  : backtestResult.stability.thresholdSensitivity < 0.6
                  ? "text-amber-900 dark:text-amber-200"
                  : "text-red-900 dark:text-red-200"
              }`}>
                Stability Analysis
              </div>
              <div className={`mt-2 space-y-1 ${
                backtestResult.stability.thresholdSensitivity < 0.3
                  ? "text-emerald-700 dark:text-emerald-300"
                  : backtestResult.stability.thresholdSensitivity < 0.6
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-red-700 dark:text-red-300"
              }`}>
                <div className="flex justify-between">
                  <span>Threshold Sensitivity:</span>
                  <span className="font-mono">{(backtestResult.stability.thresholdSensitivity * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Performance Variance:</span>
                  <span className="font-mono">{(backtestResult.stability.performanceVariance * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-2 text-xs">
                  {backtestResult.stability.recommendation}
                </div>
              </div>
            </div>

            {/* Stress Test */}
            <div className="rounded border border-indigo-300 bg-white p-3 dark:border-indigo-800 dark:bg-indigo-900">
              <div className="font-medium text-indigo-900 dark:text-indigo-200">Stress Test</div>
              <div className="mt-2 space-y-1 text-indigo-700 dark:text-indigo-300">
                <div className="flex justify-between">
                  <span>Normal Market Accuracy:</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {backtestResult.stressTest.normalAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Volatile Market Accuracy:</span>
                  <span className={`font-mono ${
                    backtestResult.stressTest.volatileAccuracy >= backtestResult.stressTest.normalAccuracy * 0.8
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}>
                    {backtestResult.stressTest.volatileAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Performance Degradation:</span>
                  <span className={`font-mono ${
                    backtestResult.stressTest.degradation < 10
                      ? "text-emerald-600 dark:text-emerald-400"
                      : backtestResult.stressTest.degradation < 20
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400"
                  }`}>
                    {backtestResult.stressTest.degradation.toFixed(1)}%
                  </span>
                </div>
              </div>
              {backtestResult.stressTest.degradation > 20 && (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  ⚠️ High performance drop in volatile markets
                </div>
              )}
            </div>

            {/* Profit Simulation */}
            <div className="rounded border border-indigo-300 bg-white p-3 dark:border-indigo-800 dark:bg-indigo-900">
              <div className="flex items-center justify-between">
                <div className="font-medium text-indigo-900 dark:text-indigo-200">Profit Simulation</div>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                  backtestResult.profitSimulation.confidence === "high"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                    : backtestResult.profitSimulation.confidence === "medium"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                }`}>
                  {backtestResult.profitSimulation.confidence.toUpperCase()} confidence
                </span>
              </div>
              <div className="mt-2 space-y-1 text-indigo-700 dark:text-indigo-300">
                <div className="flex justify-between">
                  <span>Without Alerts (Buy & Hold):</span>
                  <span className={`font-mono ${backtestResult.profitSimulation.withoutAlert >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {backtestResult.profitSimulation.withoutAlert > 0 ? "+" : ""}
                    {backtestResult.profitSimulation.withoutAlert}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>With Alerts (Signal Trading):</span>
                  <span className={`font-mono ${backtestResult.profitSimulation.withAlert >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {backtestResult.profitSimulation.withAlert > 0 ? "+" : ""}
                    {backtestResult.profitSimulation.withAlert}%
                  </span>
                </div>
                <div className="flex justify-between border-t border-indigo-200 pt-1 font-medium dark:border-indigo-700">
                  <span>Improvement:</span>
                  <span className={`font-mono ${backtestResult.profitSimulation.improvement >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {backtestResult.profitSimulation.improvement > 0 ? "+" : ""}
                    {backtestResult.profitSimulation.improvement}%
                  </span>
                </div>
              </div>
            </div>

            {/* Forward-Looking Bias Check */}
            <div className={`rounded border p-2 ${
              backtestResult.biasCheck.hasFutureLeak
                ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950"
                : "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950"
            }`}>
              <div className={`text-xs ${
                backtestResult.biasCheck.hasFutureLeak
                  ? "text-red-800 dark:text-red-300"
                  : "text-emerald-800 dark:text-emerald-300"
              }`}>
                {backtestResult.biasCheck.message}
              </div>
            </div>

            {/* Warnings */}
            {backtestResult.triggeredAlerts === 0 && (
              <div className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                ⚠️ No alerts triggered in validation set. Consider adjusting alert thresholds.
              </div>
            )}
            {backtestResult.accurateAlerts === 0 && backtestResult.triggeredAlerts > 0 && (
              <div className="rounded border border-red-400 bg-red-50 p-2 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
                ⚠️ All triggered alerts were false positives. Consider revising alert conditions.
              </div>
            )}
            {backtestResult.profitSimulation.confidence === "low" && (
              <div className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                ⚠️ Insufficient data for reliable backtest. Results have low confidence.
              </div>
            )}

            {/* Text Report */}
            <details className="rounded border border-indigo-300 bg-white p-2 dark:border-indigo-800 dark:bg-indigo-900">
              <summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">
                View Full Report
              </summary>
              <pre className="mt-2 whitespace-pre-wrap text-xs text-indigo-600 dark:text-indigo-400">
                {generateBacktestReportV2(backtestResult)}
              </pre>
            </details>
          </div>
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
              <ActiveAlertRow
                key={alert.id}
                alert={alert}
                onDelete={() => removeAlert(alert.id)}
                onApplySuggestion={async (suggested) => {
                  const res = await createNewAlert(
                    alert.tokenPair,
                    suggested,
                    alert.condition
                  );
                  if (res.success) removeAlert(alert.id);
                }}
              />
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

// ── Active alert row with feedback loop UI ───────────────────────────────────

interface ActiveAlertRowProps {
  alert: PriceAlert;
  onDelete: () => void;
  onApplySuggestion: (suggestedTarget: number) => void | Promise<void>;
}

function ActiveAlertRow({ alert, onDelete, onApplySuggestion }: ActiveAlertRowProps) {
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestion, setSuggestion] = useState<ThresholdSuggestion | null>(null);
  const stats = getOnlineStats(alert.id);

  const handleAnalyze = () => {
    setSuggestion(suggestThreshold(alert));
    setShowSuggestion(true);
  };

  const accuracyLabel =
    stats.hitRate === null
      ? "no settled samples yet"
      : `${(stats.hitRate * 100).toFixed(0)}% hit rate (${stats.hits}/${stats.settled})`;

  return (
    <div className="rounded border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-sm font-medium">
            {alert.tokenPair} {alert.condition === "above" ? "≥" : "≤"}{" "}
            <span className="font-mono">{formatPrice(alert.targetPrice)}</span>
          </div>
          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Created {new Date(alert.createdAt).toLocaleString()}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
            <span>
              Live accuracy:{" "}
              <span className="font-mono text-indigo-700 dark:text-indigo-300">
                {accuracyLabel}
              </span>
            </span>
            <span>
              Pending: <span className="font-mono">{stats.pending}</span>
            </span>
            <span>
              Confidence:{" "}
              <span className="font-mono uppercase">{stats.confidence}</span>
            </span>
          </div>
        </div>
        <div className="ml-2 flex flex-col items-end gap-1">
          <button
            onClick={handleAnalyze}
            className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200"
            title="Analyze threshold from feedback loop"
          >
            🔬 Analyze
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
          >
            Delete
          </button>
        </div>
      </div>

      {showSuggestion && suggestion && (
        <SuggestionCard
          suggestion={suggestion}
          onClose={() => setShowSuggestion(false)}
          onApply={onApplySuggestion}
        />
      )}
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: ThresholdSuggestion;
  onClose: () => void;
  onApply: (suggestedTarget: number) => void | Promise<void>;
}

function SuggestionCard({ suggestion, onClose, onApply }: SuggestionCardProps) {
  const tone =
    suggestion.action === "keep"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
      : suggestion.action === "insufficient_data"
      ? "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"
      : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950";

  const canApply =
    suggestion.suggestedTarget !== null &&
    suggestion.action !== "keep" &&
    suggestion.action !== "insufficient_data";

  return (
    <div className={`mt-3 rounded border p-3 text-xs ${tone}`}>
      <div className="flex items-start justify-between">
        <div className="font-medium uppercase tracking-wide text-neutral-700 dark:text-neutral-200">
          Suggestion: {suggestion.action.replace("_", " ")}
        </div>
        <button
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Close
        </button>
      </div>
      <div className="mt-2 space-y-1 text-neutral-700 dark:text-neutral-300">
        <div>
          Current target:{" "}
          <span className="font-mono">{formatPrice(suggestion.currentTarget)}</span>
        </div>
        {suggestion.suggestedTarget !== null && (
          <div>
            Suggested target:{" "}
            <span className="font-mono text-indigo-700 dark:text-indigo-300">
              {formatPrice(suggestion.suggestedTarget)}
            </span>
          </div>
        )}
        <div className="leading-relaxed">{suggestion.reason}</div>
        <div className="mt-1 text-neutral-500 dark:text-neutral-400">
          Online: {suggestion.online.hits} hits / {suggestion.online.misses} misses /{" "}
          {suggestion.online.pending} pending · Backtest stability:{" "}
          {suggestion.backtest
            ? `${(suggestion.backtest.stability.thresholdSensitivity * 100).toFixed(0)}% sensitivity`
            : "n/a"}
        </div>
      </div>
      {canApply && (
        <button
          onClick={() => {
            if (suggestion.suggestedTarget !== null) {
              void onApply(suggestion.suggestedTarget);
            }
            onClose();
          }}
          className="mt-3 rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Apply (replaces current alert)
        </button>
      )}
    </div>
  );
}
