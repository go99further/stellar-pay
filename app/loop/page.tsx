/**
 * Closed-Loop Dashboard — /loop
 *
 * Visualizes the 4 layers of the data closed loop in one page.
 * Read-only by design — no wallet required. Operates entirely on
 * localStorage state, so visitors without seeded data should click
 * "Load Demo Data" first.
 *
 * For the architectural narrative, see docs/CLOSED_LOOP.md.
 */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getFeedbackRecords } from "@/lib/agent/alert-feedback";
import { getSecurityStats, type SecurityDetectorType } from "@/lib/agent/security-feedback";
import {
  getSuggestionParams,
  setSuggestionParams,
  tuneSuggestionParams,
  type TuningReport,
  type SuggestionParams,
} from "@/lib/agent/alert-feedback-tuning";
import { seedDemoData, clearDemoData, isDemoDataPresent } from "@/lib/agent/demo-seed";
import { loadRealPriceDataset, getDatasetMeta } from "@/lib/agent/price-source";
import { InvariantsCheck } from "./InvariantsCheck";

// ── Layer 1 helpers ───────────────────────────────────────────────────────────

function computeLayer1() {
  const records = getFeedbackRecords();
  const settled = records.filter(r => r.outcome !== "pending");
  const hits = settled.filter(r => r.outcome === "hit").length;
  const misses = settled.filter(r => r.outcome === "miss").length;
  const pending = records.length - settled.length;
  const hitRate = settled.length > 0 ? hits / settled.length : null;
  const confidence =
    settled.length >= 5 ? "HIGH" : settled.length >= 3 ? "MEDIUM" : "LOW";
  return { records, settled, hits, misses, pending, hitRate, confidence };
}

