# Security Agent Backtest Report

Generated: 2026-05-10T03:13:35.891Z

## Summary

- **Scenarios**: 8
- **Detector evaluations**: 14
- **Exact match rate**: 14/14 = 100.0%
- **Overall precision**: 100.0%
- **Overall recall**: 100.0%
- **Overall F1**: 100.0%

## Per-Detector Metrics

| Detector | Evals | Precision | Recall | F1 | TP | FP | FN | TN |
|----------|-------|-----------|--------|-----|----|----|----|----|
| priceImpact | 2 | 100.0% | 100.0% | 100.0% | 1 | 0 | 0 | 1 |
| liquidityFlow | 4 | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 2 |
| anomaly | 4 | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 2 |
| sandwich | 4 | 100.0% | 100.0% | 100.0% | 2 | 0 | 0 | 2 |

## Scenario Results

| Scenario | Category | Price Impact | Liquidity Flow | Anomaly | Sandwich |
|----------|----------|--------------|----------------|---------|----------|
| S01_normal_trading — Normal light trading | normal | ✓ low / low | ✓ low / low | ✓ low / low | ✓ low / low |
| S02_whale_price_impact — Whale swap causing high price impact | attack | ✓ high / high | — | — | — |
| S03_sandwich_attack — Classic sandwich attack | attack | — | — | — | ✓ medium / medium |
| S04_multi_sandwich — Multiple sandwich attacks in a session | attack | — | — | — | ✓ high / high |
| S05_liquidity_drain — Whale drains >20% of liquidity | attack | — | ✓ high / high | ✓ medium / medium | — |
| S06_moderate_outflow — Moderate outflow (10%) | edge | — | ✓ medium / medium | ✓ medium / medium | — |
| S07_scattered_small_removals — Many small removals by different users | normal | — | ✓ low / low | ✓ low / low | — |
| S08_false_positive_guard — Same user two same-direction swaps — NOT a sandwich | edge | — | — | — | ✓ low / low |

## Scenario Details

### S01_normal_trading — Normal light trading

> A few small swaps from different users, no liquidity removals.

- Category: **normal**
- Events: 3, Reserves: 100000 / 100000
- Probe swap: 100 TKNA

- ✓ **priceImpact** — expected: `low`, actual: `low`
  - priceImpactPct: 0.399
- ✓ **liquidityFlow** — expected: `low`, actual: `low`
  - outflowPct: 0.00
- ✓ **anomaly** — expected: `low`, actual: `low`
  - flaggedCount: 0
  - jaccard: 1.00
  - missed: []
  - extra: []
- ✓ **sandwich** — expected: `low`, actual: `low`
  - hitCount: 0
  - jaccard: 1.00
  - missed: []
  - extra: []

### S02_whale_price_impact — Whale swap causing high price impact

> A single user attempts to swap 20% of reserves — expect HIGH price impact.

- Category: **attack**
- Events: 0, Reserves: 100000 / 100000
- Probe swap: 20000 TKNA

- ✓ **priceImpact** — expected: `high`, actual: `high`
  - priceImpactPct: 16.875

### S03_sandwich_attack — Classic sandwich attack

> Attacker buys TKNA before a victim's TKNA buy, then sells TKNA right after.

- Category: **attack**
- Events: 3, Reserves: 100000 / 100000

- ✓ **sandwich** — expected: `medium`, actual: `medium`
  - hitCount: 1
  - jaccard: 1.00
  - missed: []
  - extra: []

### S04_multi_sandwich — Multiple sandwich attacks in a session

> Attacker performs 2 sandwich attacks within the recent window.

- Category: **attack**
- Events: 6, Reserves: 100000 / 100000

- ✓ **sandwich** — expected: `high`, actual: `high`
  - hitCount: 2
  - jaccard: 1.00
  - missed: []
  - extra: []

### S05_liquidity_drain — Whale drains >20% of liquidity

> A whale removes a huge chunk of liquidity in recent window — expect HIGH outflow + flagged address.

- Category: **attack**
- Events: 1, Reserves: 100000 / 100000

- ✓ **liquidityFlow** — expected: `high`, actual: `high`
  - outflowPct: 25.00
- ✓ **anomaly** — expected: `medium`, actual: `medium`
  - flaggedCount: 1
  - jaccard: 1.00
  - missed: []
  - extra: []

### S06_moderate_outflow — Moderate outflow (10%)

> Single LP removes ~10% — borderline case, expect MEDIUM outflow.

- Category: **edge**
- Events: 1, Reserves: 100000 / 100000

- ✓ **liquidityFlow** — expected: `medium`, actual: `medium`
  - outflowPct: 10.00
- ✓ **anomaly** — expected: `medium`, actual: `medium`
  - flaggedCount: 1
  - jaccard: 1.00
  - missed: []
  - extra: []

### S07_scattered_small_removals — Many small removals by different users

> No single address removes > 5%; each removes 1-2% of reserves.

- Category: **normal**
- Events: 3, Reserves: 100000 / 100000

- ✓ **liquidityFlow** — expected: `low`, actual: `low`
  - outflowPct: 4.50
- ✓ **anomaly** — expected: `low`, actual: `low`
  - flaggedCount: 0
  - jaccard: 1.00
  - missed: []
  - extra: []

### S08_false_positive_guard — Same user two same-direction swaps — NOT a sandwich

> User buys TKNA twice in a row. Should NOT be flagged as sandwich (no opposite leg).

- Category: **edge**
- Events: 3, Reserves: 100000 / 100000

- ✓ **sandwich** — expected: `low`, actual: `low`
  - hitCount: 0
  - jaccard: 1.00
  - missed: []
  - extra: []

---

**Methodology**: Each scenario is a hand-labeled event sequence. Detectors run as pure functions against the events + reserves. A detector passes if `actual === expected` and flagged address sets match. "Positive" = medium or high risk.