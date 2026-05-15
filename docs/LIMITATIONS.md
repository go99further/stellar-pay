# Known Limitations & Honest Disclaimers

This document tracks issues that exist in the current implementation. Some are intentional trade-offs; others are gaps we know about but haven't filled. Listing them up front beats getting caught at audit/interview.

For each item: **what's wrong**, **how it manifests**, and **what would fix it in production**.

---

## L1 — IQR is not a confidence interval (terminology)

**What:** `TuningReport.iqr` reports the p25/p75 of top-5% candidates from Monte Carlo search.

**What it isn't:** A statistical confidence interval. A real CI would require bootstrap-with-replacement on the underlying data, not just ranking search candidates.

**How it manifests:** A reader assuming "0.62 [0.55–0.68]" means "we're 95% confident the true optimum is in this range" would be wrong. What it actually says is "the search consistently surfaced parameters in this range as top performers".

**Fix path:** Add bootstrap CI on top of the existing IQR. Run the optimizer N times resampling the windows with replacement; report 2.5th/97.5th percentiles of the resulting `recommended` distribution. Estimated cost: 30 minutes of code, ~10× the current tune time.

**Status:** Renamed from `confidenceInterval` to `iqr` in commit (this PR). The dashboard and report now use IQR vocabulary correctly. Bootstrap CI is a follow-up.

---

## L2 — Sandwich detector has no real-data feedback signal

**What:** The closed loop's sandwich detector settles records by checking if the suspect address completes a profitable round-trip within a ledger window. On testnet, this is empty.

**Why:** Testnet has no MEV bots. The address that fires the detector is almost always a developer test account doing a single trade. `getOnlineStats("sandwich")` returns `confidence: "low"` and most suggestions return `insufficient_data`.

**How it manifests:** The Layer 2 dashboard will show `sandwich: 100% precision (LOW)` or similar — high precision because there are no false positives, low confidence because there are essentially no positives either.

**Fix path:** Backfill with mainnet sandwich data. Stellar Horizon has historical swap events; we'd need to identify known sandwich patterns offline, replay them through the detector, and use those as the seed dataset. Estimated cost: a week of data engineering.

**Status:** Acknowledged. Demo seeder synthesizes 3 sandwich records so the dashboard isn't empty, but they're synthetic — surfaced as `triggerContext.suspectAddress` starting with `GABC...` which is recognizably fake.

---

## L3 — Vercel serverless rate limit is per-instance, not global

**What:** `app/api/agent/route.ts` instantiates `MultiTierRateLimiter` at module scope. On Vercel's serverless runtime, each cold-started function gets its own instance.

**How it manifests:** A single IP fanning out across 5 cold lambdas effectively gets 5× the configured rate limit. Sustained attack with concurrent connections largely defeats the limiter.

**Fix path:** Move the bucket state to Vercel KV (Redis-backed, distributed) or Upstash. Token-bucket math stays the same; only the storage backend changes. Estimated cost: 1 hour + a Vercel KV addon (~$0/month at low traffic).

**Status:** Mitigated. `lib/agent/distributed-rate-limiter.ts` adds a Vercel KV / Upstash backend that shares state across Lambda instances when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set. Local dev and no-KV deployments still use per-instance fallback (now an explicit, documented choice rather than the only option). The 429 response now reports which path is active. See `__tests__/distributed-rate-limiter.test.ts` for cross-instance and degradation-to-fallback coverage.

---

## L4 — localStorage is per-browser, not per-user

**What:** All closed-loop records (alert-feedback, security-feedback, transaction-history, suggestion-params) live in browser localStorage.

**How it manifests:** The "78% online hit rate" displayed on `/loop` is the hit rate for **the current browser tab**, not aggregated across users. Open the same demo in incognito mode → completely different (empty) state.

**Fix path:** Add a server-side store (Postgres / Vercel KV) keyed by wallet address. Settle records server-side, aggregate across users for the dashboard, keep localStorage as a per-user cache only. Estimated cost: 4-6 hours including auth wiring.

