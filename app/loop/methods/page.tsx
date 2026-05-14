/**
 * Method Comparison Page — /loop/methods
 *
 * Secondary page to keep the main /loop dashboard uncluttered. Surfaces
 * the rigorous statistical comparison: 30 runs × 4 methods at fixed budget,
 * Welch t-test + Cohen's d for pairwise significance.
 *
 * For the methodology rationale see docs/DESIGN_DECISIONS.md ADR-8.
 * For the limitations (Bonferroni, normality, power analysis) see
 * docs/LIMITATIONS.md L9-L11.
 */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { compareMethods, type MethodComparisonReport, type ComparisonResult } from "@/lib/agent/method-comparison";
import {
  SUGGESTION_PARAM_SPACE,
  DEFAULT_PARAMS,
  simulateSuggestionForOptimizer,
} from "@/lib/agent/alert-feedback-tuning";
import { loadRealPriceDataset, getDatasetMeta } from "@/lib/agent/price-source";
import { useLocale } from "../i18n";

const CACHE_KEY = "stellar-pay-method-comparison-result";

function formatP(p: number): string {
  if (p < 0.001) return "p < 0.001";
  if (p < 0.01) return "p < 0.01";
  if (p < 0.05) return "p < 0.05";
  return `p = ${p.toFixed(3)}`;
}

function effectColor(eff: ComparisonResult["effectSize"]): string {
  switch (eff) {
    case "large": return "text-emerald-700 dark:text-emerald-400";
    case "medium": return "text-indigo-700 dark:text-indigo-400";
    case "small": return "text-amber-700 dark:text-amber-400";
    default: return "text-neutral-500 dark:text-neutral-400";
  }
}

