"use client";

import { useState, useCallback } from "react";
import WalletConnect from "@/components/WalletConnect";
import BalanceDisplay from "@/components/BalanceDisplay";
import SendPayment from "@/components/SendPayment";
import TransactionResult, {
  TransactionResultData,
} from "@/components/TransactionResult";
import { connectWallet } from "@/lib/freighter";
import { fetchBalance, sendPayment, fundWithFriendbot } from "@/lib/stellar";

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [txResult, setTxResult] = useState<TransactionResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);

  // Load balance for given address
  const loadBalance = useCallback(async (addr: string) => {
    setBalanceLoading(true);
    try {
      const bal = await fetchBalance(addr);
      setBalance(bal);
      setError(null);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch balance";
      // If account not found, balance is 0
      if (errorMessage.includes("Not Found") || errorMessage.includes("404")) {
        setBalance("0");
      } else {
        setError(errorMessage);
      }
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // Connect wallet
  const handleConnect = async () => {
    setConnectLoading(true);
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
      await loadBalance(addr);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnectLoading(false);
    }
  };

  // Disconnect wallet
  const handleDisconnect = () => {
    setAddress(null);
    setBalance(null);
    setTxResult(null);
    setError(null);
  };

  // Send payment
  const handleSend = async (destination: string, amount: string) => {
    if (!address) return;
    setTxResult(null);
    setError(null);

    try {
      const hash = await sendPayment(address, destination, amount);
      setTxResult({ success: true, hash });
      // Refresh balance after successful transaction
      await loadBalance(address);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Transaction failed";
      setTxResult({ success: false, error: errorMessage });
    }
  };

  // Fund with Friendbot
  const handleFund = async () => {
    if (!address) return;
    setFundingLoading(true);
    setError(null);
    try {
      const success = await fundWithFriendbot(address);
      if (success) {
        await loadBalance(address);
      } else {
        setError("Failed to fund account. It may already be funded.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fund account");
    } finally {
      setFundingLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 overflow-hidden">
      {/* Star field background */}
      <div className="stars-container absolute inset-0 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-4 py-12">
        {/* Header */}
        <header className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
            Stellar Pay
          </h1>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-xs font-medium text-yellow-400">
              Testnet
            </span>
          </div>
          <p className="mt-3 text-slate-400 text-sm max-w-md">
            Connect your Freighter wallet, check your balance, and send XLM
            payments on Stellar Testnet.
          </p>
        </header>

        {/* Main Card */}
        <div className="w-full max-w-md space-y-6">
          {/* Wallet Card */}
          <section className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl animate-fade-in">
            <WalletConnect
              address={address}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              loading={connectLoading}
            />

            {address && (
              <BalanceDisplay
                balance={balance}
                loading={balanceLoading}
                onRefresh={() => loadBalance(address)}
              />
            )}

            {/* Friendbot fund button - show when balance is 0 */}
            {address && balance === "0" && (
              <button
                onClick={handleFund}
                disabled={fundingLoading}
                className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 hover:bg-yellow-400/20 transition-all duration-200 disabled:opacity-50 cursor-pointer"
              >
                {fundingLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Requesting testnet XLM...
                  </span>
                ) : (
                  "Fund with Friendbot (10,000 XLM)"
                )}
              </button>
            )}
          </section>

          {/* Send Payment Card */}
          {address && balance && parseFloat(balance) > 0 && (
            <section className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl animate-fade-in-up">
              <SendPayment
                balance={balance}
                onSend={handleSend}
                disabled={!address}
              />
            </section>
          )}

          {/* Transaction Result */}
          {txResult && (
            <section className="animate-fade-in-up">
              <TransactionResult
                result={txResult}
                onDismiss={() => setTxResult(null)}
              />
            </section>
          )}

          {/* Error message */}
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-fade-in">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-400 mt-0.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-16 text-center">
          <p className="text-xs text-slate-500">
            Built for Stellar White Belt Challenge &middot; Powered by{" "}
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
