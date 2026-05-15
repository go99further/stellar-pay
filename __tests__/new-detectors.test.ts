import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  recordSecurityTrigger,
  settleAnomalyByFollowup,
  settleByReservesChange,
  getSecurityStats,
  clearSecurityFeedback,
  type AnomalyContext,
  type StalePriceContext,
  type ImbalanceContext,
} from "../lib/agent/security-feedback";
import {
  detectStalePrice,
  detectImbalance,
  detectAnomalies,
} from "../lib/agent/security-core";
import {
  clearActiveThresholds,
  setActiveThresholds,
  DEFAULT_ACTIVE_THRESHOLDS,
} from "../lib/agent/security-thresholds-runtime";

function makeRemLiq(provider: string, ledger: number, amountA: bigint) {
  return { kind: "rem_liq" as const, ledger, provider, amountA, amountB: 0n, lpAmount: 0n };
}

describe("detectStalePrice", () => {
  afterEach(() => clearActiveThresholds());

  it("returns low risk with < 3 snapshots", () => {
    const r = detectStalePrice([
      { reserveA: 1000n, reserveB: 1000n, ledger: 1 },
      { reserveA: 1001n, reserveB: 1000n, ledger: 2 },
    ]);
    expect(r.riskLevel).toBe("low");
    expect(r.isStale).toBe(false);
  });

  it("detects stale price when ratio is constant", () => {
    const snap = [
      { reserveA: 1000n, reserveB: 1000n, ledger: 1 },
      { reserveA: 1000n, reserveB: 1000n, ledger: 2 },
      { reserveA: 1000n, reserveB: 1000n, ledger: 3 },
    ];
    const r = detectStalePrice(snap);
    expect(r.isStale).toBe(true);
    expect(r.riskLevel).toBe("medium");
    expect(r.staleSinceLedger).toBe(1);
  });

  it("returns low risk when price is actively changing", () => {
    const snap = [
      { reserveA: 1000n, reserveB: 1000n, ledger: 1 },
      { reserveA: 1100n, reserveB: 1000n, ledger: 2 },
      { reserveA: 1200n, reserveB: 1000n, ledger: 3 },
    ];
    const r = detectStalePrice(snap);
    expect(r.isStale).toBe(false);
    expect(r.riskLevel).toBe("low");
  });

  it("respects runtime threshold override", () => {
    setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, stalePriceTolerancePct: 20 });
    // 30% change — exceeds the 20% tolerance, so NOT stale
    const snap = [
      { reserveA: 1000n, reserveB: 1000n, ledger: 1 },
      { reserveA: 1150n, reserveB: 1000n, ledger: 2 },
      { reserveA: 1300n, reserveB: 1000n, ledger: 3 },
    ];
    const r = detectStalePrice(snap);
    expect(r.isStale).toBe(false);
  });
});

describe("detectImbalance", () => {
  afterEach(() => clearActiveThresholds());

  it("returns low risk for balanced pool", () => {
    const r = detectImbalance(1000n, 1000n);
    expect(r.riskLevel).toBe("low");
    expect(r.imbalanceRatio).toBeCloseTo(1.0);
  });

  it("returns medium risk at 4:1 ratio (default medium=3)", () => {
    const r = detectImbalance(4000n, 1000n);
    expect(r.riskLevel).toBe("medium");
    expect(r.imbalanceRatio).toBeCloseTo(4.0);
  });

  it("returns high risk at 15:1 ratio (default high=10)", () => {
    const r = detectImbalance(15000n, 1000n);
    expect(r.riskLevel).toBe("high");
  });

  it("returns low risk when either reserve is 0 (uninitialized pool)", () => {
    expect(detectImbalance(0n, 1000n).riskLevel).toBe("low");
    expect(detectImbalance(1000n, 0n).riskLevel).toBe("low");
  });

  it("respects runtime threshold override", () => {
    setActiveThresholds({ ...DEFAULT_ACTIVE_THRESHOLDS, imbalanceMedium: 2, imbalanceHigh: 5 });
    expect(detectImbalance(3000n, 1000n).riskLevel).toBe("medium");
    expect(detectImbalance(6000n, 1000n).riskLevel).toBe("high");
  });
});

describe("detectAnomalies — existing detector still works", () => {
  it("flags address that removed > 5% of reserves", () => {
    const events = [makeRemLiq("GABC", 100, 60_000n)];
    const r = detectAnomalies(events, 1_000_000n);
    expect(r.flaggedAddresses).toHaveLength(1);
    expect(r.riskLevel).not.toBe("low");
  });

  it("does not flag small removal", () => {
    const events = [makeRemLiq("GABC", 100, 1_000n)];
    const r = detectAnomalies(events, 1_000_000n);
    expect(r.flaggedAddresses).toHaveLength(0);
    expect(r.riskLevel).toBe("low");
  });
});

