import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetLatestLedger = vi.fn();
const mockGetEvents = vi.fn();

vi.mock("@stellar/stellar-sdk", () => {
  return {
    rpc: {
      Server: class {
        getLatestLedger(...args: unknown[]) { return mockGetLatestLedger(...args); }
        getEvents(...args: unknown[]) { return mockGetEvents(...args); }
      },
    },
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
  };
});

// AMM_CONTRACT_ID is a module-level const — must use vi.resetModules() + dynamic import
// so the module re-evaluates with the env var set.
let fetchAmmEvents: (startLedger?: number) => Promise<{ events: unknown[]; latestLedger: number }>;

describe("amm-events", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_AMM_CONTRACT_ID = "CONTRACT_123";
    vi.resetModules();
    const mod = await import("../lib/amm-events");
    fetchAmmEvents = mod.fetchAmmEvents;
  });

  it("should return empty events when AMM_CONTRACT_ID is not set", async () => {
    process.env.NEXT_PUBLIC_AMM_CONTRACT_ID = "";
    vi.resetModules();
    const { fetchAmmEvents: fetchEmpty } = await import("../lib/amm-events");
    const result = await fetchEmpty();
    expect(result.events).toHaveLength(0);
    expect(result.latestLedger).toBe(0);
  });

  it("should fetch events and return latestLedger", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 2000 });
    mockGetEvents.mockResolvedValue({
      events: [
        {
          id: "evt1",
          topic: [{ toXDR: () => "topic_base64" }],
          value: { toXDR: () => "value_base64" },
          ledger: 1999,
        },
      ],
    });

    const result = await fetchAmmEvents();
    expect(result.latestLedger).toBe(2000);
    expect(result.events).toHaveLength(1);
    expect((result.events[0] as { id: string }).id).toBe("evt1");
    expect((result.events[0] as { topic: string[] }).topic[0]).toBe("topic_base64");
    expect((result.events[0] as { value: string }).value).toBe("value_base64");
    expect((result.events[0] as { ledger: number }).ledger).toBe(1999);
  });

  it("should use startLedger when provided", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 5000 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await fetchAmmEvents(3000);

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 3000 })
    );
  });

  it("should default startLedger to latest - 1000", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 5000 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await fetchAmmEvents();

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 4000 })
    );
  });

  it("should clamp startLedger to minimum 1", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 500 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await fetchAmmEvents();

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 1 })
    );
  });

  it("should return empty events array when RPC returns none", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 1000 });
    mockGetEvents.mockResolvedValue({ events: [] });

    const result = await fetchAmmEvents();
    expect(result.events).toHaveLength(0);
    expect(result.latestLedger).toBe(1000);
  });

  it("should filter by contract type in getEvents call", async () => {
    mockGetLatestLedger.mockResolvedValue({ sequence: 2000 });
    mockGetEvents.mockResolvedValue({ events: [] });

    await fetchAmmEvents();

    expect(mockGetEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ type: "contract" }),
        ]),
      })
    );
  });
});
