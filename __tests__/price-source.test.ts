import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  loadRealPriceDataset,
  getRealPriceHistory,
  getDatasetMeta,
  isRealPriceCacheLoaded,
  clearRealPriceCache,
  type PriceDataset,
} from "../lib/agent/price-source";

const SAMPLE_DATASET: PriceDataset = {
  fetchedAt: 1_700_000_000_000,
  totalPoints: 6,
  sources: [
    { name: "Stellar Horizon DEX mainnet (XLM/USDC)", count: 2, startTime: 1000, endTime: 2000 },
    { name: "CoinGecko XLM/USD 90d hourly", count: 4, startTime: 1000, endTime: 4000 },
  ],
  splits: {
    train: [
      { timestamp: 1000, price: 1.0, txHash: "t1", type: "swap", source: "Stellar Horizon DEX mainnet (XLM/USDC)" },
      { timestamp: 1500, price: 1.05, txHash: "t2", type: "swap", source: "CoinGecko XLM/USD 90d hourly" },
      { timestamp: 2000, price: 1.02, txHash: "t3", type: "swap", source: "Stellar Horizon DEX mainnet (XLM/USDC)" },
    ],
    validation: [
      { timestamp: 2500, price: 0.98, txHash: "v1", type: "swap", source: "CoinGecko XLM/USD 90d hourly" },
      { timestamp: 3000, price: 1.01, txHash: "v2", type: "swap", source: "CoinGecko XLM/USD 90d hourly" },
    ],
    test: [
      { timestamp: 3500, price: 1.03, txHash: "te1", type: "swap", source: "CoinGecko XLM/USD 90d hourly" },
    ],
  },
};

function mockFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

function mockFetchFail(status = 500): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: "boom" }),
  }) as unknown as typeof fetch;
}

function mockFetchThrows(err = new Error("network down")): typeof fetch {
  return vi.fn().mockRejectedValue(err) as unknown as typeof fetch;
}