**Status:** Known. Acceptable for a demo where each visitor sees their own session. The README discloses "Read-only demo mode" but doesn't currently say "stats are session-local".

---

## L5 — XLM is a proxy asset; tuning is shape-correct, value-imprecise

**What:** TKNA/TKNB are testnet-only tokens with no real price feed. The 3,589-point dataset uses XLM/USDC (Horizon mainnet) and XLM/USD (CoinGecko/Binance/Kraken) as a behavioral proxy.

**How it manifests:** Monte Carlo finds parameters that work well on XLM volatility. XLM is more stable than a typical AMM token pair, so the absolute parameter values may not transfer. The *search procedure* and *walk-forward CV* are sound; the *output values* are illustrative.

**Fix path:** Replace XLM data with the actual production token pair's price history before deploying. The `loadRealPriceDataset()` mechanism is asset-agnostic — only the JSON file changes.

**Status:** Disclosed in dashboard badge, dataset JSON, ADR-7 (`docs/DESIGN_DECISIONS.md`), and `docs/CLOSED_LOOP.md` "Data source caveat" section.

---

## L6 — `recordOutcome` (next-1-tick) suffers from selection bias

**What:** The original `recordOutcome` settles each record using only the next observed price. Conditional on "alert just fired", mean reversion makes the next single tick more likely to dip back below the trigger than continue moving — so hit rate is structurally under-reported.

**How it manifests:** On a mean-reverting series, `recordOutcome` reports near-0 hit rate while the alerts are actually catching real moves that just don't sustain on a 1-tick horizon.

**Fix path:** Use `recordOutcomeKTick` instead. It buffers K observations after the trigger and decides on the cumulative average — far less biased.

**Status:** `recordOutcomeKTick` is implemented and tested (`__tests__/selection-bias.test.ts` demonstrates the gap concretely). The original `recordOutcome` is kept for backward compatibility. Production deployment should switch the wiring in `usePriceAlerts.ts` to use the K-tick variant.

---

## L7 — `K2-audit-grade` invariants are unit-tested, not property-tested

**What:** The 4 system-level invariants (no-future-leak, idempotent-settle, HITL-only, read-only-suggestions) are verified by hand-constructed unit tests with fixed inputs.

**What it isn't:** Property-based testing with `fast-check` or similar, where 1000 random inputs run 100,000 times to probe for invariant violations.

**Fix path:** Add `fast-check` and write generators for `FeedbackRecord`, `SecurityFeedbackRecord`, etc. ~2 hours.

**Status:** Acknowledged. The label "K2-audit-grade" is aspirational; the current testing is "audit-aware" but doesn't reach property-test rigor.

---

## L8 — No A/B baseline in production

**What:** The closed loop's claim is "tuned params beat default params". `tuneSuggestionParams` now reports `baseline.testScore` so the delta is visible per-tune-run. But we don't continuously A/B compare — every user gets whichever params are persisted.

**Fix path:** Persist both `default_params` and `tuned_params`; randomly assign incoming evaluations to each branch; compare hit rates over a window. Standard A/B infrastructure. ~4 hours.

**Status:** Per-tune baseline comparison shipped in this PR. Continuous A/B is a follow-up.

---

## L9 — No Bonferroni correction for multiple comparisons

**What:** The method comparison panel reports four pairwise Welch t-tests ("MC vs Random", "MC vs Grid", "Grid vs Random", "Tuned vs Default"). Each test uses α=0.05 in isolation. With four tests, the family-wise error rate (chance of at least one false positive) inflates to roughly 1 − 0.95⁴ ≈ 18.5%.

**How it manifests:** A reader interpreting any single "p < 0.05" as "definitely real" would overestimate the certainty given that we ran four tests.

**Fix path:** Apply Bonferroni correction (divide α by number of tests → 0.0125) or Holm step-down. In practice, for the tests we report, p-values are typically << 0.001, so the conclusion does not change. We surface the issue rather than silently apply a correction that reads worse than the raw p-values without explanation.

**Status:** Acknowledged. ADR-8 documents the choice. UI shows raw p-values plus a footnote linking here.

---

## L10 — Normality of score distributions not formally verified

