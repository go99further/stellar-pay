"use client";

interface WalletConnectProps {
  address: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  loading: boolean;
}

export default function WalletConnect({
  address,
  onConnect,
  onDisconnect,
  loading,
}: WalletConnectProps) {
  if (address) {
    const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Avatar circle with gradient */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white font-bold text-sm">
            {address.slice(1, 3)}
          </div>
          <div>
            <p className="text-xs text-slate-400">Connected</p>
            <p className="text-sm font-mono text-white" title={address}>
              {shortAddress}
            </p>
          </div>
        </div>
        <button
          onClick={onDisconnect}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-red-400/50 hover:text-red-400 transition-all duration-200 cursor-pointer"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      disabled={loading}
      className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-500 to-violet-500 hover:from-blue-400 hover:to-violet-400 shadow-lg shadow-blue-500/25 hover:shadow-blue-400/40 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      {loading ? (
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
          Connecting...
        </span>
      ) : (
        "Connect Freighter Wallet"
      )}
    </button>
  );
}
