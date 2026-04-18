"use client";

import { useState } from "react";
import { useAmmContract } from "@/hooks/useAmmContract";
import { getTokenAId, getTokenBId } from "@/lib/amm-contract";
import { useWallet } from "@/context/WalletContext";

const TOKEN_A_SYMBOL = "TKNA";
const TOKEN_B_SYMBOL = "TKNB";
const DECIMALS = 7; // Soroban token decimals

function toRaw(display: string): bigint {
  const n = parseFloat(display || "0");
  if (isNaN(n) || n <= 0) return 0n;
  return BigInt(Math.round(n * 10 ** DECIMALS));
}

function toDisplay(raw: bigint): string {
  if (raw === 0n) return "0";
  const n = Number(raw) / 10 ** DECIMALS;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function SwapCard() {
  const { address } = useWallet();
  const {
    ammState,
    txStatus,
    txHash,
    txError,
    slippageBps,
    setSlippageBps,
    swap,
    previewSwap,
    resetTx,
  } = useAmmContract();

  const [amountIn, setAmountIn] = useState("");
  const [direction, setDirection] = useState<"AtoB" | "BtoA">("AtoB");

  const tokenIn = direction === "AtoB" ? getTokenAId() : getTokenBId();
  const symbolIn = direction === "AtoB" ? TOKEN_A_SYMBOL : TOKEN_B_SYMBOL;
  const symbolOut = direction === "AtoB" ? TOKEN_B_SYMBOL : TOKEN_A_SYMBOL;

  const rawIn = toRaw(amountIn);
  const { amountOut, minAmountOut, priceImpact } = previewSwap(tokenIn, rawIn);

  const noLiquidity = ammState.reserveA === 0n || ammState.reserveB === 0n;
  const canSwap =
    !!address && rawIn > 0n && amountOut > 0n && !noLiquidity && txStatus === "idle";

  async function handleSwap() {
    await swap(tokenIn, rawIn);
  }

  const SLIPPAGE_OPTIONS = [25n, 50n, 100n]; // 0.25%, 0.5%, 1%

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Swap Tokens</h2>

      {/* Direction toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {symbolIn} → {symbolOut}
        </span>
        <button
          onClick={() => {
            setDirection((d) => (d === "AtoB" ? "BtoA" : "AtoB"));
            setAmountIn("");
            resetTx();
          }}
          className="ml-auto text-xs px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition"
        >
          ⇄ Flip
        </button>
      </div>

      {/* Input */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400">You pay ({symbolIn})</label>
        <input
          type="number"
          min="0"
          step="0.0000001"
          value={amountIn}
          onChange={(e) => { setAmountIn(e.target.value); resetTx(); }}
          placeholder="0.0"
          className="mt-1 w-full border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
        />
      </div>

      {/* Output preview */}
      <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 space-y-1">
        <p className="text-xs text-gray-500 dark:text-gray-400">You receive ({symbolOut})</p>
        <p className="text-xl font-semibold text-gray-900 dark:text-white">
          {rawIn > 0n ? toDisplay(amountOut) : "—"}
        </p>
        {rawIn > 0n && (
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 pt-1">
            <span>Min received: {toDisplay(minAmountOut)}</span>
            <span className={priceImpact > 5 ? "text-red-500" : ""}>
              Impact: {priceImpact.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Slippage */}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>Slippage:</span>
        {SLIPPAGE_OPTIONS.map((bps) => (
          <button
            key={bps}
            onClick={() => setSlippageBps(bps)}
            className={`px-2 py-1 rounded-full border text-xs transition ${
              slippageBps === bps
                ? "bg-indigo-600 text-white border-indigo-600"
                : "border-gray-300 dark:border-gray-600 hover:border-indigo-400"
            }`}
          >
            {Number(bps) / 100}%
          </button>
        ))}
      </div>

      {/* No liquidity warning */}
      {noLiquidity && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Pool has no liquidity yet. Add liquidity first.
        </p>
      )}

      {/* Action button */}
      {txStatus === "idle" || txStatus === "error" ? (
        <button
          onClick={handleSwap}
          disabled={!canSwap}
          className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {!address ? "Connect Wallet" : "Swap"}
        </button>
      ) : txStatus === "success" ? (
        <div className="space-y-2">
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm text-green-700 dark:text-green-300">
            Swap successful!{" "}
            {txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View TX
              </a>
            )}
          </div>
          <button
            onClick={() => { resetTx(); setAmountIn(""); }}
            className="w-full py-2 text-sm text-indigo-600 hover:underline"
          >
            Swap again
          </button>
        </div>
      ) : (
        <div className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-400 text-center cursor-wait">
          {txStatus === "building" && "Building..."}
          {txStatus === "signing" && "Sign in wallet..."}
          {txStatus === "submitting" && "Submitting..."}
        </div>
      )}

      {txError && (
        <p className="text-sm text-red-600 dark:text-red-400">{txError.message}</p>
      )}
    </div>
  );
}