export default function MethodsPage() {
  const { locale, t, toggle } = useLocale();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState<MethodComparisonReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasetMeta, setDatasetMeta] = useState(getDatasetMeta());

  // Try restoring cached result on mount
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) setReport(JSON.parse(cached));
    } catch {
      // ignore — cached value malformed
    }
    void loadRealPriceDataset().then(() => {
      setDatasetMeta(getDatasetMeta());
    });
  }, []);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setProgress(locale === "zh" ? "加载数据集..." : "Loading dataset...");
    await new Promise(r => setTimeout(r, 50));
    try {
      // Make sure the real dataset is loaded
      const ds = await loadRealPriceDataset();
      const series =
        ds && ds.splits
          ? [...ds.splits.train, ...ds.splits.validation, ...ds.splits.test].map(p => p.price)
          : [];
      if (series.length < 100) {
        setError(
          locale === "zh"
            ? `数据点不足（仅 ${series.length} 个），无法进行 30 次重复实验。`
            : `Insufficient data (${series.length} points). Need >= 100 for 30-run comparison.`
        );
        setRunning(false);
        return;
      }

      setProgress(
        locale === "zh"
          ? "运行 30 次 × 4 方法（约 30 秒）..."
          : "Running 30 runs × 4 methods (~30s)..."
      );
      await new Promise(r => setTimeout(r, 50));

      const t0 = Date.now();
      const result = compareMethods(
        series,
        SUGGESTION_PARAM_SPACE as unknown as Parameters<typeof compareMethods>[1],
        simulateSuggestionForOptimizer as unknown as Parameters<typeof compareMethods>[2],
        DEFAULT_PARAMS as unknown as Parameters<typeof compareMethods>[3],
        { runs: 30, budget: 500, windowsPerEvaluation: 30, windowSize: 50 }
      );
      const elapsed = Date.now() - t0;
      result.durationMs = elapsed;

      setReport(result);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));
      } catch {
        // quota exceeded — silently ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  const handleClear = () => {
    setReport(null);
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                {locale === "zh" ? "方法对比 (30 runs × 4 方法)" : "Method Comparison (30 runs × 4 methods)"}
              </h1>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {locale === "zh"
                  ? "Welch t-test + Cohen's d · 标准化 budget=500"
                  : "Welch t-test + Cohen's d · standardized budget=500"}
              </p>
              {datasetMeta.loaded && (
                <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                  {locale === "zh" ? "数据集：" : "Dataset: "}
                  {datasetMeta.totalPoints.toLocaleString()} {locale === "zh" ? "个数据点" : "points"} · {datasetMeta.proxyAsset ?? "—"}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={toggle}
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {locale === "zh" ? "EN" : "中"}
              </button>
              <button
                onClick={() => void handleRun()}
                disabled={running}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {running ? (locale === "zh" ? "运行中..." : "Running...") : (locale === "zh" ? "运行对比" : "Run Comparison")}
              </button>
              {report && !running && (
                <button
                  onClick={handleClear}
                  className="rounded border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {locale === "zh" ? "清除结果" : "Clear"}
                </button>
              )}
              <Link
                href="/loop"
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {locale === "zh" ? "← Dashboard" : "← Dashboard"}
              </Link>
            </div>
          </div>
        </div>

        {progress && (
          <div className="rounded border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            {progress}
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!report && !running && !error && (
          <div className="rounded border border-neutral-200 bg-neutral-50 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {locale === "zh" ? "尚未运行" : "No comparison run yet"}
            </p>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
              {locale === "zh"
                ? '点击"运行对比"在 30 个种子上运行 4 个方法（Default / Random Search / Grid Search / Monte Carlo），统计学检验 Monte Carlo 是否显著优于其他方法。约需 30 秒。'
                : 'Click "Run Comparison" to run 4 methods (Default / Random Search / Grid Search / Monte Carlo) on 30 seeds and statistically test whether Monte Carlo significantly beats alternatives. Takes ~30s.'}
            </p>
          </div>
        )}

        {report && (
          <>
            <ScoresTable report={report} t={t} locale={locale} />
            <ComparisonsTable report={report} t={t} locale={locale} />
            <Methodology t={t} locale={locale} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoresTable({
  report,
  locale,
}: {
  report: MethodComparisonReport;
  t: (key: string) => string;
  locale: "zh" | "en";
}) {
  const rows: Array<{ name: string; key: keyof MethodComparisonReport["methods"]; isDeterministic?: boolean }> = [
    { name: "Default", key: "default", isDeterministic: true },
    { name: "Random Search", key: "randomSearch" },
    { name: "Grid Search", key: "gridSearch", isDeterministic: true },
    { name: "Monte Carlo", key: "monteCarlo" },
  ];
  const baselineMean = report.methods.default.mean;

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {locale === "zh" ? "得分分布（30 次重复实验）" : "Score Distribution (30 runs)"}
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-indigo-200 dark:border-indigo-800">
              <th className="py-2 text-left text-neutral-600 dark:text-neutral-400">{locale === "zh" ? "方法" : "Method"}</th>
              <th className="py-2 text-right text-neutral-600 dark:text-neutral-400">Mean ± Std</th>
              <th className="py-2 text-right text-neutral-600 dark:text-neutral-400">Min / Max</th>
              <th className="py-2 text-right text-neutral-600 dark:text-neutral-400">{locale === "zh" ? "vs Default" : "Δ vs Default"}</th>
              <th className="py-2 text-right text-neutral-600 dark:text-neutral-400">{locale === "zh" ? "类型" : "Type"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ name, key, isDeterministic }) => {
              const m = report.methods[key];
              const delta = m.mean - baselineMean;
              const deltaColor =
                delta > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : delta < 0
                  ? "text-red-700 dark:text-red-400"
                  : "text-neutral-500 dark:text-neutral-400";
              return (
                <tr key={key} className="border-b border-indigo-100 dark:border-indigo-900">
                  <td className="py-2 font-mono text-neutral-800 dark:text-neutral-200">{name}</td>
                  <td className="py-2 text-right font-mono text-neutral-800 dark:text-neutral-200">
                    {m.mean.toFixed(2)} ± {m.std.toFixed(2)}
                  </td>
                  <td className="py-2 text-right font-mono text-neutral-500 dark:text-neutral-400">
                    {m.min.toFixed(2)} / {m.max.toFixed(2)}
                  </td>
                  <td className={`py-2 text-right font-mono ${deltaColor}`}>
                    {key === "default" ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`}
                  </td>
                  <td className="py-2 text-right text-neutral-500 dark:text-neutral-400">
                    {isDeterministic ? (locale === "zh" ? "确定性" : "deterministic") : (locale === "zh" ? "随机" : "stochastic")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-neutral-500 dark:text-neutral-400">
        {locale === "zh"
          ? `Budget: ${report.budget} 次评估 / run · 总时间: ${(report.durationMs / 1000).toFixed(1)}s · Default 是单次评估，std=0；Grid 是确定性，std≈0`
          : `Budget: ${report.budget} evals/run · Total: ${(report.durationMs / 1000).toFixed(1)}s · Default is single eval (std=0); Grid is deterministic (std≈0)`}
      </p>
    </div>
  );
}

function ComparisonsTable({
  report,
  locale,
}: {
  report: MethodComparisonReport;
  t: (key: string) => string;
  locale: "zh" | "en";
}) {
  const pairs: Array<{ key: keyof MethodComparisonReport["comparisons"]; punchline: string }> = [
    {
      key: "MC vs Random",
      punchline:
        locale === "zh"
          ? "核心命题：MC 的结构化搜索是否优于同 budget 的纯随机？"
          : "Core claim: does MC's structured search beat random at same budget?",
    },
    {
      key: "MC vs Grid",
      punchline:
        locale === "zh"
          ? "MC 是否优于确定性网格？"
          : "Does MC beat deterministic grid?",
    },
    {
      key: "Grid vs Random",
      punchline: locale === "zh" ? "Sanity check：Grid 是否好于纯随机？" : "Sanity check: does Grid beat random?",
    },
    {
      key: "Tuned vs Default",
      punchline: locale === "zh" ? "整体闭环价值：调优是否优于硬编码 default？" : "Overall closed-loop value: does tuning beat hardcoded default?",
    },
  ];

  return (
    <div className="rounded border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {locale === "zh" ? "成对比较 (Welch t-test + Cohen's d)" : "Pairwise Comparisons (Welch t-test + Cohen's d)"}
      </h2>
      <div className="mt-3 space-y-3">
        {pairs.map(({ key, punchline }) => {
          const r = report.comparisons[key];
          return (
            <div
              key={key}
              className="rounded border border-indigo-200 bg-white p-3 text-xs dark:border-indigo-800 dark:bg-indigo-900"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium text-indigo-800 dark:text-indigo-200">{key}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                    r.significant
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                  }`}
                >
                  {r.significant ? (locale === "zh" ? "显著" : "Significant") : (locale === "zh" ? "不显著" : "Not significant")}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">{punchline}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">Δ mean</dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">
                    {r.meanDiff >= 0 ? "+" : ""}
                    {r.meanDiff.toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">t-stat</dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">{r.tStat.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">dof</dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">{r.dof.toFixed(1)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">p-value</dt>
                  <dd className="font-mono text-neutral-800 dark:text-neutral-200">{formatP(r.pValue)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-600 dark:text-neutral-400">Cohen&apos;s d</dt>
                  <dd className={`font-mono font-semibold ${effectColor(r.effectSize)}`}>
                    {r.cohensD.toFixed(2)} ({r.effectSize})
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

function Methodology({ locale }: { t: (key: string) => string; locale: "zh" | "en" }) {
  return (
    <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-xs dark:border-emerald-800 dark:bg-emerald-950">
      <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        {locale === "zh" ? "方法说明" : "Methodology"}
      </h3>
      <ul className="mt-2 space-y-1 text-emerald-800 dark:text-emerald-300">
        <li>
          <strong>{locale === "zh" ? "标准化 budget" : "Standardized budget"}：</strong>
          {locale === "zh"
            ? " 每个方法每次 run 都跑 500 次评估。否则比较的是 budget 不是搜索策略。"
            : " every method runs 500 evals per trial. Otherwise we'd compare budgets, not search strategies."}
        </li>
        <li>
          <strong>30 runs：</strong>
          {locale === "zh"
            ? " 种子 [1..30]。30 是 t 分布近似正态分布 + 中心极限定理生效的渐近门槛。"
            : " seeds [1..30]. 30 is the asymptotic threshold where t ≈ Normal and CLT kicks in for means."}
        </li>
        <li>
          <strong>Welch t-test：</strong>
          {locale === "zh"
            ? " 不假设方差相等（Grid 是 std≈0、Random 高方差，Student's 会给错的 p）。两尾。"
            : " unequal-variance variant (Grid std≈0, Random high — Student's would give wrong p). Two-tailed."}
        </li>
        <li>
          <strong>Cohen&apos;s d：</strong>
          {locale === "zh"
            ? " 标准化效应量。p 说效应是否真实，d 说效应是否大到值得在意。0.2=small / 0.5=medium / 0.8+=large。"
            : " standardized effect size. p says \"real?\", d says \"big enough?\". 0.2=small / 0.5=medium / 0.8+=large."}
        </li>
        <li className="pt-1 text-emerald-700 dark:text-emerald-400">
          {locale === "zh" ? "已知局限（详见 docs/LIMITATIONS.md）：" : "Known limitations (see docs/LIMITATIONS.md):"}
          <ul className="ml-4 mt-1 list-disc">
            <li>L9 — {locale === "zh" ? "未做 Bonferroni 校正（4 次成对比较）" : "no Bonferroni correction for 4 pairwise tests"}</li>
            <li>L10 — {locale === "zh" ? "未做 Shapiro–Wilk 正态性检验（依赖 CLT）" : "no formal Shapiro–Wilk normality test (CLT relied upon)"}</li>
            <li>L11 — {locale === "zh" ? "事后分析，未做 prospective power analysis" : "post-hoc analysis, no prospective power analysis"}</li>
          </ul>
        </li>
      </ul>
    </div>
  );
}
