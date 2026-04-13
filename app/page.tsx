"use client";

import { useState, useCallback } from "react";
import { WalletProvider, useWallet } from "@/context/WalletContext";
import WalletConnect from "@/components/WalletConnect";
import BalanceDisplay from "@/components/BalanceDisplay";
import SendPayment from "@/components/SendPayment";
import TransactionResult, {
  TransactionResultData,
} from "@/components/TransactionResult";
import PollCard from "@/components/poll/PollCard";
import { sendPayment, fundWithFriendbot } from "@/lib/stellar";
import { classifyError } from "@/lib/errors";

function AppContent() {
  const { address, balance, balanceLoading, refreshBalance } = useWallet();
  const [activeTab, setActiveTab] = useState<"pay" | "vote">("pay");
  const [txResult, setTxResult] = useState<TransactionResultData | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);

  // Send payment (uses the original stellar.ts which still works with Freighter)
  const handleSend = useCallback(async (destination: string, amount: string) => {
    if (!address) return;
    setTxResult(null);
    setAppError(null);
    try {
      const hash = await sendPayment(address, destination, amount);
      setTxResult({ success: true, hash });
      await refreshBalance();
    } catch (err: unknown) {
      const classified = classifyError(err);
      setTxResult({ success: false, error: classified.message });
    }
  }, [address, refreshBalance]);

  // Fund with Friendbot
  const handleFund = useCallback(async () => {
    if (!address) return;
    setFundingLoading(true);
    setAppError(null);
    try {
      const success = await fundWithFriendbot(address);
      if (success) {
        await refreshBalance();
      } else {
        setAppError("Failed to fund account. It may already be funded.");
      }
    } catch (err: unknown) {
      setAppError(err instanceof Error ? err.message : "Failed to fund account");
    } finally {
      setFundingLoading(false);
    }
  }, [address, refreshBalance]);

  return (
    <main className="relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 overflow-hidden">
      {/* Star field background */}
      <div className="stars-container absolute inset-0 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-4 py-12">
        {/* Header */}
        <header className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
            Stellar Pay + Vote
          </h1>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-xs font-medium text-yellow-400">
              Testnet
            </span>
          </div>
          <p className="mt-3 text-slate-400 text-sm max-w-md">
            Multi-wallet dApp with XLM payments and on-chain voting via Soroban smart contract.
          </p>
        </header>

        {/* Main Content */}
        <div className="w-full max-w-md space-y-6">
          {/* Wallet Card */}
          <section className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl animate-fade-in">
            <WalletConnect />

            {address && (
              <BalanceDisplay
                balance={balance}
                loading={balanceLoading}
                onRefresh={() => refreshBalance()}
              />
            )}

            {/* Friendbot fund button */}
            {address && balance === "0" && (
              <button
                onClick={handleFund}
                disabled={fundingLoading}
                className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 hover:bg-yellow-400/20 transition-all duration-200 disabled:opacity-50 cursor-pointer"
              >
                {fundingLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Requesting testnet XLM...
                  </span>
                ) : (
                  "Fund with Friendbot (10,000 XLM)"
                )}
              </button>
            )}
          </section>

          {/* Tab Switcher */}
          {address && balance && parseFloat(balance) > 0 && (
            <>
              <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                <button
                  onClick={() => setActiveTab("pay")}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                    activeTab === "pay"
                      ? "bg-gradient-to-r from-blue-500/20 to-violet-500/20 text-white border border-white/10"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Send XLM
                </button>
                <button
                  onClick={() => setActiveTab("vote")}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                    activeTab === "vote"
                      ? "bg-gradient-to-r from-blue-500/20 to-violet-500/20 text-white border border-white/10"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  On-Chain Vote
                </button>
              </div>

              {/* Pay Tab */}
              {activeTab === "pay" && (
                <section className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl animate-fade-in-up">
                  <SendPayment
                    balance={balance}
                    onSend={handleSend}
                    disabled={!address}
                  />
                </section>
              )}

              {/* Vote Tab */}
              {activeTab === "vote" && (
                <div className="animate-fade-in-up">
                  <PollCard />
                </div>
              )}
            </>
          )}

          {/* Transaction Result (Pay tab) */}
          {txResult && activeTab === "pay" && (
            <section className="animate-fade-in-up">
              <TransactionResult
                result={txResult}
                onDismiss={() => setTxResult(null)}
              />
            </section>
          )}

          {/* Error message */}
          {appError && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-300">{appError}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center">
          <p className="text-xs text-slate-500">
            Built for Stellar Yellow Belt Challenge &middot; Powered by{" "}
            <a
              href="https://stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400/60 hover:text-blue-400 transition-colors"
            >
              Stellar Network
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  );
}
