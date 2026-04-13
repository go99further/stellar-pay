"use client";

import { usePollContract, TxStatus } from "@/hooks/usePollContract";
import PollResults from "./PollResults";
import EventFeed from "./EventFeed";

export default function PollCard() {
  const { pollData, txStatus, txHash, txError, vote, resetTx } = usePollContract();

  if (!pollData.contractId) {
    return (
      <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-3">On-Chain Poll</h3>
        <p className="text-sm text-slate-400">
          No contract deployed yet. Deploy the poll contract and set NEXT_PUBLIC_CONTRACT_ID in .env.local.
        </p>
      </div>
    );
  }

  if (pollData.isLoading) {
    return (
      <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-400">Loading poll data from contract...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Poll Question & Voting */}
      <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
        <h3 className="text-lg font-semibold text-white mb-1">On-Chain Poll</h3>
        <p className="text-xs text-slate-500 mb-4 font-mono break-all">
          Contract: {pollData.contractId.slice(0, 8)}...{pollData.contractId.slice(-8)}
        </p>

        {/* Question */}
        <div className="mb-5 p-4 rounded-xl bg-gradient-to-r from-blue-500/10 to-violet-500/10 border border-blue-500/20">
          <p className="text-white font-medium">{pollData.question || "No active poll"}</p>
          <p className="text-xs text-slate-400 mt-1">
            {pollData.totalVotes} vote{pollData.totalVotes !== 1 ? "s" : ""} so far
          </p>
        </div>

        {/* Options */}
        {pollData.options.length > 0 && (
          <div className="space-y-2">
            {pollData.options.map((option, index) => {
              const voteCount = pollData.votes.get(index) || 0;
              const percentage = pollData.totalVotes > 0
                ? Math.round((voteCount / pollData.totalVotes) * 100)
                : 0;

              return (
                <button
                  key={index}
                  onClick={() => vote(index)}
                  disabled={pollData.hasVoted || txStatus !== "idle"}
                  className="w-full group relative overflow-hidden rounded-xl border border-white/10 hover:border-blue-400/30 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {/* Progress bar background */}
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-violet-500/20 transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                  />
                  <div className="relative flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-white font-medium">{option}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{voteCount} votes</span>
                      <span className="text-xs font-mono text-blue-400">{percentage}%</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Voted indicator */}
        {pollData.hasVoted && (
          <div className="mt-3 flex items-center gap-2 text-sm text-emerald-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            You have already voted
          </div>
        )}

        {/* Transaction Status */}
        <TxStatusDisplay status={txStatus} hash={txHash} error={txError} onReset={resetTx} />
      </div>

      {/* Results Chart */}
      <PollResults
        options={pollData.options}
        votes={pollData.votes}
        totalVotes={pollData.totalVotes}
      />

      {/* Event Feed */}
      <EventFeed />
    </div>
  );
}

function TxStatusDisplay({
  status,
  hash,
  error,
  onReset,
}: {
  status: TxStatus;
  hash: string | null;
  error: Error | null;
  onReset: () => void;
}) {
  if (status === "idle") return null;

  const statusConfig: Record<string, { label: string; color: string; animate: boolean }> = {
    building: { label: "Building transaction...", color: "text-blue-400", animate: true },
    signing: { label: "Waiting for wallet signature...", color: "text-yellow-400", animate: true },
    submitting: { label: "Submitting to network...", color: "text-blue-400", animate: true },
    success: { label: "Vote submitted successfully!", color: "text-emerald-400", animate: false },
    error: { label: "Transaction failed", color: "text-red-400", animate: false },
  };

  const config = statusConfig[status];

  return (
    <div className={`mt-4 p-4 rounded-xl border ${
      status === "success" ? "bg-emerald-500/5 border-emerald-500/20" :
      status === "error" ? "bg-red-500/5 border-red-500/20" :
      "bg-blue-500/5 border-blue-500/20"
    }`}>
      <div className="flex items-center gap-3">
        {config.animate && (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {status === "success" && (
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {status === "error" && (
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
      </div>

      {hash && (
        <div className="mt-2">
          <p className="text-xs text-slate-400">Transaction Hash:</p>
          <p className="font-mono text-xs text-slate-300 break-all mt-1">{hash}</p>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300"
          >
            View on Stellar Expert
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-300">{error.message}</p>
      )}

      {(status === "success" || status === "error") && (
        <button
          onClick={onReset}
          className="mt-2 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
