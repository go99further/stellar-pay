import { getPriceImpact } from "@/lib/amm-math";

export type RiskLevel = "low" | "medium" | "high";

export type DecodedAmmEvent =
  | {
      kind: "swap";
      ledger: number;
      user: string;
      tokenIn: string;
      amountIn: bigint;
      amountOut: bigint;
    }
  | {
      kind: "add_liq";
      ledger: number;
      provider: string;
      amountA: bigint;
      amountB: bigint;
      lpAmount: bigint;
    }
  | {
      kind: "rem_liq";
      ledger: number;
      provider: string;
      amountA: bigint;
      amountB: bigint;
      lpAmount: bigint;
    };

export const THRESHOLDS = {
  priceImpact: { medium: 1, high: 3 },
  liquidityOutflow: { medium: 5, high: 20 },
  anomalyRemovalPct: 5,
  sandwichWindowLedgers: 3,
} as const;

export function detectPriceImpact(
  amountIn: bigint,
  tokenIn: "TKNA" | "TKNB",
  reserveA: bigint,
  reserveB: bigint
): { priceImpactPct: number; riskLevel: RiskLevel; recommendation: string } {
  const isAtoB = tokenIn === "TKNA";
  const reserveIn = isAtoB ? reserveA : reserveB;
  const reserveOut = isAtoB ? reserveB : reserveA;
  const impact = getPriceImpact(amountIn, reserveIn, reserveOut);
  const riskLevel: RiskLevel =
    impact < THRESHOLDS.priceImpact.medium
      ? "low"
      : impact < THRESHOLDS.priceImpact.high
      ? "medium"
      : "high";
  const recommendation =
    riskLevel === "low"
      ? "Price impact is acceptable."
      : riskLevel === "medium"
      ? "Moderate price impact. Consider splitting into smaller trades."
      : "High price impact (>3%). Strongly recommend splitting this trade to reduce losses.";
  return { priceImpactPct: impact, riskLevel, recommendation };
}

export function detectLiquidityFlow(
  events: DecodedAmmEvent[],
  reserveA: bigint
): {
  netRemoveA: bigint;
  netRemoveB: bigint;
  outflowPct: number;
  riskLevel: RiskLevel;
  recommendation: string;
} {
  let netRemoveA = 0n;
  let netRemoveB = 0n;
  for (const evt of events) {
    if (evt.kind === "rem_liq") {
      netRemoveA += evt.amountA;
      netRemoveB += evt.amountB;
    }
  }
  const outflowPct =
    reserveA > 0n ? (Number(netRemoveA) / Number(reserveA)) * 100 : 0;
  const riskLevel: RiskLevel =
    outflowPct < THRESHOLDS.liquidityOutflow.medium
      ? "low"
      : outflowPct < THRESHOLDS.liquidityOutflow.high
      ? "medium"
      : "high";
  const recommendation =
    riskLevel === "low"
      ? "Liquidity is stable."
      : riskLevel === "medium"
      ? "Moderate liquidity outflow detected. Monitor before large trades."
      : "Significant liquidity outflow (>20% of reserves removed recently). High slippage risk.";
  return { netRemoveA, netRemoveB, outflowPct, riskLevel, recommendation };
}

export interface SandwichHit {
  attacker: string;
  frontRunLedger: number;
  backRunLedger: number;
  tokenIn: string;
  victimCount: number;
}

export function detectSandwich(events: DecodedAmmEvent[]): {
  hits: SandwichHit[];
  riskLevel: RiskLevel;
  summary: string;
} {
  const swaps = events
    .filter((e): e is Extract<DecodedAmmEvent, { kind: "swap" }> => e.kind === "swap")
    .sort((a, b) => a.ledger - b.ledger);

  const hits: SandwichHit[] = [];
  const window = THRESHOLDS.sandwichWindowLedgers;

  for (let i = 0; i < swaps.length; i++) {
    const front = swaps[i];
    for (let j = i + 2; j < swaps.length; j++) {
      const back = swaps[j];
      if (back.ledger - front.ledger > window) break;
      if (back.user !== front.user) continue;
      // Back-run must be opposite direction (sell the token they just bought).
      if (back.tokenIn === front.tokenIn) continue;
      // Victim(s) must trade in the SAME direction as front-run (pushing price further).
      let victims = 0;
      for (let k = i + 1; k < j; k++) {
        const mid = swaps[k];
        if (mid.user === front.user) continue;
        if (mid.tokenIn === front.tokenIn) victims++;
      }
      if (victims >= 1) {
        hits.push({
          attacker: front.user,
          frontRunLedger: front.ledger,
          backRunLedger: back.ledger,
          tokenIn: front.tokenIn,
          victimCount: victims,
        });
        break; // one hit per front-run is enough
      }
    }
  }

  const riskLevel: RiskLevel =
    hits.length === 0 ? "low" : hits.length <= 1 ? "medium" : "high";
  const summary =
    hits.length === 0
      ? "No sandwich patterns detected."
      : `${hits.length} suspected sandwich attack(s) detected.`;
  return { hits, riskLevel, summary };
}

export function detectAnomalies(
  events: DecodedAmmEvent[],
  reserveA: bigint
): {
  flaggedAddresses: { address: string; reason: string }[];
  riskLevel: RiskLevel;
  summary: string;
} {
  const removeByAddress = new Map<string, bigint>();
  for (const evt of events) {
    if (evt.kind === "rem_liq") {
      const prev = removeByAddress.get(evt.provider) ?? 0n;
      removeByAddress.set(evt.provider, prev + evt.amountA);
    }
  }
  const flagged: { address: string; reason: string }[] = [];
  for (const [addr, amount] of removeByAddress.entries()) {
    const pct = reserveA > 0n ? (Number(amount) / Number(reserveA)) * 100 : 0;
    if (pct > THRESHOLDS.anomalyRemovalPct) {
      flagged.push({
        address: addr,
        reason: `Removed ${pct.toFixed(1)}% of pool reserves — potential large exit or sandwich setup`,
      });
    }
  }
  const riskLevel: RiskLevel =
    flagged.length === 0 ? "low" : flagged.length <= 2 ? "medium" : "high";
  const summary =
    flagged.length === 0
      ? "No anomalous activity detected in recent events."
      : `${flagged.length} address(es) flagged for concentrated liquidity removal.`;
  return { flaggedAddresses: flagged, riskLevel, summary };
}
