import type Anthropic from "@anthropic-ai/sdk";
import { getReserves } from "@/lib/amm-contract";
import { fetchAmmEvents } from "@/lib/amm-events";
import { decodeEventTopic, decodeLiquidityEvent, decodeSwapEvent } from "@/lib/event-decoder";
import {
  detectPriceImpact,
  detectLiquidityFlow,
  detectAnomalies,
  type DecodedAmmEvent,
} from "../security-core";
import { recordSecurityTrigger } from "../security-feedback";

const DECIMALS = 7;
const DUMMY_READER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

function formatAmount(raw: bigint): string {
  const str = raw.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, str.length - DECIMALS) || "0";
  const fracPart = str.slice(-DECIMALS).replace(/0+$/, "") || "0";
  return `${intPart}.${fracPart}`;
}

async function loadDecodedEvents(): Promise<DecodedAmmEvent[]> {
  const { events } = await fetchAmmEvents();
  const decoded: DecodedAmmEvent[] = [];
  for (const evt of events) {
    const topic = evt.topic[1] ? decodeEventTopic(evt.topic[1]) : "";
    if (topic === "swap") {
      const s = decodeSwapEvent(evt.value);
      if (s) decoded.push({ kind: "swap", ledger: evt.ledger, ...s });
    } else if (topic === "add_liq") {
      const l = decodeLiquidityEvent(evt.value);
      if (l) decoded.push({ kind: "add_liq", ledger: evt.ledger, ...l });
    } else if (topic === "rem_liq") {
      const l = decodeLiquidityEvent(evt.value);
      if (l) decoded.push({ kind: "rem_liq", ledger: evt.ledger, ...l });
    }
  }
  return decoded;
}

// ── check_price_impact ────────────────────────────────────────────────────────

export const checkPriceImpactSchema: Anthropic.Tool = {
  name: "check_price_impact",
  description:
    "Check the price impact of a potential swap. Returns impact percentage and risk level. Pure math — no RPC call beyond fetching reserves.",
  input_schema: {
    type: "object",
    properties: {
      tokenIn: { type: "string", enum: ["TKNA", "TKNB"] },
      amountIn: { type: "number", description: "Amount to swap (human-readable)." },
    },
    required: ["tokenIn", "amountIn"],
  },
};

export async function checkPriceImpactHandler(input: {
  tokenIn: "TKNA" | "TKNB";
  amountIn: number;
}): Promise<{
  priceImpactPct: string;
  riskLevel: "low" | "medium" | "high";
  recommendation: string;
}> {
  const [reserveA, reserveB] = await getReserves(DUMMY_READER);
  const amountInRaw = toRaw(input.amountIn);
  const r = detectPriceImpact(amountInRaw, input.tokenIn, reserveA, reserveB);
  // Close the loop: record medium/high triggers so settleByExecutedSwap can
  // grade the prediction once a real trade lands.
  recordSecurityTrigger("price_impact", r.riskLevel, {
    predictedImpactPct: r.priceImpactPct,
    amountIn: amountInRaw.toString(),
    tokenIn: input.tokenIn,
    reserveAAtTrigger: reserveA.toString(),
    reserveBAtTrigger: reserveB.toString(),
  });
  return {
    priceImpactPct: r.priceImpactPct.toFixed(4),
    riskLevel: r.riskLevel,
    recommendation: r.recommendation,
  };
}

// ── analyze_liquidity_depth ───────────────────────────────────────────────────

export const analyzeLiquidityDepthSchema: Anthropic.Tool = {
  name: "analyze_liquidity_depth",
  description:
    "Analyze recent liquidity flow (last ~1 hour of events) to detect net outflows. Returns net flow direction and risk level.",
  input_schema: { type: "object", properties: {}, required: [] },
};

export async function analyzeLiquidityDepthHandler(): Promise<{
  reserveA: string;
  reserveB: string;
  netRemoveA: string;
  netRemoveB: string;
  outflowPct: string;
  riskLevel: "low" | "medium" | "high";
  recommendation: string;
}> {
  const [[reserveA, reserveB], events] = await Promise.all([
    getReserves(DUMMY_READER),
    loadDecodedEvents(),
  ]);
  const r = detectLiquidityFlow(events, reserveA);
  recordSecurityTrigger("liquidity_flow", r.riskLevel, {
    outflowPct: r.outflowPct,
    reserveAAtTrigger: reserveA.toString(),
    reserveBAtTrigger: reserveB.toString(),
    tvlAtTrigger: Number(reserveA) + Number(reserveB),
  });
  return {
    reserveA: formatAmount(reserveA),
    reserveB: formatAmount(reserveB),
    netRemoveA: formatAmount(r.netRemoveA),
    netRemoveB: formatAmount(r.netRemoveB),
    outflowPct: r.outflowPct.toFixed(2),
    riskLevel: r.riskLevel,
    recommendation: r.recommendation,
  };
}

// ── scan_recent_anomalies ─────────────────────────────────────────────────────

export const scanRecentAnomaliesSchema: Anthropic.Tool = {
  name: "scan_recent_anomalies",
  description:
    "Scan recent events for anomalous patterns: single-address concentration, rapid large removals. Returns flagged addresses and risk summary.",
  input_schema: { type: "object", properties: {}, required: [] },
};

export async function scanRecentAnomaliesHandler(): Promise<{
  totalEvents: number;
  flaggedAddresses: { address: string; reason: string }[];
  riskLevel: "low" | "medium" | "high";
  summary: string;
}> {
  const [events, [reserveA]] = await Promise.all([
    loadDecodedEvents(),
    getReserves(DUMMY_READER),
  ]);
  const r = detectAnomalies(events, reserveA);
  // Record one sandwich trigger per flagged address so settleBySandwichBehavior
  // can grade each suspect independently. Use the latest swap ledger we saw
  // as the trigger ledger; settlement waits ledgerWindow blocks past that.
  if (r.riskLevel !== "low") {
    const lastLedger = events.reduce((max, e) => Math.max(max, e.ledger), 0);
    for (const flag of r.flaggedAddresses) {
      recordSecurityTrigger("sandwich", r.riskLevel, {
        suspectAddress: flag.address,
        frontRunLedger: lastLedger,
        observedAtLedger: lastLedger,
      });
    }
  }
  return {
    totalEvents: events.length,
    flaggedAddresses: r.flaggedAddresses,
    riskLevel: r.riskLevel,
    summary: r.summary,
  };
}