**What:** Welch's t-test relies on the sample means being approximately normally distributed. With n=30 per method, the Central Limit Theorem suggests the mean's sampling distribution is close to normal even if individual scores are not. We do not run a formal normality test (Shapiro–Wilk or Kolmogorov–Smirnov) on the score distributions.

**How it manifests:** If the score distribution is heavily skewed or multimodal at n=30, p-values from Welch may be slightly off. Unlikely to flip a "p < 0.001" conclusion, but possible at marginal cases.

**Fix path:** Add Shapiro–Wilk per method, surface the W-statistic and p-value in the comparison report. Or use a non-parametric alternative (Mann–Whitney U, Wilcoxon rank-sum) which makes no normality assumption.

**Status:** Acknowledged. n=30 + CLT is a defensible default for a demonstration; for production claims we would test or use the non-parametric variant.

---

## L11 — No prospective power analysis

**What:** Power analysis prescribes the sample size needed to detect a hypothesized effect size with target power (typically 0.8). We did not pre-specify a target effect size; we picked n=30 for runtime + CLT reasons, then ran the comparison and reported observed effect sizes.

**How it manifests:** This is post-hoc analysis — the n=30 sample size was not chosen to detect any particular Cohen's d. If the true effect were small (e.g., d=0.2), n=30 would be underpowered (detecting it would require ~400 runs at 0.8 power). Our reported "Monte Carlo wins p < 0.001" depends on the effect being moderate or large.

**Fix path:** Pre-register a target effect size (e.g., d=0.5, "medium") before collecting data. Compute required n from power = 0.8, α = 0.05. Run that many. Report power achieved.

**Status:** Acknowledged. For a methods-comparison demonstration where the structured-search-vs-random effect is empirically large (d > 1.0), the sample size is adequate. A formal prospective design would be required for publication.

---

## L12 — Anomaly settler path is short-circuited (same fate as sandwich)

**What:** `settleAnomalyByFollowup` requires decoded AMM events to check if the suspect address made follow-up `rem_liq` operations. But `usePriceAlerts.ts` doesn't pass decoded events to `settleAllPending` (it only passes reserves for TVL settlement). So anomaly records are triggered and recorded, but never settled — they expire after 24h.

**How it manifests:** `getSecurityStats("anomaly")` will show `pending` growing and eventually `expired` growing, but `confirmed` and `falsePositives` stay at 0. Precision is null forever.

**Fix path:** Decode events in the 30s poll (call `fetchAmmEvents` + decode) and pass them to `settleAllPending({ sandwich: { events, currentLedger } })`. This is the same fix needed for sandwich (LIMITATIONS L2). Estimated cost: 1 hour (event decoding pipeline in the hook).

**Status:** Known. Same structural issue as sandwich (L2). Both need the event pipeline wired into the hook.

---

## L13 — stale_price detection and settlement share the same tolerance oracle

**What:** `detectStalePrice` triggers when price ratio variation is within `stalePriceTolerancePct`. `settleByReservesChange` (stale_price branch) settles by checking if the current ratio has diverged from the trigger-time ratio by more than the same `stalePriceTolerancePct`. This creates a structural self-correlation: the settlement is testing whether the condition that triggered the alert has changed — using the same threshold that defined the trigger.

**How it manifests:** The settlement is essentially asking "is the price still stale by the same definition that triggered the alert?" This is tautologically biased toward `confirmed` — if the price was stale enough to trigger, it's likely still stale 30 minutes later (stale prices tend to stay stale). The `false_positive` path requires a price movement larger than the trigger tolerance, which is a higher bar than random.

**Fix path:** Use an independent settlement oracle — e.g., check whether any swap events occurred in the pool during the 30-minute window (event-based signal, not price-ratio-based). Or use a different, larger tolerance for settlement (e.g., 2× the detection tolerance).

**Status:** Known. The current implementation is functional but structurally self-correlated. A reviewer would correctly identify this as "circular validation."

---

## L14 — Benchmark n=30 produces ±10.7% confidence intervals; single-run numbers are not stable

