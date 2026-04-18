import MetricsDashboard from "@/components/MetricsDashboard";

export const metadata = {
  title: "Metrics — Stellar Pay + Vote + Swap",
  description: "Live AMM pool metrics: swap volume, TVL, and recent activity",
};

export default function MetricsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 py-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white">AMM Pool Metrics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Live data indexed from Soroban contract events · auto-refreshes every 30s
          </p>
        </header>
        <MetricsDashboard />
        <footer className="text-xs text-slate-500 text-center pt-4">
          Data sourced from{" "}
          <a
            href="https://soroban-testnet.stellar.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400/60 hover:text-blue-400"
          >
            Soroban Testnet RPC
          </a>{" "}
          · Health check:{" "}
          <a href="/api/health" className="text-blue-400/60 hover:text-blue-400">
            /api/health
          </a>
        </footer>
      </div>
    </main>
  );
}