function hitRateColor(hitRate: number | null): string {
  if (hitRate === null) return "text-neutral-500 dark:text-neutral-400";
  if (hitRate >= 0.75) return "text-emerald-700 dark:text-emerald-400";
  if (hitRate >= 0.5) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function hitRateBorder(hitRate: number | null): string {
  if (hitRate === null)
    return "border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900";
  if (hitRate >= 0.75)
    return "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950";
  if (hitRate >= 0.5)
    return "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950";
  return "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950";
}

// ── Layer 2 helpers ───────────────────────────────────────────────────────────

const DETECTOR_TYPES: SecurityDetectorType[] = ["price_impact", "liquidity_flow", "sandwich"];

function detectorLabel(d: SecurityDetectorType): string {
  if (d === "price_impact") return "price_impact";
  if (d === "liquidity_flow") return "liquidity_flow";
  return "sandwich";
}

function confidenceBadge(c: "high" | "medium" | "low"): string {
  if (c === "high")
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300";
  if (c === "medium")
    return "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300";
  return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LoopPage() {
  const [demoSeeded, setDemoSeeded] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [tuningResult, setTuningResult] = useState<TuningReport | null>(null);
  const [tuningError, setTuningError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // All data derived from localStorage — read once on mount (client only)
  const [layer1, setLayer1] = useState<ReturnType<typeof computeLayer1> | null>(null);
  const [params, setParams] = useState<SuggestionParams>(getSuggestionParams());
  const [datasetMeta, setDatasetMeta] = useState(getDatasetMeta());

  useEffect(() => {
    setDemoSeeded(isDemoDataPresent());
    setLayer1(computeLayer1());
    setParams(getSuggestionParams());

    // Try to fetch real mainnet/CEX price dataset for the optimizer.
    // Failure is silent — engines fall back to localStorage transactions.
    void loadRealPriceDataset().then(() => {
      setDatasetMeta(getDatasetMeta());
    });
  }, []);

  const handleLoadDemo = () => {
    seedDemoData();
    window.location.reload();
  };

  const handleClearDemo = () => {
    clearDemoData();
    window.location.reload();
  };

  const handleTune = async () => {
    setTuning(true);
    setTuningError(null);
    // Yield to React so the spinner renders before the synchronous 500-iteration loop
    await new Promise(r => setTimeout(r, 50));
    try {
      const result = tuneSuggestionParams();
      setTuningResult(result);
      // Refresh params display after tuning (tuneSuggestionParams persists on success)
      setParams(getSuggestionParams());
    } catch (err) {
      setTuningError(err instanceof Error ? err.message : "Tuning failed");
    } finally {
      setTuning(false);
    }
  };

  const handleApplySuggested = () => {
    if (!tuningResult) return;
    setApplyError(null);
    try {
      setSuggestionParams(tuningResult.params);
      window.location.reload();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Apply failed");
    }
  };

  // Determine empty state: no alert feedback records and no security records
  const hasData = layer1 !== null && layer1.records.length > 0;
  const securityTotals = DETECTOR_TYPES.map(d => getSecurityStats(d).total);
  const hasSecurityData = securityTotals.some(t => t > 0);
  const isEmpty = !hasData && !hasSecurityData;

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* ── Header ── */}
        <div className="rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                Closed-Loop Dashboard
              </h1>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                4-layer self-learning system &bull; Read-only demo
              </p>
              {datasetMeta.loaded ? (
                <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" title={datasetMeta.sources.map(s => `${s.name} (${s.count})`).join(" · ")}>
                  ● Tuning on real data: {datasetMeta.totalPoints.toLocaleString()} points across {datasetMeta.sources.length} sources
                </div>
              ) : (
                <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  ○ Real dataset not loaded — using localStorage fallback
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={demoSeeded ? handleClearDemo : handleLoadDemo}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                {demoSeeded ? "Clear Demo Data" : "Load Demo Data"}
              </button>
              <button
                onClick={() => void handleTune()}
                disabled={tuning}
                className="rounded border border-indigo-300 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950"
              >
                {tuning ? "Tuning…" : "Tune Now"}
              </button>
              <Link
                href="/"
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                &larr; Back
              </Link>
            </div>
          </div>
        </div>

        {/* ── Empty state ── */}
        {isEmpty && (
          <div className="rounded border border-neutral-200 bg-neutral-50 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">No data yet</p>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto">
              This dashboard visualizes a 4-layer data closed-loop. To see it populated, click
              &ldquo;Load Demo Data&rdquo; above.
            </p>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Or visit{" "}
              <a href="/agent" className="text-indigo-600 hover:underline dark:text-indigo-400">
                /agent
              </a>{" "}
              to interact with the system and generate real data.
            </p>
          </div>
        )}

        {/* ── Layer cards grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Layer1Card layer1={layer1} />
          <Layer2Card />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Layer3Card
            params={params}
            tuning={tuning}
            tuningResult={tuningResult}
            tuningError={tuningError}
            onTune={() => void handleTune()}
          />
          <Layer4Card
            params={params}
            tuningResult={tuningResult}
            applyError={applyError}
            onApply={handleApplySuggested}
          />
        </div>

        {/* ── Invariants ── */}
        <InvariantsCheck />

      </div>
    </div>
  );
}

// ── Layer 1 Card ──────────────────────────────────────────────────────────────

interface Layer1CardProps {
  layer1: ReturnType<typeof computeLayer1> | null;
}

function Layer1Card({ layer1 }: Layer1CardProps) {
  const hitRate = layer1?.hitRate ?? null;
  const borderClass = hitRateBorder(hitRate);
  const colorClass = hitRateColor(hitRate);

  return (
    <div className={`rounded border p-4 ${borderClass}`}>
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        Layer 1: Alert Feedback
      </h2>
      <div className="mt-1 h-px bg-neutral-200 dark:bg-neutral-700" />
      {layer1 === null || layer1.records.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          No feedback records yet.
        </p>
      ) : (
        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Hit rate</dt>
            <dd className={`font-mono font-semibold ${colorClass}`}>
              {hitRate !== null
                ? `${(hitRate * 100).toFixed(0)}% (${layer1.confidence})`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Hits / Misses</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {layer1.hits} hits / {layer1.misses} miss
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Pending</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">{layer1.pending}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Settled</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {layer1.settled.length}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-neutral-600 dark:text-neutral-400">Total records</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {layer1.records.length}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ── Layer 2 Card ──────────────────────────────────────────────────────────────

function Layer2Card() {
  const detectorStats = DETECTOR_TYPES.map(d => ({
    type: d,
    stats: getSecurityStats(d),
  }));

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        Layer 2: Security Detectors
      </h2>
      <div className="mt-1 h-px bg-indigo-200 dark:bg-indigo-800" />
      <div className="mt-3 space-y-3">
        {detectorStats.map(({ type, stats }) => {
          const highExpiration = stats.expirationRate > 0.30;
          return (
            <div
              key={type}
              className="rounded border border-indigo-200 bg-white p-3 dark:border-indigo-700 dark:bg-indigo-900"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium text-indigo-800 dark:text-indigo-200">
                  {detectorLabel(type)}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${confidenceBadge(stats.confidence)}`}
                >
                  {stats.confidence}
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">Precision</dt>
                  <dd className="font-mono">
                    {stats.precision !== null ? (
                      highExpiration ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          <span className="line-through">
                            {(stats.precision * 100).toFixed(0)}%
                          </span>
                          {" ⚠ data unreliable due to high expiration"}
                        </span>
                      ) : (
                        <span className="text-neutral-800 dark:text-neutral-200">
                          {(stats.precision * 100).toFixed(0)}%
                        </span>
                      )
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">expirationRate</dt>
                  <dd
                    className={`font-mono ${
                      highExpiration
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-neutral-800 dark:text-neutral-200"
                    }`}
                  >
                    {(stats.expirationRate * 100).toFixed(0)}%
                    {highExpiration ? " ⚠" : " ✓"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">effectiveSampleRate</dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                    {(stats.effectiveSampleRate * 100).toFixed(0)}%
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">
                    confirmed / fp / pending
                  </dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                    {stats.confirmed} / {stats.falsePositives} / {stats.pending}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Layer 3 Card ──────────────────────────────────────────────────────────────

interface Layer3CardProps {
  params: SuggestionParams;
  tuning: boolean;
  tuningResult: TuningReport | null;
  tuningError: string | null;
  onTune: () => void;
}

function Layer3Card({ params, tuning, tuningResult, tuningError, onTune }: Layer3CardProps) {
  return (
    <div className="rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        Layer 3: Parameter Optimizer
      </h2>
      <div className="mt-1 h-px bg-indigo-200 dark:bg-indigo-800" />

      <div className="mt-3 space-y-1 text-xs">
        <p className="font-medium text-neutral-600 dark:text-neutral-400">Current weights:</p>
        <dl className="ml-2 space-y-1">
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">onlineWeight</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.onlineWeight.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">keepThreshold</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.keepThreshold.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">tightenThreshold</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.tightenThreshold.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">tightenDelta</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.tightenDelta.toFixed(3)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">loosenDelta</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.loosenDelta.toFixed(3)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-3">
        <button
          onClick={onTune}
          disabled={tuning}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {tuning ? "Running 500 iterations…" : "Tune Now (500 iterations)"}
        </button>
      </div>

      {tuningError && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {tuningError}
        </div>
      )}

      {tuningResult && (
        <div className="mt-3 space-y-2 rounded border border-indigo-300 bg-white p-3 text-xs dark:border-indigo-700 dark:bg-indigo-900">
          <p className="font-medium text-indigo-800 dark:text-indigo-200">Tuning result</p>

          {!tuningResult.success && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Overfit / invalid: test score significantly below train. Params not auto-applied.
            </div>
          )}

          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">onlineWeight</dt>
              <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                {tuningResult.params.onlineWeight.toFixed(3)}
                {tuningResult.confidenceInterval && (
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {" ["}
                    {tuningResult.confidenceInterval.p25.onlineWeight.toFixed(2)}
                    {"–"}
                    {tuningResult.confidenceInterval.p75.onlineWeight.toFixed(2)}
                    {"]"}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">Train / Val / Test</dt>
              <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                {tuningResult.trainScore.toFixed(1)} / {tuningResult.validationScore.toFixed(1)} /{" "}
                {tuningResult.testScore.toFixed(1)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-600 dark:text-neutral-400">Sample count</dt>
              <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                {tuningResult.sampleCount}
              </dd>
            </div>
          </dl>

          <p className="leading-relaxed text-neutral-500 dark:text-neutral-400">
            {tuningResult.message}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Layer 4 Card ──────────────────────────────────────────────────────────────

interface Layer4CardProps {
  params: SuggestionParams;
  tuningResult: TuningReport | null;
  applyError: string | null;
  onApply: () => void;
}

function Layer4Card({ params, tuningResult, applyError, onApply }: Layer4CardProps) {
  const canApply = tuningResult !== null && tuningResult.success;

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        Layer 4: HITL Bridge
      </h2>
      <div className="mt-1 h-px bg-indigo-200 dark:bg-indigo-800" />

      <div className="mt-3 space-y-1 text-xs">
        <p className="font-medium text-neutral-600 dark:text-neutral-400">Current params:</p>
        <dl className="ml-2 space-y-1">
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">onlineWeight</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.onlineWeight.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">keepThreshold</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.keepThreshold.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">tightenThreshold</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.tightenThreshold.toFixed(2)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">tightenDelta</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.tightenDelta.toFixed(3)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-mono text-neutral-600 dark:text-neutral-400">loosenDelta</dt>
            <dd className="font-mono text-neutral-800 dark:text-neutral-200">
              {params.loosenDelta.toFixed(3)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-3 space-y-1 rounded border border-indigo-200 bg-white p-3 text-xs dark:border-indigo-700 dark:bg-indigo-900">
        <p className="text-neutral-600 dark:text-neutral-400">
          Human-in-the-loop gate: parameter changes require explicit user confirmation.
          The optimizer only <em>suggests</em> — it never auto-applies.
        </p>
        {!tuningResult && (
          <p className="text-neutral-500 dark:text-neutral-400">
            Run &ldquo;Tune Now&rdquo; in Layer 3 to generate a suggestion.
          </p>
        )}
        {tuningResult && !canApply && (
          <p className="text-amber-700 dark:text-amber-400">
            Suggestion blocked: tuning did not succeed (overfit or invalid params). Expand data window and retry.
          </p>
        )}
      </div>

      {canApply && (
        <div className="mt-3">
          <button
            onClick={onApply}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Apply Suggested Params (HITL)
          </button>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Persists to localStorage and reloads the page.
          </p>
        </div>
      )}

      {applyError && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {applyError}
        </div>
      )}
    </div>
  );
}
