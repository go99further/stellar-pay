"use client";

import { useState, useEffect, useCallback } from "react";

interface MetricsSummary {
  swapCount: number;
  volumeA: string;
  volumeB: string;
  tvlA: string;
  tvlB: string;
  recentSwaps: {
    user: string;
    direction: string;
    amountIn: string;
    amountOut: string;
    ledger: number;
  }[];
  cachedAt: string;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function MetricsDashboard() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics");
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-200 dark:bg-gray-700 rounded-2xl h-24" />
          ))}
        </div>
        <div className="bg-gray-200 dark:bg-gray-700 rounded-2xl h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Swaps" value={String(data.swapCount)} sub="all time" />
        <StatCard label="Volume TKNA" value={data.volumeA} sub="tokens swapped in" />
        <StatCard label="Volume TKNB" value={data.volumeB} sub="tokens swapped in" />
        <StatCard
          label="TVL"
          value={`${data.tvlA} / ${data.tvlB}`}
          sub="TKNA / TKNB in pool"
        />
      </div>

      {/* Recent swaps */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Swaps</h2>
          <span className="text-xs text-gray-400">
            Updated {new Date(data.cachedAt).toLocaleTimeString()}
          </span>
        </div>

        {data.recentSwaps.length === 0 ? (
          <p className="text-sm text-gray-400">No swaps yet. Be the first to swap!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left pb-2">User</th>
                  <th className="text-left pb-2">Direction</th>
                  <th className="text-right pb-2">Amount In</th>
                  <th className="text-right pb-2">Amount Out</th>
                  <th className="text-right pb-2">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {data.recentSwaps.map((swap, i) => (
                  <tr key={i} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 font-mono">{swap.user}</td>
                    <td className="py-2">{swap.direction}</td>
                    <td className="py-2 text-right">{swap.amountIn}</td>
                    <td className="py-2 text-right">{swap.amountOut}</td>
                    <td className="py-2 text-right text-gray-400">{swap.ledger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
