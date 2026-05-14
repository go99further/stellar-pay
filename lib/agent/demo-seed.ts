/**
 * Demo Data Seeder — Vercel demo closed-loop dashboard population
 *
 * Seeds realistic pre-baked records into all four localStorage stores so
 * visitors with empty storage immediately see populated stats instead of zeros.
 *
 * Design constraints:
 * - All timestamps are FIXED offsets from Date.now() at call time — same
 *   relative spacing every call, deterministic counts.
 * - No imports from the storage modules' internal helpers; we write directly
 *   to localStorage using the same keys those modules read from.
 * - A marker key lets isDemoDataPresent() detect seeded state cheaply.
 */

import type { FeedbackRecord } from "./alert-feedback";
import type { SecurityFeedbackRecord } from "./security-feedback";
import type { TransactionRecord } from "./transaction-history";
import type { PriceAlert } from "./price-alerts";

// ── Storage keys (must match the source modules exactly) ─────────────────────

const KEY_ALERT_FEEDBACK = "stellar-pay-alert-feedback";
const KEY_SECURITY_FEEDBACK = "stellar-pay-security-feedback";
const KEY_TRANSACTION_HISTORY = "stellar-pay-transaction-history";
const KEY_PRICE_ALERTS = "stellar-pay-price-alerts";
const KEY_DEMO_MARKER = "stellar-pay-demo-seeded";

// ── Public types ──────────────────────────────────────────────────────────────

