"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getReserves,
  getLpBalance,
  getLpSupply,
  buildSwapTransaction,
  buildAddLiquidityTransaction,
  buildRemoveLiquidityTransaction,
  submitAmmTransaction,
  getTokenAId,
} from "@/lib/amm-contract";
import { getSwapOutput, getLpTokensForDeposit, getWithdrawAmounts, applySlippage } from "@/lib/amm-math";
import { submitGaslessSwap } from "@/lib/fee-bump";
import { useWallet } from "@/context/WalletContext";
import { classifyError } from "@/lib/errors";
import { cache, CACHE_KEYS } from "@/lib/cache";

export type TxStatus = "idle" | "building" | "signing" | "submitting" | "success" | "error";

export interface AmmState {
  reserveA: bigint;
  reserveB: bigint;
  lpBalance: bigint;
  lpSupply: bigint;
  isLoading: boolean;
}

export function useAmmContract() {
  const { address, signTransaction } = useWallet();

  const [ammState, setAmmState] = useState<AmmState>({
    reserveA: 0n,
    reserveB: 0n,
    lpBalance: 0n,
    lpSupply: 0n,
    isLoading: true,
  });

  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<Error | null>(null);

  // Slippage tolerance in basis points (default 50 = 0.5%)
  const [slippageBps, setSlippageBps] = useState<bigint>(50n);
  const [gasless, setGasless] = useState(false);

  const loadAmmState = useCallback(async () => {
    if (!address) {
      setAmmState((prev) => ({ ...prev, isLoading: false }));
      return;
    }
    try {
      const [[reserveA, reserveB], lpBalance, lpSupply] = await Promise.all([
        getReserves(address),
        getLpBalance(address, address),
        getLpSupply(address),
      ]);
      setAmmState({ reserveA, reserveB, lpBalance, lpSupply, isLoading: false });
    } catch {
      setAmmState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [address]);

  useEffect(() => {
    loadAmmState();
  }, [loadAmmState]);

  /** Preview: estimate swap output client-side (no RPC call). */
  const previewSwap = useCallback(
    (tokenIn: string, amountIn: bigint): { amountOut: bigint; minAmountOut: bigint; priceImpact: number } => {
      const { reserveA, reserveB } = ammState;
      const isAtoB = tokenIn === getTokenAId();
      const [rIn, rOut] = isAtoB ? [reserveA, reserveB] : [reserveB, reserveA];
      if (rIn === 0n || rOut === 0n || amountIn <= 0n) {
        return { amountOut: 0n, minAmountOut: 0n, priceImpact: 0 };
      }
      const amountOut = getSwapOutput(amountIn, rIn, rOut);
      const minAmountOut = applySlippage(amountOut, slippageBps);
      // Price impact: compare actual vs ideal (spot price, no fee)
      const idealOut = (amountIn * rOut) / rIn;
      const priceImpact = idealOut > 0n
        ? Number((idealOut - amountOut) * 10000n / idealOut) / 100
        : 0;
      return { amountOut, minAmountOut, priceImpact };
    },
    [ammState, slippageBps]
  );

  /** Preview: estimate LP tokens for a deposit. */
  const previewAddLiquidity = useCallback(
    (amountA: bigint, amountB: bigint): bigint => {
      const { reserveA, reserveB, lpSupply } = ammState;
      return getLpTokensForDeposit(amountA, amountB, reserveA, reserveB, lpSupply);
    },
    [ammState]
  );

  /** Preview: estimate tokens returned for an LP burn. */
  const previewRemoveLiquidity = useCallback(
    (lpAmount: bigint): { amountA: bigint; amountB: bigint } => {
      const { reserveA, reserveB, lpSupply } = ammState;
      return getWithdrawAmounts(lpAmount, reserveA, reserveB, lpSupply);
    },
    [ammState]
  );

  const swap = useCallback(
    async (tokenIn: string, amountIn: bigint) => {
      if (!address) return;
      setTxStatus("building");
      setTxHash(null);
      setTxError(null);

      try {
        const { minAmountOut } = previewSwap(tokenIn, amountIn);
        const xdr = await buildSwapTransaction(address, tokenIn, amountIn, minAmountOut);

        setTxStatus("signing");
        const signedXdr = await signTransaction(xdr);

        setTxStatus("submitting");
        const result = gasless
          ? await submitGaslessSwap(signedXdr)
          : await submitAmmTransaction(signedXdr);

        setTxHash(result.hash);
        setTxStatus("success");

        cache.invalidate(CACHE_KEYS.AMM_RESERVES);
        cache.invalidate(CACHE_KEYS.LP_SUPPLY);
        await loadAmmState();
      } catch (err) {
        setTxError(classifyError(err));
        setTxStatus("error");
      }
    },
    [address, signTransaction, previewSwap, loadAmmState, gasless]
  );

  const addLiquidity = useCallback(
    async (amountA: bigint, amountB: bigint) => {
      if (!address) return;
      setTxStatus("building");
      setTxHash(null);
      setTxError(null);

      try {
        const expectedLp = previewAddLiquidity(amountA, amountB);
        const minLp = applySlippage(expectedLp, slippageBps);
        const xdr = await buildAddLiquidityTransaction(address, amountA, amountB, minLp);

        setTxStatus("signing");
        const signedXdr = await signTransaction(xdr);

        setTxStatus("submitting");
        const result = await submitAmmTransaction(signedXdr);

        setTxHash(result.hash);
        setTxStatus("success");

        cache.invalidate(CACHE_KEYS.AMM_RESERVES);
        cache.invalidate(CACHE_KEYS.LP_SUPPLY);
        cache.invalidate(CACHE_KEYS.LP_BALANCE(address));
        await loadAmmState();
      } catch (err) {
        setTxError(classifyError(err));
        setTxStatus("error");
      }
    },
    [address, signTransaction, previewAddLiquidity, slippageBps, loadAmmState]
  );

  const removeLiquidity = useCallback(
    async (lpAmount: bigint) => {
      if (!address) return;
      setTxStatus("building");
      setTxHash(null);
      setTxError(null);

      try {
        const { amountA, amountB } = previewRemoveLiquidity(lpAmount);
        const minA = applySlippage(amountA, slippageBps);
        const minB = applySlippage(amountB, slippageBps);
        const xdr = await buildRemoveLiquidityTransaction(address, lpAmount, minA, minB);

        setTxStatus("signing");
        const signedXdr = await signTransaction(xdr);

        setTxStatus("submitting");
        const result = await submitAmmTransaction(signedXdr);

        setTxHash(result.hash);
        setTxStatus("success");

        cache.invalidate(CACHE_KEYS.AMM_RESERVES);
        cache.invalidate(CACHE_KEYS.LP_SUPPLY);
        cache.invalidate(CACHE_KEYS.LP_BALANCE(address));
        await loadAmmState();
      } catch (err) {
        setTxError(classifyError(err));
        setTxStatus("error");
      }
    },
    [address, signTransaction, previewRemoveLiquidity, slippageBps, loadAmmState]
  );

  const resetTx = useCallback(() => {
    setTxStatus("idle");
    setTxHash(null);
    setTxError(null);
  }, []);

  return {
    ammState,
    txStatus,
    txHash,
    txError,
    slippageBps,
    setSlippageBps,
    gasless,
    setGasless,
    swap,
    addLiquidity,
    removeLiquidity,
    previewSwap,
    previewAddLiquidity,
    previewRemoveLiquidity,
    resetTx,
    refreshAmm: loadAmmState,
  };
}
