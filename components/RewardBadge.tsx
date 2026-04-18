"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { readTokenBalance, readTokenName, getRewardTokenId } from "@/lib/reward-token";

export default function RewardBadge() {
  const { address } = useWallet();
  const [balance, setBalance] = useState("0");
  const [symbol, setSymbol] = useState("VOTE");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address || !getRewardTokenId()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      const [bal, sym] = await Promise.all([
        readTokenBalance(address!, address!),
        readTokenName(address!),
      ]);
      setBalance(bal);
      setSymbol(sym);
      setLoading(false);
    }

    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [address]);

  if (!address) return null;

  return (
    <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-bold">
            {symbol.slice(0, 2)}
          </div>
          <div>
            <p className="text-xs text-amber-400/70 uppercase tracking-wider">Reward Token</p>
            <p className="text-sm text-white font-medium">{symbol}</p>
          </div>
        </div>
        <div className="text-right">
          {loading ? (
            <div className="h-6 w-12 bg-white/10 rounded animate-pulse" />
          ) : (
            <p className="text-xl font-bold text-amber-400">{balance}</p>
          )}
        </div>
      </div>
      {!getRewardTokenId() && (
        <p className="mt-2 text-xs text-slate-500">
          Reward token not configured. Set NEXT_PUBLIC_REWARD_TOKEN_ID in .env.local
        </p>
      )}
    </div>
  );
}
