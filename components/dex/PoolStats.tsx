"use client";

import { useAmmContract } from "@/hooks/useAmmContract";

const DECIMALS = 7;
const TOKEN_A_SYMBOL = "TKNA";
const TOKEN_B_SYMBOL = "TKNB";

function toDisplay(raw: bigint): string {
  if (raw === 0n) return "0";
  const n = Number(raw) / 10 ** DECIMALS;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function PoolStats() {
  const { ammState } = useAmmContract();

  const { reserveA, reserveB, lpBalance, lpSupply, isLoading } = ammState;

  const price =
    reserveA > 0n && reserveB > 0n
      ? (Number(reserveB) / Number(reserveA)).toFixed(4)
      : "—";

  const userShare =
    lpSupply > 0n && lpBalance > 0n
      ? ((Number(lpBalance) / Number(lpSupply)) * 100).toFixed(2) + "%"
      : "0%";

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Pool Stats</h2>
      <div className="space-y-3">
        <StatRow label={`${TOKEN_A_SYMBOL} Reserve`} value={toDisplay(reserveA)} />
        <StatRow label={`${TOKEN_B_SYMBOL} Reserve`} value={toDisplay(reserveB)} />
        <StatRow label={`Price (${TOKEN_A_SYMBOL} → ${TOKEN_B_SYMBOL})`} value={price} />
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <StatRow label="Your LP Balance" value={toDisplay(lpBalance)} />
          <StatRow label="Your Pool Share" value={userShare} />
          <StatRow label="Total LP Supply" value={toDisplay(lpSupply)} />
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}
