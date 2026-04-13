"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { connectWithKit, signWithKit, disconnectKit } from "@/lib/wallet-kit";
import { fetchBalance } from "@/lib/stellar";
import { classifyError } from "@/lib/errors";

interface WalletState {
  address: string | null;
  balance: string | null;
  balanceLoading: boolean;
  connectLoading: boolean;
  error: Error | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: (addr?: string) => Promise<void>;
  clearError: () => void;
  signTransaction: (xdr: string, opts?: { networkPassphrase?: string }) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [connectLoading, setConnectLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refreshBalance = useCallback(async (addr?: string) => {
    const target = addr || address;
    if (!target) return;
    setBalanceLoading(true);
    try {
      const bal = await fetchBalance(target);
      setBalance(bal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Not Found") || msg.includes("404")) {
        setBalance("0");
      }
    } finally {
      setBalanceLoading(false);
    }
  }, [address]);

  const connect = useCallback(async () => {
    setConnectLoading(true);
    setError(null);
    try {
      const addr = await connectWithKit();
      setAddress(addr);
      await refreshBalance(addr);
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setConnectLoading(false);
    }
  }, [refreshBalance]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectKit();
    } catch {
      // Ignore disconnect errors
    }
    setAddress(null);
    setBalance(null);
    setError(null);
  }, []);

  const signTransaction = useCallback(async (xdr: string, opts?: { networkPassphrase?: string }) => {
    return await signWithKit(xdr, {
      networkPassphrase: opts?.networkPassphrase,
      address: address || undefined,
    });
  }, [address]);

  const clearError = useCallback(() => setError(null), []);

  // Auto-refresh balance every 30s when connected
  useEffect(() => {
    if (!address) return;
    const interval = setInterval(() => refreshBalance(), 30000);
    return () => clearInterval(interval);
  }, [address, refreshBalance]);

  return (
    <WalletContext.Provider
      value={{
        address,
        balance,
        balanceLoading,
        connectLoading,
        error,
        connect,
        disconnect,
        refreshBalance,
        clearError,
        signTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
