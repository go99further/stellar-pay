"use client";

import { useState } from "react";

interface SendPaymentProps {
  balance: string | null;
  onSend: (destination: string, amount: string) => Promise<void>;
  disabled: boolean;
}

export default function SendPayment({
  balance,
  onSend,
  disabled,
}: SendPaymentProps) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination || !amount || sending) return;

    setSending(true);
    try {
      await onSend(destination.trim(), amount.trim());
      // Clear form on success
      setDestination("");
      setAmount("");
    } finally {
      setSending(false);
    }
  };

  const handleMax = () => {
    if (balance) {
      // Reserve 1 XLM for fees and minimum balance
      const max = Math.max(0, parseFloat(balance) - 1);
      setAmount(max.toFixed(7));
    }
  };

  const isValidAddress =
    destination.length === 0 ||
    (destination.startsWith("G") && destination.length === 56);
  const isValidAmount =
    amount.length === 0 || (parseFloat(amount) > 0 && !isNaN(parseFloat(amount)));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Send XLM</h3>

      {/* Destination */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">
          Destination Address
        </label>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
          className={`w-full px-4 py-3 rounded-xl bg-white/5 border ${
            !isValidAddress
              ? "border-red-400/50 focus:border-red-400"
              : "border-white/10 focus:border-blue-400/50"
          } text-white placeholder-slate-600 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/30 transition-all duration-200`}
          disabled={disabled || sending}
        />
        {!isValidAddress && (
          <p className="mt-1 text-xs text-red-400">
            Address must start with G and be 56 characters long
          </p>
        )}
      </div>

      {/* Amount */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">
          Amount (XLM)
        </label>
        <div className="relative">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={`w-full px-4 py-3 pr-16 rounded-xl bg-white/5 border ${
              !isValidAmount
                ? "border-red-400/50 focus:border-red-400"
                : "border-white/10 focus:border-blue-400/50"
            } text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400/30 transition-all duration-200`}
            disabled={disabled || sending}
          />
          <button
            type="button"
            onClick={handleMax}
            disabled={disabled || sending || !balance}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg text-xs font-semibold text-blue-400 bg-blue-400/10 hover:bg-blue-400/20 transition-colors duration-200 disabled:opacity-50 cursor-pointer"
          >
            MAX
          </button>
        </div>
        {!isValidAmount && (
          <p className="mt-1 text-xs text-red-400">
            Please enter a valid amount greater than 0
          </p>
        )}
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={
          disabled ||
          sending ||
          !destination ||
          !amount ||
          !isValidAddress ||
          !isValidAmount
        }
        className="w-full py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-400 hover:to-violet-400 shadow-lg shadow-blue-500/20 hover:shadow-blue-400/30 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer"
      >
        {sending ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin h-5 w-5"
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
            Signing with Freighter...
          </span>
        ) : (
          "Send Transaction"
        )}
      </button>
    </form>
  );
}
