import type Anthropic from "@anthropic-ai/sdk";
import { getReserves } from "@/lib/amm-contract";
import { getPriceImpact } from "@/lib/amm-math";
import { fetchAmmEvents } from "@/lib/amm-events";
import { decodeEventTopic, decodeLiquidityEvent } from "@/lib/event-decoder";

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
  const isAtoB = input.tokenIn === "TKNA";
  const reserveIn = isAtoB ? reserveA : reserveB;
  const reserveOut = isAtoB ? reserveB : reserveA;

  const impact = getPriceImpact(toRaw(input.amountIn), reserveIn, reserveOut);
  const riskLevel: "low" | "medium" | "high" =
    impact < 1 ? "low" : impact < 3 ? "medium" : "high";

  const recommendation =
    riskLevel === "low"
      ? "Price impact is acceptable."
      : riskLevel === "medium"
      ? "Moderate price impact. Consider splitting into smaller trades."
      : "High price impact (>3%). Strongly recommend splitting this trade to reduce losses.";

  return { priceImpactPct: impact.toFixed(4), riskLevel, recommendation };
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
  const [[reserveA, reserveB], { events }] = await Promise.all([
    getReserves(DUMMY_READER),
    fetchAmmEvents(),
  ]);

  let netRemoveA = 0n;
  let netRemoveB = 0n;

  for (const evt of events) {
    const topic = evt.topic[1] ? decodeEventTopic(evt.topic[1]) : "";
    if (topic === "rem_liq") {
      const l = decodeLiquidityEvent(evt.value);
      if (l) {
        netRemoveA += l.amountA;
        netRemoveB += l.amountB;
      }
    }
  }

  const outflowPct =
    reserveA > 0n ? (Number(netRemoveA) / Number(reserveA)) * 100 : 0;

  const riskLevel: "low" | "medium" | "high" =
    outflowPct < 5 ? "low" : outflowPct < 20 ? "medium" : "high";

  const recommendation =
    riskLevel === "low"
      ? "Liquidity is stable."
      : riskLevel === "medium"
      ? "Moderate liquidity outflow detected. Monitor before large trades."
      : "Significant liquidity outflow (>20% of reserves removed recently). High slippage risk.";

  return {
    reserveA: formatAmount(reserveA),
    reserveB: formatAmount(reserveB),
    netRemoveA: formatAmount(netRemoveA),
    netRemoveB: formatAmount(netRemoveB),
    outflowPct: outflowPct.toFixed(2),
    riskLevel,
    recommendation,
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
  const [{ events }, [reserveA]] = await Promise.all([
    fetchAmmEvents(),
    getReserves(DUMMY_READER),
  ]);

  const removeByAddress = new Map<string, bigint>();

  for (const evt of events) {
    const topic = evt.topic[1] ? decodeEventTopic(evt.topic[1]) : "";
    if (topic === "rem_liq") {
      const l = decodeLiquidityEvent(evt.value);
      if (l) {
        const prev = removeByAddress.get(l.provider) ?? 0n;
        removeByAddress.set(l.provider, prev + l.amountA);
      }
    }
  }

  const flagged: { address: string; reason: string }[] = [];
  for (const [addr, amount] of removeByAddress.entries()) {
    const pct = reserveA > 0n ? (Number(amount) / Number(reserveA)) * 100 : 0;
    if (pct > 5) {
      flagged.push({
        address: addr,
        reason: `Removed ${pct.toFixed(1)}% of pool reserves — potential large exit or sandwich setup`,
      });
    }
  }

  const riskLevel: "low" | "medium" | "high" =
    flagged.length === 0 ? "low" : flagged.length <= 2 ? "medium" : "high";

  const summary =
    flagged.length === 0
      ? "No anomalous activity detected in recent events."
      : `${flagged.length} address(es) flagged for concentrated liquidity removal.`;

  return { totalEvents: events.length, flaggedAddresses: flagged, riskLevel, summary };
}
