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

**Status:** Known. The current limiter is "better than nothing" — it does block within-instance bursts and slow down obvious abuse — but isn't an actual production rate limit. The 429 response message is honest about it being a "demo rate limit".

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

## What we don't claim

To be explicit about scope:

- **Not a quant trading system.** This is an agent-architecture demo with closed-loop self-tuning as the centerpiece. Anyone using these parameters to trade real money would be misusing the project.
- **Not production-ready as deployed on Vercel.** L3 (rate limiter), L4 (localStorage), and L5 (proxy asset) all need fixing before real users.
- **Not a sandwich detector you'd run on mainnet.** L2 — the detector logic is correct, but it's been validated against synthetic and proxy data only.

The architecture, invariants, and data-flow design are the contributions worth discussing. The numerical results are illustrative.
