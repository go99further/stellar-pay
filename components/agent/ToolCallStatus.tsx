"use client";

interface ToolCallStatusProps {
  toolName: string;
  status: "running" | "completed" | "error";
  error?: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_pool_stats: "Fetching pool reserves",
  get_metrics: "Calculating pool metrics",
  get_recent_events: "Loading recent transactions",
  simulate_swap: "Simulating swap",
  build_swap_xdr: "Building swap transaction",
  simulate_add_liquidity: "Simulating liquidity addition",
  build_add_liquidity_xdr: "Building add liquidity transaction",
  simulate_remove_liquidity: "Simulating liquidity removal",
  build_remove_liquidity_xdr: "Building remove liquidity transaction",
  check_price_impact: "Analyzing price impact",
  analyze_liquidity_depth: "Analyzing liquidity depth",
  scan_recent_anomalies: "Scanning for anomalies",
};

const TOOL_ICONS: Record<string, string> = {
  get_pool_stats: "📊",
  get_metrics: "📈",
  get_recent_events: "📜",
  simulate_swap: "🔄",
  build_swap_xdr: "🔨",
  simulate_add_liquidity: "➕",
  build_add_liquidity_xdr: "🔨",
  simulate_remove_liquidity: "➖",
  build_remove_liquidity_xdr: "🔨",
  check_price_impact: "⚠️",
  analyze_liquidity_depth: "🔍",
  scan_recent_anomalies: "🚨",
};

export function ToolCallStatus({ toolName, status, error }: ToolCallStatusProps) {
  const label = TOOL_LABELS[toolName] || toolName;
  const icon = TOOL_ICONS[toolName] || "⚙️";

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-xs dark:bg-red-950">
        <span className="text-red-600 dark:text-red-400">❌</span>
        <span className="font-medium text-red-700 dark:text-red-300">{label} failed</span>
        {error && <span className="text-red-600 dark:text-red-400">— {error}</span>}
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs dark:bg-emerald-950">
        <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="font-medium text-emerald-700 dark:text-emerald-300">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-indigo-50 px-3 py-2 text-xs dark:bg-indigo-950">
      <span className="animate-pulse text-indigo-600 dark:text-indigo-400">{icon}</span>
      <span className="font-medium text-indigo-700 dark:text-indigo-300">{label}...</span>
    </div>
  );
}