export interface SeedSummary {
  alertRecords: number;
  securityRecords: number;
  transactions: number;
  priceAlerts: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function seedDemoData(): SeedSummary {
  const now = Date.now();

  const alertRecords = buildAlertFeedback(now);
  const securityRecords = buildSecurityFeedback(now);
  const transactions = buildTransactionHistory(now);
  const priceAlerts = buildPriceAlerts(now);

  localStorage.setItem(KEY_ALERT_FEEDBACK, JSON.stringify(alertRecords));
  localStorage.setItem(KEY_SECURITY_FEEDBACK, JSON.stringify(securityRecords));
  localStorage.setItem(KEY_TRANSACTION_HISTORY, JSON.stringify(transactions));
  localStorage.setItem(KEY_PRICE_ALERTS, JSON.stringify(priceAlerts));
  localStorage.setItem(KEY_DEMO_MARKER, "true");

  return {
    alertRecords: alertRecords.length,
    securityRecords: securityRecords.length,
    transactions: transactions.length,
    priceAlerts: priceAlerts.length,
  };
}

export function clearDemoData(): SeedSummary {
  localStorage.removeItem(KEY_ALERT_FEEDBACK);
  localStorage.removeItem(KEY_SECURITY_FEEDBACK);
  localStorage.removeItem(KEY_TRANSACTION_HISTORY);
  localStorage.removeItem(KEY_PRICE_ALERTS);
  localStorage.removeItem(KEY_DEMO_MARKER);

  return { alertRecords: 0, securityRecords: 0, transactions: 0, priceAlerts: 0 };
}

export function isDemoDataPresent(): boolean {
  try {
    return localStorage.getItem(KEY_DEMO_MARKER) === "true";
  } catch {
    return false;
  }
}

// ── Alert-feedback builder ────────────────────────────────────────────────────
// 14 records: 9 hit, 3 miss, 2 pending
// hitRate = 9/12 = 75%, confidence = high (12 settled >= 5)

function buildAlertFeedback(now: number): FeedbackRecord[] {
  // Triggers spaced 15 minutes apart going back ~3.5 hours
  // Settlement is 90 seconds after trigger (realistic "next price tick")
  const MIN = 60_000;
  const SETTLE_DELAY = 90_000; // 1.5 min

  const alertId = "demo-alert-001";

  // Helper: above-condition record (targetPrice 1.02, triggerPrice 1.03 → hit when settledPrice >= triggerPrice)
  const makeHit = (offsetMs: number): FeedbackRecord => {
    const triggeredAt = now - offsetMs;
    return {
      id: `fb_demo_hit_${offsetMs}`,
      alertId,
      tokenPair: "TKNA/TKNB",
      condition: "above",
      targetPrice: 1.02,
      triggerPrice: 1.03,
      triggeredAt,
      outcome: "hit",
      settledAt: triggeredAt + SETTLE_DELAY,
      settledPrice: 1.031 + (offsetMs % 7) * 0.001,
    };
  };

  const makeMiss = (offsetMs: number): FeedbackRecord => {
    const triggeredAt = now - offsetMs;
    return {
      id: `fb_demo_miss_${offsetMs}`,
      alertId,
      tokenPair: "TKNA/TKNB",
      condition: "above",
      targetPrice: 1.02,
      triggerPrice: 1.03,
      triggeredAt,
      outcome: "miss",
      settledAt: triggeredAt + SETTLE_DELAY,
      settledPrice: 1.018 - (offsetMs % 3) * 0.001,
    };
  };

  const makePending = (offsetMs: number): FeedbackRecord => ({
    id: `fb_demo_pending_${offsetMs}`,
    alertId,
    tokenPair: "TKNA/TKNB",
    condition: "above",
    targetPrice: 1.02,
    triggerPrice: 1.03,
    triggeredAt: now - offsetMs,
    outcome: "pending",
  });

  return [
    // 9 hits — spaced 15-30 min apart
    makeHit(30 * MIN),
    makeHit(45 * MIN),
    makeHit(60 * MIN),
    makeHit(80 * MIN),
    makeHit(100 * MIN),
    makeHit(120 * MIN),
    makeHit(150 * MIN),
    makeHit(180 * MIN),
    makeHit(210 * MIN),
    // 3 misses
    makeMiss(240 * MIN),
    makeMiss(270 * MIN),
    makeMiss(300 * MIN),
    // 2 pending (recent — no settle yet)
    makePending(5 * MIN),
    makePending(12 * MIN),
  ];
}

// ── Security-feedback builder ─────────────────────────────────────────────────
// 18 records:
//   price_impact:   6 confirmed, 1 false_positive, 1 expired  → precision 86%, expirationRate 12.5%
//   liquidity_flow: 4 confirmed, 2 false_positive, 1 pending  → precision 67%
//   sandwich:       2 confirmed, 1 pending                    → precision 100%

function buildSecurityFeedback(now: number): SecurityFeedbackRecord[] {
  const MIN = 60_000;
  const HOUR = 3_600_000;

  const records: SecurityFeedbackRecord[] = [];

  // ── price_impact ────────────────────────────────────────────────────────────
  const piConfirmedData: Array<{ impactPct: number; amountIn: string; rA: string; rB: string }> = [
    { impactPct: 1.2, amountIn: "5000000000", rA: "100000000000", rB: "102000000000" },
    { impactPct: 2.1, amountIn: "8500000000", rA: "98000000000",  rB: "100500000000" },
    { impactPct: 3.4, amountIn: "12000000000", rA: "95000000000", rB: "97800000000" },
    { impactPct: 1.8, amountIn: "6200000000", rA: "101000000000", rB: "103200000000" },
    { impactPct: 4.2, amountIn: "15000000000", rA: "92000000000", rB: "94500000000" },
    { impactPct: 2.7, amountIn: "9800000000", rA: "99000000000",  rB: "101300000000" },
  ];

  piConfirmedData.forEach((d, i) => {
    const triggeredAt = now - (20 + i * 25) * MIN;
    records.push({
      id: `sfb_demo_pi_conf_${i}`,
      detectorType: "price_impact",
      triggeredAt,
      riskLevel: "medium",
      triggerContext: {
        predictedImpactPct: d.impactPct,
        amountIn: d.amountIn,
        tokenIn: "TKNA",
        reserveAAtTrigger: d.rA,
        reserveBAtTrigger: d.rB,
      },
      outcome: "confirmed",
      settledAt: triggeredAt + 2 * MIN,
      settlementEvidence: {
        actualImpactPct: d.impactPct * (1 + 0.05 * (i % 3 === 0 ? 1 : -1)),
        predictedImpactPct: d.impactPct,
        relativeError: 0.05,
      },
    });
  });

  // 1 false_positive
  const fpTriggeredAt = now - 180 * MIN;
  records.push({
    id: "sfb_demo_pi_fp_0",
    detectorType: "price_impact",
    triggeredAt: fpTriggeredAt,
    riskLevel: "medium",
    triggerContext: {
      predictedImpactPct: 4.8,
      amountIn: "18000000000",
      tokenIn: "TKNA",
      reserveAAtTrigger: "88000000000",
      reserveBAtTrigger: "90000000000",
    },
    outcome: "false_positive",
    settledAt: fpTriggeredAt + 2 * MIN,
    settlementEvidence: { actualImpactPct: 1.1, predictedImpactPct: 4.8, relativeError: 0.77 },
  });

  // 1 expired
  const expTriggeredAt = now - 26 * HOUR;
  records.push({
    id: "sfb_demo_pi_exp_0",
    detectorType: "price_impact",
    triggeredAt: expTriggeredAt,
    riskLevel: "medium",
    triggerContext: {
      predictedImpactPct: 3.1,
      amountIn: "11000000000",
      tokenIn: "TKNB",
      reserveAAtTrigger: "96000000000",
      reserveBAtTrigger: "98500000000",
    },
    outcome: "expired",
    settledAt: expTriggeredAt + 24 * HOUR,
  });

  // ── liquidity_flow ──────────────────────────────────────────────────────────
  // 4 confirmed: post-trigger TVL is 5-15% lower than tvlAtTrigger
  const lfConfirmedData = [
    { outflowPct: 12, tvl: 10000, rA: "50000000000", rB: "50000000000" },
    { outflowPct: 18, tvl: 9500,  rA: "47500000000", rB: "47500000000" },
    { outflowPct: 8,  tvl: 11200, rA: "56000000000", rB: "56000000000" },
    { outflowPct: 22, tvl: 8800,  rA: "44000000000", rB: "44000000000" },
  ];

  lfConfirmedData.forEach((d, i) => {
    const triggeredAt = now - (3 + i * 1.5) * HOUR;
    records.push({
      id: `sfb_demo_lf_conf_${i}`,
      detectorType: "liquidity_flow",
      triggeredAt,
      riskLevel: "high",
      triggerContext: {
        outflowPct: d.outflowPct,
        reserveAAtTrigger: d.rA,
        reserveBAtTrigger: d.rB,
        tvlAtTrigger: d.tvl,
      },
      outcome: "confirmed",
      settledAt: triggeredAt + 1.5 * HOUR,
      settlementEvidence: {
        currentReserveA: Number(d.rA) * 0.91,
        currentReserveB: Number(d.rB) * 0.91,
        currentTvl: d.tvl * 0.91,
        tvlAtTrigger: d.tvl,
      },
    });
  });

  // 2 false_positives
  [
    { outflowPct: 6, tvl: 12000, rA: "60000000000", rB: "60000000000", offset: 8 },
    { outflowPct: 7, tvl: 11500, rA: "57500000000", rB: "57500000000", offset: 10 },
  ].forEach((d, i) => {
    const triggeredAt = now - d.offset * HOUR;
    records.push({
      id: `sfb_demo_lf_fp_${i}`,
      detectorType: "liquidity_flow",
      triggeredAt,
      riskLevel: "medium",
      triggerContext: {
        outflowPct: d.outflowPct,
        reserveAAtTrigger: d.rA,
        reserveBAtTrigger: d.rB,
        tvlAtTrigger: d.tvl,
      },
      outcome: "false_positive",
      settledAt: triggeredAt + 1.5 * HOUR,
      settlementEvidence: {
        currentReserveA: Number(d.rA) * 0.98,
        currentReserveB: Number(d.rB) * 0.98,
        currentTvl: d.tvl * 0.98,
        tvlAtTrigger: d.tvl,
      },
    });
  });

  // 1 pending
  records.push({
    id: "sfb_demo_lf_pending_0",
    detectorType: "liquidity_flow",
    triggeredAt: now - 20 * MIN,
    riskLevel: "medium",
    triggerContext: {
      outflowPct: 9,
      reserveAAtTrigger: "52000000000",
      reserveBAtTrigger: "52000000000",
      tvlAtTrigger: 10400,
    },
    outcome: "pending",
  });

  // ── sandwich ────────────────────────────────────────────────────────────────
  const suspectAddresses = [
    "GABCXYZ1DEMO2STELLAR3SANDWICH4DETECTOR5ADDR6AAAAAAAAAA",
    "GBBBXYZ2DEMO3STELLAR4SANDWICH5DETECTOR6ADDR7AAAAAAAAAA",
    "GCCCXYZ3DEMO4STELLAR5SANDWICH6DETECTOR7ADDR8AAAAAAAAAA",
  ];

  // 2 confirmed
  [
    { addr: suspectAddresses[0], frontRun: 45120100, observed: 45120108, offset: 2 },
    { addr: suspectAddresses[1], frontRun: 45118500, observed: 45118512, offset: 4 },
  ].forEach((d, i) => {
    const triggeredAt = now - d.offset * HOUR;
    records.push({
      id: `sfb_demo_sw_conf_${i}`,
      detectorType: "sandwich",
      triggeredAt,
      riskLevel: "high",
      triggerContext: {
        suspectAddress: d.addr,
        frontRunLedger: d.frontRun,
        observedAtLedger: d.observed,
      },
      outcome: "confirmed",
      settledAt: triggeredAt + 30 * MIN,
      settlementEvidence: {
        currentLedger: d.observed + 20,
        suspectAddress: d.addr,
        hasRoundTrip: true,
        swapsChecked: 4,
      },
    });
  });

  // 1 pending
  records.push({
    id: "sfb_demo_sw_pending_0",
    detectorType: "sandwich",
    triggeredAt: now - 15 * MIN,
    riskLevel: "high",
    triggerContext: {
      suspectAddress: suspectAddresses[2],
      frontRunLedger: 45125300,
      observedAtLedger: 45125308,
    },
    outcome: "pending",
  });

  return records;
}

// ── Transaction-history builder ───────────────────────────────────────────────
// 20 successful TKNA/TKNB swaps over the last 7 days
// Price oscillates 0.95-1.05 with a slight upward trend

function buildTransactionHistory(now: number): TransactionRecord[] {
  const DAY = 86_400_000;
  const records: TransactionRecord[] = [];

  // 20 swaps spread over 7 days (one every ~8.4 hours)
  for (let i = 0; i < 20; i++) {
    const offsetMs = ((7 * DAY) / 20) * (20 - i); // oldest first → newest last
    const timestamp = now - offsetMs;

    // Price oscillates 0.95-1.05 with slight upward trend
    const phase = (i / 20) * 2 * Math.PI * 2.5; // 2.5 full cycles
    const trend = 0.95 + (i / 19) * 0.05; // 0.95 → 1.00 linear trend
    const oscillation = 0.05 * Math.sin(phase);
    const price = parseFloat((trend + oscillation).toFixed(4));

    // Amount in 50-500 range (realistic swap sizes)
    const amountIn = 50 + ((i * 47 + 13) % 451); // deterministic pseudo-spread
    const amountOut = parseFloat((amountIn * price).toFixed(4));

    records.push({
      id: `demo_tx_${i}`,
      type: "swap",
      timestamp,
      details: {
        amountIn,
        amountOut,
        tokenIn: "TKNA",
        tokenOut: "TKNB",
        price,
        tokenPair: "TKNA/TKNB",
      },
      txHash: `demo${i.toString().padStart(3, "0")}aaabbbccc111222333444555666777888999000`,
      status: "success",
    });
  }

  // Return newest first (matches transaction-history module convention)
  return records.reverse();
}

// ── Price-alerts builder ──────────────────────────────────────────────────────
// 4 alerts: 2 active, 2 triggered

function buildPriceAlerts(now: number): PriceAlert[] {
  const HOUR = 3_600_000;

  return [
    // Active: above 1.05
    {
      id: "demo-alert-001",
      tokenPair: "TKNA/TKNB",
      targetPrice: 1.05,
      condition: "above",
      createdAt: now - 48 * HOUR,
      triggered: false,
    },
    // Active: below 0.95
    {
      id: "demo-alert-002",
      tokenPair: "TKNA/TKNB",
      targetPrice: 0.95,
      condition: "below",
      createdAt: now - 36 * HOUR,
      triggered: false,
    },
    // Triggered: above 1.03 (fired ~5 hours ago)
    {
      id: "demo-alert-003",
      tokenPair: "TKNA/TKNB",
      targetPrice: 1.03,
      condition: "above",
      createdAt: now - 72 * HOUR,
      triggered: true,
      triggeredAt: now - 5 * HOUR,
    },
    // Triggered: below 0.97 (fired ~12 hours ago)
    {
      id: "demo-alert-004",
      tokenPair: "TKNA/TKNB",
      targetPrice: 0.97,
      condition: "below",
      createdAt: now - 96 * HOUR,
      triggered: true,
      triggeredAt: now - 12 * HOUR,
    },
  ];
}