describe("settleAnomalyByFollowup", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); clearSecurityFeedback(); });

  it("confirms when suspect address has follow-up rem_liq after trigger", () => {
    const ctx: AnomalyContext = {
      suspectAddress: "GABC",
      removalPct: 10,
      reserveAAtTrigger: "1000000",
      observedAtLedger: 100,
    };
    recordSecurityTrigger("anomaly", "medium", ctx, 1_000);
    const events = [makeRemLiq("GABC", 110, 50_000n)]; // ledger 110 > 100
    const settled = settleAnomalyByFollowup(events, 1_000 + 3_600_001);
    expect(settled).toHaveLength(1);
    expect(settled[0].outcome).toBe("confirmed");
  });

  it("marks false_positive when no follow-up activity", () => {
    const ctx: AnomalyContext = {
      suspectAddress: "GABC",
      removalPct: 10,
      reserveAAtTrigger: "1000000",
      observedAtLedger: 100,
    };
    recordSecurityTrigger("anomaly", "medium", ctx, 1_000);
    const settled = settleAnomalyByFollowup([], 1_000 + 3_600_001);
    expect(settled[0].outcome).toBe("false_positive");
  });

  it("does not settle before 1 hour", () => {
    const ctx: AnomalyContext = {
      suspectAddress: "GABC",
      removalPct: 10,
      reserveAAtTrigger: "1000000",
      observedAtLedger: 100,
    };
    recordSecurityTrigger("anomaly", "medium", ctx, 1_000);
    const settled = settleAnomalyByFollowup([], 1_000 + 1_000); // only 1 second later
    expect(settled).toHaveLength(0);
    expect(getSecurityStats("anomaly").pending).toBe(1);
  });

  it("no future-leak: observedAt <= triggeredAt is rejected", () => {
    const ctx: AnomalyContext = {
      suspectAddress: "GABC",
      removalPct: 10,
      reserveAAtTrigger: "1000000",
      observedAtLedger: 100,
    };
    recordSecurityTrigger("anomaly", "medium", ctx, 5_000);
    const settled = settleAnomalyByFollowup([], 5_000); // same time
    expect(settled).toHaveLength(0);
  });
});

describe("settleByReservesChange — stale_price", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); clearSecurityFeedback(); });

  it("confirms stale_price when ratio still flat after 30 min", () => {
    const ctx: StalePriceContext = {
      staleSinceLedger: 50,
      priceRatioAtTrigger: 1.0,
      snapshotCount: 5,
    };
    recordSecurityTrigger("stale_price", "medium", ctx, 1_000);
    // Same ratio → still stale → confirmed
    const settled = settleByReservesChange(1_000_000, 1_000_000, 1_000 + 1_800_001);
    expect(settled.some(r => r.detectorType === "stale_price" && r.outcome === "confirmed")).toBe(true);
  });

  it("marks false_positive when price has resumed movement", () => {
    const ctx: StalePriceContext = {
      staleSinceLedger: 50,
      priceRatioAtTrigger: 1.0,
      snapshotCount: 5,
    };
    recordSecurityTrigger("stale_price", "medium", ctx, 1_000);
    // Ratio changed significantly → price resumed → false_positive
    const settled = settleByReservesChange(1_500_000, 1_000_000, 1_000 + 1_800_001);
    expect(settled.some(r => r.detectorType === "stale_price" && r.outcome === "false_positive")).toBe(true);
  });
});

describe("settleByReservesChange — imbalance", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); clearSecurityFeedback(); });

  it("confirms when imbalance corrected by arbitrage (> 20% improvement)", () => {
    const ctx: ImbalanceContext = {
      imbalanceRatio: 10.0,
      reserveAAtTrigger: "10000000",
      reserveBAtTrigger: "1000000",
    };
    recordSecurityTrigger("imbalance", "high", ctx, 1_000);
    // Now ratio is 2:1 — much better (corrected by > 20%) → confirmed (detector was right)
    const settled = settleByReservesChange(2_000_000, 1_000_000, 1_000 + 1_800_001);
    expect(settled.some(r => r.detectorType === "imbalance" && r.outcome === "confirmed")).toBe(true);
  });

  it("marks false_positive when imbalance persists (structural, not exploitable)", () => {
    const ctx: ImbalanceContext = {
      imbalanceRatio: 10.0,
      reserveAAtTrigger: "10000000",
      reserveBAtTrigger: "1000000",
    };
    recordSecurityTrigger("imbalance", "high", ctx, 1_000);
    // Still 10:1 — no improvement → false_positive (structural, not a real alert)
    const settled = settleByReservesChange(10_000_000, 1_000_000, 1_000 + 1_800_001);
    expect(settled.some(r => r.detectorType === "imbalance" && r.outcome === "false_positive")).toBe(true);
  });

  it("does not settle before 30 minutes", () => {
    const ctx: ImbalanceContext = {
      imbalanceRatio: 10.0,
      reserveAAtTrigger: "10000000",
      reserveBAtTrigger: "1000000",
    };
    recordSecurityTrigger("imbalance", "high", ctx, 1_000);
    const settled = settleByReservesChange(10_000_000, 1_000_000, 1_000 + 60_000); // only 1 min
    expect(settled).toHaveLength(0);
  });
});

describe("getSecurityStats — new detector types", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); clearSecurityFeedback(); });

  it("tracks anomaly stats independently", () => {
    const ctx: AnomalyContext = {
      suspectAddress: "GABC",
      removalPct: 10,
      reserveAAtTrigger: "1000000",
      observedAtLedger: 100,
    };
    recordSecurityTrigger("anomaly", "medium", ctx, 1_000);
    const stats = getSecurityStats("anomaly");
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it("tracks stale_price and imbalance stats independently", () => {
    recordSecurityTrigger("stale_price", "medium", {
      staleSinceLedger: 1, priceRatioAtTrigger: 1.0, snapshotCount: 3,
    }, 1_000);
    recordSecurityTrigger("imbalance", "high", {
      imbalanceRatio: 10, reserveAAtTrigger: "10000", reserveBAtTrigger: "1000",
    }, 1_000);
    expect(getSecurityStats("stale_price").total).toBe(1);
    expect(getSecurityStats("imbalance").total).toBe(1);
    expect(getSecurityStats("sandwich").total).toBe(0); // unaffected
  });
});
