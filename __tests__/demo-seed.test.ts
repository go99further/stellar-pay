import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  seedDemoData,
  clearDemoData,
  isDemoDataPresent,
} from "../lib/agent/demo-seed";
import { getOnlineStats } from "../lib/agent/alert-feedback";
import { getSecurityStats } from "../lib/agent/security-feedback";

const KEY_ALERT_FEEDBACK = "stellar-pay-alert-feedback";
const KEY_SECURITY_FEEDBACK = "stellar-pay-security-feedback";
const KEY_TRANSACTION_HISTORY = "stellar-pay-transaction-history";
const KEY_PRICE_ALERTS = "stellar-pay-price-alerts";
const KEY_DEMO_MARKER = "stellar-pay-demo-seeded";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("seedDemoData", () => {
  it("populates all four storage keys", () => {
    seedDemoData();

    expect(localStorage.getItem(KEY_ALERT_FEEDBACK)).not.toBeNull();
    expect(localStorage.getItem(KEY_SECURITY_FEEDBACK)).not.toBeNull();
    expect(localStorage.getItem(KEY_TRANSACTION_HISTORY)).not.toBeNull();
    expect(localStorage.getItem(KEY_PRICE_ALERTS)).not.toBeNull();
  });

  it("produces deterministic counts matching the SeedSummary spec", () => {
    const summary = seedDemoData();

    expect(summary.alertRecords).toBe(14);
    expect(summary.securityRecords).toBe(18);
    expect(summary.transactions).toBe(20);
    expect(summary.priceAlerts).toBe(4);
  });

  it("is idempotent — calling twice yields the same record count", () => {
    const first = seedDemoData();
    const second = seedDemoData();

    expect(second.alertRecords).toBe(first.alertRecords);
    expect(second.securityRecords).toBe(first.securityRecords);
    expect(second.transactions).toBe(first.transactions);
    expect(second.priceAlerts).toBe(first.priceAlerts);
  });

  it("sets the demo marker key", () => {
    seedDemoData();
    expect(localStorage.getItem(KEY_DEMO_MARKER)).toBe("true");
  });
});

describe("isDemoDataPresent", () => {
  it("returns false initially (empty localStorage)", () => {
    expect(isDemoDataPresent()).toBe(false);
  });

  it("returns true after seedDemoData", () => {
    seedDemoData();
    expect(isDemoDataPresent()).toBe(true);
  });
});

describe("clearDemoData", () => {
  it("removes all four storage keys and the marker", () => {
    seedDemoData();
    clearDemoData();

    expect(localStorage.getItem(KEY_ALERT_FEEDBACK)).toBeNull();
    expect(localStorage.getItem(KEY_SECURITY_FEEDBACK)).toBeNull();
    expect(localStorage.getItem(KEY_TRANSACTION_HISTORY)).toBeNull();
    expect(localStorage.getItem(KEY_PRICE_ALERTS)).toBeNull();
    expect(localStorage.getItem(KEY_DEMO_MARKER)).toBeNull();
  });

  it("returns a zero SeedSummary", () => {
    seedDemoData();
    const summary = clearDemoData();

    expect(summary.alertRecords).toBe(0);
    expect(summary.securityRecords).toBe(0);
    expect(summary.transactions).toBe(0);
    expect(summary.priceAlerts).toBe(0);
  });

  it("isDemoDataPresent returns false after clear", () => {
    seedDemoData();
    clearDemoData();
    expect(isDemoDataPresent()).toBe(false);
  });
});

describe("alert-feedback stats from seeded data", () => {
  it("hitRate ≈ 75% and confidence is high for demo-alert-001", () => {
    seedDemoData();

    const stats = getOnlineStats("demo-alert-001");

    // 9 hits, 3 misses, 2 pending → settled = 12, hits = 9
    expect(stats.settled).toBe(12);
    expect(stats.hits).toBe(9);
    expect(stats.misses).toBe(3);
    expect(stats.pending).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.75, 5);
    expect(stats.confidence).toBe("high");
  });
});

describe("security stats from seeded data", () => {
  it("liquidity_flow precision ≈ 67% (4 confirmed / 6 settled), action = tighten", () => {
    seedDemoData();

    const stats = getSecurityStats("liquidity_flow");

    // 4 confirmed, 2 false_positive, 1 pending → settled = 6
    expect(stats.confirmed).toBe(4);
    expect(stats.falsePositives).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.settled).toBe(6);
    // precision = 4/6 ≈ 0.6667
    expect(stats.precision).not.toBeNull();
    expect(stats.precision!).toBeCloseTo(4 / 6, 5);
    expect(stats.confidence).toBe("high");
  });

  it("price_impact precision ≈ 86% (6 confirmed / 7 settled)", () => {
    seedDemoData();

    const stats = getSecurityStats("price_impact");

    // 6 confirmed, 1 false_positive, 1 expired → settled = 8 (expired counts in settled)
    // precision = confirmed / (confirmed + falsePositives) = 6/7
    expect(stats.confirmed).toBe(6);
    expect(stats.falsePositives).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.precision).not.toBeNull();
    expect(stats.precision!).toBeCloseTo(6 / 7, 5);
  });

  it("sandwich precision = 100% (2 confirmed / 2 settled, 1 pending)", () => {
    seedDemoData();

    const stats = getSecurityStats("sandwich");

    expect(stats.confirmed).toBe(2);
    expect(stats.falsePositives).toBe(0);
    expect(stats.pending).toBe(1);
    expect(stats.precision).toBe(1);
  });
});
