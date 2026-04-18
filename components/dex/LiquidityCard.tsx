"use client";

import { useState } from "react";
import { useAmmContract } from "@/hooks/useAmmContract";
import { useWallet } from "@/context/WalletContext";

const DECIMALS = 7;

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

type SubTab = "add" | "remove";

export default function LiquidityCard() {
  const { address } = useWallet();
  const {
    ammState,
    txStatus,
    txHash,
    txError,
    addLiquidity,
    removeLiquidity,
    previewAddLiquidity,
    previewRemoveLiquidity,
    resetTx,
  } = useAmmContract();

  const [tab, setTab] = useState<SubTab>("add");
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [lpBurn, setLpBurn] = useState("");

  const rawA = toRaw(amountA);
  const rawB = toRaw(amountB);
  const rawLp = toRaw(lpBurn);

  const expectedLp = previewAddLiquidity(rawA, rawB);
  const { amountA: outA, amountB: outB } = previewRemoveLiquidity(rawLp);

  const poolShare =
    ammState.lpSupply > 0n
      ? Number((expectedLp * 10000n) / (ammState.lpSupply + expectedLp)) / 100
      : 100;

  const canAdd = !!address && rawA > 0n && rawB > 0n && txStatus === "idle";
  const canRemove = !!address && rawLp > 0n && rawLp <= ammState.lpBalance && txStatus === "idle";

  async function handleAdd() {
    await addLiquidity(rawA, rawB);
  }

  async function handleRemove() {
    await removeLiquidity(rawLp);
  }

  function clearAndReset() {
    setAmountA("");
    setAmountB("");
    setLpBurn("");
    resetTx();
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Liquidity</h2>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {(["add", "remove"] as SubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); clearAndReset(); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {t === "add" ? "Add Liquidity" : "Remove Liquidity"}
          </button>
        ))}
      </div>

      {tab === "add" ? (
        <>
          {/* Add inputs */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Amount TKNA</label>
              <input
                type="number"
                min="0"
                step="0.0000001"
                value={amountA}
                onChange={(e) => { setAmountA(e.target.value); resetTx(); }}
                placeholder="0.0"
                className="mt-1 w-full border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400">Amount TKNB</label>
              <input
                type="number"
                min="0"
                step="0.0000001"
                value={amountB}
                onChange={(e) => { setAmountB(e.target.value); resetTx(); }}
                placeholder="0.0"
                className="mt-1 w-full border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>

          {/* Preview */}
          {rawA > 0n && rawB > 0n && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>LP tokens you receive</span>
                <span className="font-semibold">{toDisplay(expectedLp)}</span>
              </div>
              <div className="flex justify-between text-gray-500 dark:text-gray-400 text-xs">
                <span>Pool share</span>
                <span>{poolShare.toFixed(2)}%</span>
              </div>
            </div>
          )}

          {/* Add button */}
          {txStatus === "idle" || txStatus === "error" ? (
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {!address ? "Connect Wallet" : "Add Liquidity"}
            </button>
          ) : txStatus === "success" ? (
            <div className="space-y-2">
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm text-green-700 dark:text-green-300">
                Liquidity added!{" "}
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
              <button onClick={clearAndReset} className="w-full py-2 text-sm text-indigo-600 hover:underline">
                Add more
              </button>
            </div>
          ) : (
            <div className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-400 text-center cursor-wait">
              {txStatus === "building" && "Building..."}
              {txStatus === "signing" && "Sign in wallet..."}
              {txStatus === "submitting" && "Submitting..."}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Remove input */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              LP tokens to burn (you have {toDisplay(ammState.lpBalance)})
            </label>
            <input
              type="number"
              min="0"
              step="0.0000001"
              value={lpBurn}
              onChange={(e) => { setLpBurn(e.target.value); resetTx(); }}
              placeholder="0.0"
              className="mt-1 w-full border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {rawLp > ammState.lpBalance && (
              <p className="text-xs text-red-500 mt-1">Exceeds your LP balance</p>
            )}
          </div>

          {/* Remove preview */}
          {rawLp > 0n && rawLp <= ammState.lpBalance && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>TKNA you receive</span>
                <span className="font-semibold">{toDisplay(outA)}</span>
              </div>
              <div className="flex justify-between text-gray-600 dark:text-gray-300">
                <span>TKNB you receive</span>
                <span className="font-semibold">{toDisplay(outB)}</span>
              </div>
            </div>
          )}

          {/* Remove button */}
          {txStatus === "idle" || txStatus === "error" ? (
            <button
              onClick={handleRemove}
              disabled={!canRemove}
              className="w-full py-3 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {!address ? "Connect Wallet" : "Remove Liquidity"}
            </button>
          ) : txStatus === "success" ? (
            <div className="space-y-2">
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-3 text-sm text-green-700 dark:text-green-300">
                Liquidity removed!{" "}
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
              <button onClick={clearAndReset} className="w-full py-2 text-sm text-indigo-600 hover:underline">
                Remove more
              </button>
            </div>
          ) : (
            <div className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-400 text-center cursor-wait">
              {txStatus === "building" && "Building..."}
              {txStatus === "signing" && "Sign in wallet..."}
              {txStatus === "submitting" && "Submitting..."}
            </div>
          )}
        </>
      )}

      {txError && (
        <p className="text-sm text-red-600 dark:text-red-400">{txError.message}</p>
      )}
    </div>
  );
}
