import type Anthropic from "@anthropic-ai/sdk";
import { fetchAmmEvents } from "@/lib/amm-events";
import {
  decodeEventTopic,
  decodeSwapEvent,
  decodeLiquidityEvent,
} from "@/lib/event-decoder";

const DECIMALS = 7;

function formatAmount(raw: bigint): string {
  const str = raw.toString().padStart(DECIMALS + 1, "0");
  const intPart = str.slice(0, str.length - DECIMALS) || "0";
  const fracPart = str.slice(-DECIMALS).replace(/0+$/, "") || "0";
  return `${intPart}.${fracPart}`;
}

export const getRecentEventsSchema: Anthropic.Tool = {
  name: "get_recent_events",
  description:
    "Fetch recent AMM contract events (swap, add_liq, rem_liq) from Soroban. Returns decoded events with participants, amounts, and ledger numbers. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of events to return (default 20, max 100).",
      },
    },
    required: [],
  },
};

export async function getRecentEventsHandler(input: {
  limit?: number;
}): Promise<{ latestLedger: number; events: unknown[] }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const { events, latestLedger } = await fetchAmmEvents();
  const decoded: unknown[] = [];

  for (const evt of events.slice(-limit).reverse()) {
    const topicName = evt.topic[1] ? decodeEventTopic(evt.topic[1]) : "";
    if (topicName === "swap") {
      const s = decodeSwapEvent(evt.value);
      if (s) {
        decoded.push({
          kind: "swap",
          ledger: evt.ledger,
          user: s.user,
          tokenIn: s.tokenIn,
          amountIn: formatAmount(s.amountIn),
          amountOut: formatAmount(s.amountOut),
        });
        continue;
      }
    }
    if (topicName === "add_liq" || topicName === "rem_liq") {
      const l = decodeLiquidityEvent(evt.value);
      if (l) {
        decoded.push({
          kind: topicName,
          ledger: evt.ledger,
          provider: l.provider,
          amountA: formatAmount(l.amountA),
          amountB: formatAmount(l.amountB),
          lpAmount: formatAmount(l.lpAmount),
        });
        continue;
      }
    }
    decoded.push({ kind: topicName || "unknown", ledger: evt.ledger });
  }

  return { latestLedger, events: decoded };
}
