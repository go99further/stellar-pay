"use client";

import { useState } from "react";

export interface TransactionResultData {
  success: boolean;
  hash?: string;
  error?: string;
}

interface TransactionResultProps {
  result: TransactionResultData | null;
  onDismiss: () => void;
}

export default function TransactionResult({
  result,
  onDismiss,
}: TransactionResultProps) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  const handleCopy = async () => {
    if (result.hash) {
      await navigator.clipboard.writeText(result.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const explorerUrl = result.hash
    ? `https://stellar.expert/explorer/testnet/tx/${result.hash}`
    : null;

  return (
    <div
      className={`p-5 rounded-2xl border animate-fade-in ${
        result.success
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-red-500/5 border-red-500/20"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {result.success ? (
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center animate-scale-in">
              <svg
                className="w-5 h-5 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
          )}
          <div>
            <h4
              className={`font-semibold ${
                result.success ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {result.success
                ? "Transaction Successful!"
                : "Transaction Failed"}
            </h4>
            {result.error && (
              <p className="text-sm text-red-300 mt-1">{result.error}</p>
            )}
          </div>
        </div>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Transaction Hash */}
      {result.hash && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-slate-400">Transaction Hash:</p>
            <button
              onClick={handleCopy}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="font-mono text-sm text-slate-300 break-all bg-white/5 p-3 rounded-lg">
            {result.hash}
          </p>

          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              View on Stellar Expert
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
