/**
 * Lightweight i18n for the /loop dashboard.
 *
 * Strategy (per ADR — keep technical keywords in English):
 *  - Narration / labels: translated (中 / EN)
 *  - Technical identifiers (keepThreshold, IQR, HITL, Monte Carlo, walk-forward,
 *    selection bias, Soroban, etc.): stay English even in zh mode — these are
 *    the names a Chinese-speaking technical interviewer already knows.
 *
 * No dependency on next-intl / react-intl — this is a 50-message dictionary,
 * not a 100-locale enterprise app. A useState + localStorage hook is enough.
 *
 * Default locale: zh (per user request — interviewer is a native Chinese speaker).
 */

"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Locale = "zh" | "en";

const STORAGE_KEY = "stellar-pay-locale";

type Dict = Record<string, string>;

const ZH: Dict = {
  // Header
  "header.title": "数据闭环 Dashboard",
  "header.subtitle": "4 层自学习系统 · 只读 demo",
  "header.tuning_real": "● 真实数据训练中：{points} 个数据点 · {sources} 个来源",
  "header.tuning_fallback": "○ 真实数据集未加载 — 使用 localStorage 兜底",
  "header.proxy_disclaimer":
    "TKNA/TKNB 是 testnet 测试代币，没有真实价格 feed。我们用 XLM/USDC（Stellar Horizon mainnet）+ XLM/USD（CoinGecko/Binance/Kraken）作为行为代理。波动率分布与真实 AMM token pair 不同，调优结果用于演示，不是生产级别。",

  // Header buttons
  "header.btn.load_demo": "加载 Demo 数据",
  "header.btn.clear_demo": "清空 Demo 数据",
  "header.btn.tune_now": "立即调优",
  "header.btn.tuning": "调优中…",
  "header.btn.back": "← 返回",
  "header.btn.locale_zh": "中",
  "header.btn.locale_en": "EN",

  // Empty state
  "empty.title": "暂无数据",
  "empty.body":
    '本页可视化 4 层数据闭环。点击上方"加载 Demo 数据"查看预置的演示场景。',
  "empty.or_visit": "或访问",
  "empty.to_generate": "与系统交互，生成真实数据。",

  // Layer 1
  "layer1.title": "Layer 1：警报反馈（Alert Feedback）",
  "layer1.empty": "暂无反馈记录。",
  "layer1.hit_rate": "命中率",
  "layer1.hits_misses": "Hits / Misses",
  "layer1.hits": "次命中",
  "layer1.miss": "次错过",
  "layer1.pending": "待结算",
  "layer1.settled": "已结算",
  "layer1.total_records": "记录总数",

  // Layer 2
  "layer2.title": "Layer 2：Security 检测器",
  "layer2.precision": "Precision",
  "layer2.expiration_rate": "expirationRate",
  "layer2.effective_sample_rate": "effectiveSampleRate",
  "layer2.confirmed_fp_pending": "confirmed / fp / pending",
  "layer2.unreliable_warning": " ⚠ 数据不可信（过期率过高）",

  // Layer 3
  "layer3.title": "Layer 3：参数优化器（Monte Carlo + walk-forward CV）",
  "layer3.current_weights": "当前权重：",
  "layer3.btn_running": "正在跑 500 次迭代…",
  "layer3.btn_idle": "立即调优（500 次迭代）",
  "layer3.tuning_result": "调优结果",
  "layer3.overfit_warning":
    "Overfit / 无效：测试集得分远低于训练集，参数不会自动应用。",
  "layer3.train_val_test": "Train / Val / Test",
  "layer3.sample_count": "样本数",
  "layer3.baseline_label": "Baseline（默认参数）测试集得分：",
  "layer3.baseline_delta": "调优后的 delta：",
  "layer3.iqr_prefix": "（top-5% IQR：",

  // Layer 4
  "layer4.title": "Layer 4：HITL 桥接",
  "layer4.current_params": "当前参数：",
  "layer4.hitl_explainer":
    "HITL（Human-in-the-loop）门控：参数变更必须用户显式确认。优化器只 ",
  "layer4.suggests": "建议",
  "layer4.never_auto":
    "，永远不会自动应用。",
  "layer4.run_tune_first":
    '请先在 Layer 3 点 "立即调优" 生成建议。',
  "layer4.suggestion_blocked":
    "建议被拦截：调优结果未通过验证（overfit 或参数非法）。请扩大数据窗口后重试。",
  "layer4.btn_apply": "应用建议参数（HITL）",
  "layer4.persists_note": "写入 localStorage 后刷新页面。",

  // Invariants
  "inv.title": "系统不变量（System Invariants）",
  "inv.no_future_leak": "no-future-leak（无前瞻泄漏）：{n} 处违反 / {total} 条记录",
  "inv.idempotent": "idempotent-settle（结算幂等）：{n} 次重复结算 / {total} 条记录",
  "inv.hitl": "HITL：由代码强制（setSuggestionParams 不存在自动应用路径）",
  "inv.read_only": "read-only-suggestions：由代码强制（suggestSecurityThresholds 是纯函数）",
  "inv.tests_prefix": "测试覆盖：",
  "inv.tests_suffix": " — 共 803+ 个测试用例验证这些不变量。",
};

