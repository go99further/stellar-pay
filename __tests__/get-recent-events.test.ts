import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-events", () => ({
  fetchAmmEvents: vi.fn(),
}));

vi.mock("@/lib/event-decoder", () => ({
  decodeEventTopic: vi.fn(),
  decodeSwapEvent: vi.fn(),
  decodeLiquidityEvent: vi.fn(),
}));

import { getRecentEventsHandler } from "../lib/agent/tools/get-recent-events";
import { fetchAmmEvents } from "@/lib/amm-events";
import { decodeEventTopic, decodeSwapEvent, decodeLiquidityEvent } from "@/lib/event-decoder";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("get-recent-events tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAmmEvents).mockResolvedValue({ events: [], latestLedger: 1000 });
    vi.mocked(decodeEventTopic).mockReturnValue("unknown");
    vi.mocked(decodeSwapEvent).mockReturnValue(null);
    vi.mocked(decodeLiquidityEvent).mockReturnValue(null);
  });

  describe("getRecentEventsHandler", () => {
    it("should return latestLedger from fetchAmmEvents", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({ events: [], latestLedger: 9999 });
      const result = await getRecentEventsHandler({});
      expect(result.latestLedger).toBe(9999);
    });

    it("should return empty events array when no events", async () => {
      const result = await getRecentEventsHandler({});
      expect(result.events).toHaveLength(0);
    });

    it("should decode swap events", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "swap_topic"], value: "swap_value", ledger: 100 }],
        latestLedger: 100,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("swap");
      vi.mocked(decodeSwapEvent).mockReturnValue({
        user: "GUSER",
        tokenIn: "TKNA",
        amountIn: toRaw(100),
        amountOut: toRaw(200),
      });
      const result = await getRecentEventsHandler({});
      expect(result.events).toHaveLength(1);
      const evt = result.events[0] as { kind: string; user: string; tokenIn: string; amountIn: string; amountOut: string; ledger: number };
      expect(evt.kind).toBe("swap");
      expect(evt.user).toBe("GUSER");
      expect(evt.tokenIn).toBe("TKNA");
      expect(evt.amountIn).toBe("100.0");
      expect(evt.amountOut).toBe("200.0");
      expect(evt.ledger).toBe(100);
    });

    it("should decode add_liq events", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "add_liq_topic"], value: "liq_value", ledger: 200 }],
        latestLedger: 200,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("add_liq");
      vi.mocked(decodeLiquidityEvent).mockReturnValue({
        provider: "GPROVIDER",
        amountA: toRaw(50),
        amountB: toRaw(100),
        lpAmount: toRaw(70),
      });
      const result = await getRecentEventsHandler({});
      const evt = result.events[0] as { kind: string; provider: string; amountA: string; amountB: string; lpAmount: string };
      expect(evt.kind).toBe("add_liq");
      expect(evt.provider).toBe("GPROVIDER");
      expect(evt.amountA).toBe("50.0");
      expect(evt.amountB).toBe("100.0");
      expect(evt.lpAmount).toBe("70.0");
    });

    it("should decode rem_liq events", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "rem_liq_topic"], value: "liq_value", ledger: 300 }],
        latestLedger: 300,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("rem_liq");
      vi.mocked(decodeLiquidityEvent).mockReturnValue({
        provider: "GPROVIDER2",
        amountA: toRaw(25),
        amountB: toRaw(50),
        lpAmount: toRaw(35),
      });
      const result = await getRecentEventsHandler({});
      const evt = result.events[0] as { kind: string };
      expect(evt.kind).toBe("rem_liq");
    });

    it("should fall back to unknown kind when decode returns null", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: ["", "unknown_topic"], value: "val", ledger: 400 }],
        latestLedger: 400,
      });
      vi.mocked(decodeEventTopic).mockReturnValue("swap");
      vi.mocked(decodeSwapEvent).mockReturnValue(null);
      const result = await getRecentEventsHandler({});
      const evt = result.events[0] as { kind: string; ledger: number };
      expect(evt.kind).toBe("swap");
      expect(evt.ledger).toBe(400);
    });

    it("should respect limit parameter", async () => {
      const events = Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        topic: ["", "swap_topic"],
        value: "val",
        ledger: i,
      }));
      vi.mocked(fetchAmmEvents).mockResolvedValue({ events, latestLedger: 30 });
      vi.mocked(decodeEventTopic).mockReturnValue("unknown");
      const result = await getRecentEventsHandler({ limit: 5 });
      expect(result.events).toHaveLength(5);
    });

    it("should default to 20 events when limit not provided", async () => {
      const events = Array.from({ length: 25 }, (_, i) => ({
        id: String(i),
        topic: ["", ""],
        value: "val",
        ledger: i,
      }));
      vi.mocked(fetchAmmEvents).mockResolvedValue({ events, latestLedger: 25 });
      vi.mocked(decodeEventTopic).mockReturnValue("unknown");
      const result = await getRecentEventsHandler({});
      expect(result.events).toHaveLength(20);
    });

    it("should cap limit at 100", async () => {
      const events = Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        topic: ["", ""],
        value: "val",
        ledger: i,
      }));
      vi.mocked(fetchAmmEvents).mockResolvedValue({ events, latestLedger: 200 });
      vi.mocked(decodeEventTopic).mockReturnValue("unknown");
      const result = await getRecentEventsHandler({ limit: 999 });
      expect(result.events).toHaveLength(100);
    });

    it("should handle events with no topic[1]", async () => {
      vi.mocked(fetchAmmEvents).mockResolvedValue({
        events: [{ id: "1", topic: [], value: "val", ledger: 1 }],
        latestLedger: 1,
      });
      const result = await getRecentEventsHandler({});
      expect(result.events).toHaveLength(1);
      const evt = result.events[0] as { kind: string };
      expect(evt.kind).toBe("unknown");
    });
  });
});