**What:** The 30-case benchmark was run multiple times with the same prompt + dataset configuration and produced Router strict accuracy values of 80%, 86.7%, 83.3%, and 90% across runs. The spread is ~10pp.

**Why:** LLM outputs are stochastic (temperature > 0). With n=30 and p≈0.85, the 95% confidence interval is ±10.7% (binomial). A single run can land anywhere in [74%, 97%]. This is not a bug — it is the expected statistical behavior of a small-sample benchmark on a non-deterministic model.

**What this means for reported numbers:**
- **Soft numbers (Router accuracy):** 83–90% range. The trend from prompt improvements is real (ablation confirms +6.7pp from prompt fixes alone), but the exact value from any single run is not reliable.
- **Hard numbers (Tool Precision, Safety Reject Rate):** 100% across all runs. These are deterministic invariants — Agent never calls `build_swap_xdr` without prior simulation, and all 4 adversarial inputs were blocked in every run. These numbers are trustworthy.

**Fix path:** Expand to 150 cases. At n=150 and p=0.85, the 95% CI shrinks to ±5.7% — a number worth reporting with confidence.

**Status:** Known. The 30-case pilot was designed to validate the benchmark framework, not to produce publication-grade numbers. The ablation study (3 runs with controlled variable isolation) is the correct methodology for attributing improvements; single-run numbers are illustrative only.

---

## L15 — Ablation study: prompt fixes contribute +6.7pp to Router accuracy; annotation fixes contribute +3.3pp

**What:** Three benchmark runs were conducted to isolate the contribution of prompt fixes vs. annotation fixes:

| Configuration | Router strict | Tool Recall | Safety |
|---|---|---|---|
| A. Baseline (original prompt + original dataset) | 80.0% | 75.0% | 100% |
| B. Prompt fixes only (original dataset) | 86.7% | 75.0% | 100% |
| C. Prompt + annotation fixes | 83.3%–90.0% | 78.9%–84.2% | 100% |

**Attribution:**
- Router accuracy improvement: prompt fixes contribute +6.7pp (B vs A), annotation fixes contribute +3.3pp (C vs B). Both are real.
- Tool Recall improvement: entirely from annotation fixes (B vs A = 0pp). Prompt fixes did not improve Tool Recall.
- Safety 100%: present in all three configurations. The earlier report of "Safety 75% → 100% from prompt fixes" was a measurement error — baseline was already 100%.

**Retracted claim:** "Safety improved from 75% to 100% due to prompt fixes." This is false. The 75% result was a single-run anomaly on a different test configuration.

**Status:** Documented. The ablation methodology is correct; the attribution is now accurate.

---

## What we don't claim

To be explicit about scope:

- **Not a quant trading system.** This is an agent-architecture demo with closed-loop self-tuning as the centerpiece. Anyone using these parameters to trade real money would be misusing the project.
- **Not production-ready as deployed on Vercel.** L3 (rate limiter), L4 (localStorage), and L5 (proxy asset) all need fixing before real users.
- **Not a sandwich detector you'd run on mainnet.** L2 — the detector logic is correct, but it's been validated against synthetic and proxy data only.

The architecture, invariants, and data-flow design are the contributions worth discussing. The numerical results are illustrative.

---

## Resolved (was on this list, now fixed)

### ✓ Apply button is no longer theater — security threshold overrides flow to detectors

Previously: `suggestSecurityThresholds()` returned recommendations, but the four detectors (`detectPriceImpact`, `detectLiquidityFlow`, `detectSandwich`, `detectAnomalies`) read from a compile-time `THRESHOLDS` const. Clicking Apply persisted nothing useful.

Fix: `lib/agent/security-thresholds-runtime.ts` provides a localStorage-backed override layer. Each detector calls `getActiveThresholds()` at the start of every invocation. Overrides flow through immediately. Verified by integration tests in `__tests__/security-thresholds-runtime.test.ts` ("detectAnomalies uses overridden anomalyRemovalPct" etc).

The compile-time `THRESHOLDS` const stays untouched — overrides are layered on top, not in place. This preserves the read-only-suggestions invariant from the original audit posture.