describe("price-source", () => {
  beforeEach(() => {
    clearRealPriceCache();
  });

  afterEach(() => {
    clearRealPriceCache();
    vi.restoreAllMocks();
  });

  describe("loadRealPriceDataset", () => {
    it("returns null and leaves cache empty when fetch returns non-ok", async () => {
      const result = await loadRealPriceDataset(mockFetchFail(404));
      expect(result).toBeNull();
      expect(isRealPriceCacheLoaded()).toBe(false);
    });

    it("returns null when fetch throws (network failure)", async () => {
      const result = await loadRealPriceDataset(mockFetchThrows());
      expect(result).toBeNull();
      expect(isRealPriceCacheLoaded()).toBe(false);
    });

    it("returns null when JSON shape is malformed", async () => {
      const malformed = mockFetchOk({ totalPoints: 0 }); // missing splits
      const result = await loadRealPriceDataset(malformed);
      expect(result).toBeNull();
      expect(isRealPriceCacheLoaded()).toBe(false);
    });

    it("caches the dataset on first successful load", async () => {
      const fetchSpy = mockFetchOk(SAMPLE_DATASET);
      const r1 = await loadRealPriceDataset(fetchSpy);
      expect(r1).not.toBeNull();
      expect(isRealPriceCacheLoaded()).toBe(true);

      // Second call must NOT trigger fetch
      const r2 = await loadRealPriceDataset(fetchSpy);
      expect(r2).toBe(r1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent in-flight requests", async () => {
      let resolveFn: (v: unknown) => void = () => {};
      const slowFetch = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFn = resolve;
          })
      ) as unknown as typeof fetch;

      const p1 = loadRealPriceDataset(slowFetch);
      const p2 = loadRealPriceDataset(slowFetch);

      // Both promises kicked off but only one fetch should have fired
      expect(slowFetch).toHaveBeenCalledTimes(1);

      resolveFn({ ok: true, json: () => Promise.resolve(SAMPLE_DATASET) });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
    });
  });

  describe("getRealPriceHistory", () => {
    it("returns null when cache is empty", () => {
      expect(getRealPriceHistory("all")).toBeNull();
    });

    it("returns concatenated splits when split='all'", async () => {
      await loadRealPriceDataset(mockFetchOk(SAMPLE_DATASET));
      const all = getRealPriceHistory("all");
      expect(all).not.toBeNull();
      expect(all!).toHaveLength(6);
      expect(all![0].timestamp).toBe(1000);
      expect(all![5].timestamp).toBe(3500);
    });

    it("returns only the requested split when split='train'", async () => {
      await loadRealPriceDataset(mockFetchOk(SAMPLE_DATASET));
      expect(getRealPriceHistory("train")!).toHaveLength(3);
      expect(getRealPriceHistory("validation")!).toHaveLength(2);
      expect(getRealPriceHistory("test")!).toHaveLength(1);
    });

    it("strips internal source field from PricePoint shape", async () => {
      await loadRealPriceDataset(mockFetchOk(SAMPLE_DATASET));
      const points = getRealPriceHistory("train")!;
      // Source must NOT be on the returned PricePoint (engine doesn't know about it)
      expect(points[0]).not.toHaveProperty("source");
      expect(points[0]).toHaveProperty("timestamp");
      expect(points[0]).toHaveProperty("price");
      expect(points[0]).toHaveProperty("txHash");
      expect(points[0]).toHaveProperty("type");
    });
  });

  describe("getDatasetMeta", () => {
    it("reports loaded=false before any successful load", () => {
      const meta = getDatasetMeta();
      expect(meta.loaded).toBe(false);
      expect(meta.totalPoints).toBe(0);
      expect(meta.sources).toHaveLength(0);
    });

    it("reports loaded=true with split sizes after load", async () => {
      await loadRealPriceDataset(mockFetchOk(SAMPLE_DATASET));
      const meta = getDatasetMeta();
      expect(meta.loaded).toBe(true);
      expect(meta.totalPoints).toBe(6);
      expect(meta.sources).toHaveLength(2);
      expect(meta.splits).toEqual({ train: 3, validation: 2, test: 1 });
      expect(meta.fetchedAt).toBe(SAMPLE_DATASET.fetchedAt);
    });
  });

  describe("clearRealPriceCache", () => {
    it("resets cache so subsequent loads refetch", async () => {
      const fetchSpy = mockFetchOk(SAMPLE_DATASET);
      await loadRealPriceDataset(fetchSpy);
      expect(isRealPriceCacheLoaded()).toBe(true);

      clearRealPriceCache();
      expect(isRealPriceCacheLoaded()).toBe(false);

      await loadRealPriceDataset(fetchSpy);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});

// ── Integration: extractPriceHistoryV2 prefers real cache ────────────────────

describe("alert-backtest-v2 ↔ price-source integration", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRealPriceCache();
  });

  afterEach(() => {
    localStorage.clear();
    clearRealPriceCache();
    vi.restoreAllMocks();
  });

  it("falls back to localStorage when real cache is empty", async () => {
    const { extractPriceHistoryV2 } = await import("../lib/agent/alert-backtest-v2");
    // Seed localStorage transaction history
    localStorage.setItem(
      "stellar-pay-transaction-history",
      JSON.stringify([
        {
          id: "1",
          type: "swap",
          timestamp: 5000,
          details: { amountIn: 100, amountOut: 105, tokenIn: "TKNA" },
          txHash: "h1",
          status: "success",
        },
      ])
    );
    const points = extractPriceHistoryV2();
    expect(points).toHaveLength(1);
    expect(points[0].txHash).toBe("h1");
  });

  it("uses real cache when loaded, ignoring localStorage", async () => {
    const { extractPriceHistoryV2 } = await import("../lib/agent/alert-backtest-v2");

    // Seed BOTH localStorage AND real cache. Real should win.
    localStorage.setItem(
      "stellar-pay-transaction-history",
      JSON.stringify([
        {
          id: "1",
          type: "swap",
          timestamp: 5000,
          details: { amountIn: 100, amountOut: 105, tokenIn: "TKNA" },
          txHash: "should-be-ignored",
          status: "success",
        },
      ])
    );
    await loadRealPriceDataset(mockFetchOk(SAMPLE_DATASET));

    const points = extractPriceHistoryV2();
    expect(points).toHaveLength(6);
    // None of the points should have the localStorage txHash
    expect(points.find((p) => p.txHash === "should-be-ignored")).toBeUndefined();
  });

  it("falls through to localStorage if real cache loaded but empty", async () => {
    const { extractPriceHistoryV2 } = await import("../lib/agent/alert-backtest-v2");

    // Real cache loaded with ZERO points across all splits — should fall through
    const emptyDataset: PriceDataset = {
      fetchedAt: 1_700_000_000_000,
      totalPoints: 0,
      sources: [],
      splits: { train: [], validation: [], test: [] },
    };
    await loadRealPriceDataset(mockFetchOk(emptyDataset));

    localStorage.setItem(
      "stellar-pay-transaction-history",
      JSON.stringify([
        {
          id: "1",
          type: "swap",
          timestamp: 5000,
          details: { amountIn: 100, amountOut: 105, tokenIn: "TKNA" },
          txHash: "ls-fallback",
          status: "success",
        },
      ])
    );
    const points = extractPriceHistoryV2();
    expect(points).toHaveLength(1);
    expect(points[0].txHash).toBe("ls-fallback");
  });
});