const EN: Dict = {
  "header.title": "Closed-Loop Dashboard",
  "header.subtitle": "4-layer self-learning system · Read-only demo",
  "header.tuning_real": "● Tuning on real data: {points} points across {sources} sources",
  "header.tuning_fallback": "○ Real dataset not loaded — using localStorage fallback",
  "header.proxy_disclaimer":
    "TKNA/TKNB are testnet-only tokens with no real price feed. We use XLM/USDC (Stellar Horizon mainnet) and XLM/USD (CoinGecko/Binance/Kraken) as a behavioral proxy. The volatility profile differs from a realistic AMM token pair; tuning results are illustrative not production-grade.",

  "header.btn.load_demo": "Load Demo Data",
  "header.btn.clear_demo": "Clear Demo Data",
  "header.btn.tune_now": "Tune Now",
  "header.btn.tuning": "Tuning…",
  "header.btn.back": "← Back",
  "header.btn.locale_zh": "中",
  "header.btn.locale_en": "EN",

  "empty.title": "No data yet",
  "empty.body":
    'This dashboard visualizes a 4-layer data closed-loop. To see it populated, click "Load Demo Data" above.',
  "empty.or_visit": "Or visit",
  "empty.to_generate": "to interact with the system and generate real data.",

  "layer1.title": "Layer 1: Alert Feedback",
  "layer1.empty": "No feedback records yet.",
  "layer1.hit_rate": "Hit rate",
  "layer1.hits_misses": "Hits / Misses",
  "layer1.hits": "hits",
  "layer1.miss": "miss",
  "layer1.pending": "Pending",
  "layer1.settled": "Settled",
  "layer1.total_records": "Total records",

  "layer2.title": "Layer 2: Security Detectors",
  "layer2.precision": "Precision",
  "layer2.expiration_rate": "expirationRate",
  "layer2.effective_sample_rate": "effectiveSampleRate",
  "layer2.confirmed_fp_pending": "confirmed / fp / pending",
  "layer2.unreliable_warning": " ⚠ data unreliable due to high expiration",

  "layer3.title": "Layer 3: Parameter Optimizer",
  "layer3.current_weights": "Current weights:",
  "layer3.btn_running": "Running 500 iterations…",
  "layer3.btn_idle": "Tune Now (500 iterations)",
  "layer3.tuning_result": "Tuning result",
  "layer3.overfit_warning":
    "Overfit / invalid: test score significantly below train. Params not auto-applied.",
  "layer3.train_val_test": "Train / Val / Test",
  "layer3.sample_count": "Sample count",
  "layer3.baseline_label": "Baseline (default params) test score:",
  "layer3.baseline_delta": "Tuned delta:",
  "layer3.iqr_prefix": " (top-5% IQR: ",

  "layer4.title": "Layer 4: HITL Bridge",
  "layer4.current_params": "Current params:",
  "layer4.hitl_explainer":
    "Human-in-the-loop gate: parameter changes require explicit user confirmation. The optimizer only ",
  "layer4.suggests": "suggests",
  "layer4.never_auto": " — it never auto-applies.",
  "layer4.run_tune_first": 'Run "Tune Now" in Layer 3 to generate a suggestion.',
  "layer4.suggestion_blocked":
    "Suggestion blocked: tuning did not succeed (overfit or invalid params). Expand data window and retry.",
  "layer4.btn_apply": "Apply Suggested Params (HITL)",
  "layer4.persists_note": "Persists to localStorage and reloads the page.",

  "inv.title": "System Invariants",
  "inv.no_future_leak": "no-future-leak: {n} violations in {total} records",
  "inv.idempotent": "idempotent-settle: {n} double-settles in {total} records",
  "inv.hitl": "HITL: enforced by code design (no auto-apply path in setSuggestionParams)",
  "inv.read_only":
    "read-only-suggestions: enforced by code design (suggestSecurityThresholds is pure)",
  "inv.tests_prefix": "Tests: ",
  "inv.tests_suffix": " — 803+ tests verify these invariants.",
};

const DICTS: Record<Locale, Dict> = { zh: ZH, en: EN };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

// ── Locale store (useSyncExternalStore — no setState-in-effect) ──────────────

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Locale {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // ignore
  }
  return "zh";
}

// Server-side fallback. Default to zh on SSR — the snapshot will mismatch
// briefly on hydration if the user has 'en' saved, then resync. Acceptable
// for a settings preference (no flash of English content for default zh users).
function getServerSnapshot(): Locale {
  return "zh";
}

function notify(): void {
  listeners.forEach((cb) => cb());
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setAndPersist = useCallback((next: Locale) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
    notify();
  }, []);

  const toggle = useCallback(() => {
    setAndPersist(locale === "zh" ? "en" : "zh");
  }, [locale, setAndPersist]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const dict = DICTS[locale];
      const template = dict[key] ?? key;
      return interpolate(template, vars);
    },
    [locale]
  );

  return { locale, t, toggle, setLocale: setAndPersist };
}
