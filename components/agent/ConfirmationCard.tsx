"use client";

interface ConfirmationCardProps {
  operationType: "swap" | "add_liquidity" | "remove_liquidity";
  details: Record<string, unknown>;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  walletConnected: boolean;
}

export function ConfirmationCard({
  operationType,
  details,
  onConfirm,
  onCancel,
  disabled = false,
  walletConnected,
}: ConfirmationCardProps) {
  return (
    <div className="mt-3 rounded-lg border border-indigo-300 bg-indigo-50 p-4 dark:border-indigo-700 dark:bg-indigo-950">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            {getOperationTitle(operationType)}
          </h3>
          <p className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
            Review the details below before signing
          </p>
        </div>
        <span className="rounded-full bg-indigo-200 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200">
          Requires Signature
        </span>
      </div>

      <div className="mb-4 space-y-2 rounded-md bg-white p-3 dark:bg-neutral-900">
        {renderDetails(operationType, details)}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={disabled || !walletConnected}
          className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {walletConnected ? "Sign & Submit" : "Connect Wallet First"}
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>

      {!walletConnected && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          ⚠ Please connect your Freighter wallet to sign this transaction
        </p>
      )}
    </div>
  );
}

function getOperationTitle(type: string): string {
  switch (type) {
    case "swap":
      return "🔄 Confirm Swap";
    case "add_liquidity":
      return "➕ Confirm Add Liquidity";
    case "remove_liquidity":
      return "➖ Confirm Remove Liquidity";
    default:
      return "Confirm Transaction";
  }
}

function renderDetails(type: string, details: Record<string, unknown>) {
  if (type === "swap") {
    return (
      <>
        <DetailRow label="Selling" value={`${details.amountIn} ${details.tokenIn}`} />
        <DetailRow
          label="Minimum Received"
          value={`${details.minAmountOut} ${details.tokenOut}`}
          highlight
        />
        {details.priceImpact && (
          <DetailRow
            label="Price Impact"
            value={`${details.priceImpact}%`}
            warning={Number(details.priceImpact) > 1}
          />
        )}
        {details.slippageBps && (
          <DetailRow label="Slippage Tolerance" value={`${Number(details.slippageBps) / 100}%`} />
        )}
      </>
    );
  }

  if (type === "add_liquidity") {
    return (
      <>
        <DetailRow label="TKNA Deposit" value={`${details.amountA} TKNA`} />
        <DetailRow label="TKNB Deposit" value={`${details.amountB} TKNB`} />
        <DetailRow label="Minimum LP Tokens" value={`${details.minLp} LP`} highlight />
      </>
    );
  }

  if (type === "remove_liquidity") {
    return (
      <>
        <DetailRow label="LP Tokens to Burn" value={`${details.lpAmount} LP`} />
        <DetailRow label="Minimum TKNA" value={`${details.minA} TKNA`} highlight />
        <DetailRow label="Minimum TKNB" value={`${details.minB} TKNB`} highlight />
      </>
    );
  }

  return null;
}

function DetailRow({
  label,
  value,
  highlight = false,
  warning = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      <span
        className={`font-mono font-medium ${
          warning
            ? "text-amber-700 dark:text-amber-400"
            : highlight
            ? "text-indigo-700 dark:text-indigo-300"
            : "text-neutral-900 dark:text-neutral-100"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
