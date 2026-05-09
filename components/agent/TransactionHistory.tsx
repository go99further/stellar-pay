"use client";

import { useEffect, useState } from "react";
import {
  getRecentTransactions,
  getStellarExpertLink,
  clearHistory,
  type TransactionRecord,
} from "@/lib/agent/transaction-history";

interface TransactionHistoryProps {
  limit?: number;
  onClear?: () => void;
}

export function TransactionHistory({ limit = 10, onClear }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const loadTransactions = () => {
    setTransactions(getRecentTransactions(limit));
  };

  useEffect(() => {
    loadTransactions();
  }, [limit]);

  const handleClear = () => {
    clearHistory();
    setTransactions([]);
    onClear?.();
  };

  if (transactions.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <span>Transaction History ({transactions.length})</span>
        <span className="text-xs">{isExpanded ? "▼" : "▶"}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          <div className="max-h-64 overflow-y-auto">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="border-b border-neutral-100 px-4 py-2 text-xs last:border-b-0 dark:border-neutral-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 font-medium ${
                          tx.status === "success"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                            : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}
                      >
                        {tx.type.replace("_", " ")}
                      </span>
                      <span className="text-neutral-500">
                        {new Date(tx.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 text-neutral-600 dark:text-neutral-400">
                      {formatTransactionDetails(tx)}
                    </div>
                  </div>
                  <a
                    href={getStellarExpertLink(tx.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
            <button
              onClick={handleClear}
              className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            >
              Clear History
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTransactionDetails(tx: TransactionRecord): string {
  const details = tx.details;

  switch (tx.type) {
    case "swap": {
      const amountIn = details.amountIn ? String(details.amountIn) : "?";
      const tokenIn = details.tokenIn ? String(details.tokenIn).slice(0, 8) : "?";
      const amountOut = details.amountOut ? String(details.amountOut) : "?";
      const tokenOut = details.tokenOut ? String(details.tokenOut).slice(0, 8) : "?";
      return `Swapped ${amountIn} ${tokenIn}... for ${amountOut} ${tokenOut}...`;
    }
    case "add_liquidity": {
      const amountA = details.amountA ? String(details.amountA) : "?";
      const amountB = details.amountB ? String(details.amountB) : "?";
      const lpTokens = details.lpTokens ? String(details.lpTokens) : "?";
      return `Added ${amountA} + ${amountB}, received ${lpTokens} LP tokens`;
    }
    case "remove_liquidity": {
      const lpTokens = details.lpTokens ? String(details.lpTokens) : "?";
      const amountA = details.amountA ? String(details.amountA) : "?";
      const amountB = details.amountB ? String(details.amountB) : "?";
      return `Removed ${lpTokens} LP tokens, received ${amountA} + ${amountB}`;
    }
    default:
      return "Transaction completed";
  }
}
