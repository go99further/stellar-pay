"use client";

interface BalanceDisplayProps {
  balance: string | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function BalanceDisplay({
  balance,
  loading,
  onRefresh,
}: BalanceDisplayProps) {
  if (balance === null) return null;

  // Format balance to show max 4 decimal places
  const formatBalance = (bal: string) => {
    const num = parseFloat(bal);
    if (isNaN(num)) return "0.0000";
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  };

  return (
    <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 uppercase tracking-wider">
          XLM Balance
        </p>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200 disabled:opacity-50 cursor-pointer"
          title="Refresh balance"
        >
          <svg
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {loading ? (
          <div className="h-9 w-40 bg-white/10 rounded-lg animate-pulse" />
        ) : (
          <>
            <span className="text-3xl font-bold text-white">
              {formatBalance(balance)}
            </span>
            <span className="text-lg text-slate-400 font-medium">XLM</span>
          </>
        )}
      </div>
    </div>
  );
}
