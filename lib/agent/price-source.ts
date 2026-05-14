/**
 * Real Price Source — bridges /api/price-dataset to the closed-loop engine
 *
 * The dataset itself (data/price-dataset.json, ~3,589 points across 4 sources)
 * is built offline by scripts/fetch-price-data.ts. This module makes it
 * available to runtime code without forcing every test to mock fs.
 *
 * Design choice — opt-in cache:
 * - The cache starts empty.
 * - Calling code (typically the /loop page on mount) explicitly invokes
 *   loadRealPriceDataset() once. After that, extractPriceHistoryV2() reads
 *   from the cache instead of localStorage.
 * - If loading fails (offline, 404, malformed JSON), we silently keep the
 *   cache empty so the existing localStorage-based path keeps working.
 *
 * Why not auto-load on import: many tests rely on extractPriceHistoryV2
 * returning whatever localStorage holds. Auto-loading would force every
 * test to mock fetch.
 */

import type { PricePoint } from "./alert-backtest-v2";

export interface DatasetSource {
  name: string;
  count: number;
  startTime: number;
  endTime: number;
}

export interface PriceDatasetSplit {
  timestamp: number;
  price: number;
  txHash: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  source: string;
  volatility?: number;
}

export interface PriceDataset {
  proxyAsset?: string;
  proxyDisclaimer?: string;
  fetchedAt: number;
  totalPoints: number;
  sources: DatasetSource[];
  splits: {
    train: PriceDatasetSplit[];
    validation: PriceDatasetSplit[];
    test: PriceDatasetSplit[];
  };
}

// ── In-memory cache ──────────────────────────────────────────────────────────

let cache: PriceDataset | null = null;
let inflight: Promise<PriceDataset | null> | null = null;

/**
 * Loads /api/price-dataset and caches it in module memory.
 *
 * Idempotent: parallel calls share the same in-flight promise; subsequent calls
 * after success return the cache without refetching. Use clearRealPriceCache()
 * to force a refresh (or to reset between tests).
 *
 * On any failure (network, non-200, JSON parse), resolves to null and leaves
 * the cache empty. Callers should treat null as "real data unavailable, fall
 * back to localStorage" rather than throwing.
 */
export async function loadRealPriceDataset(
  fetchImpl: typeof fetch = fetch,
  url = "/api/price-dataset"
): Promise<PriceDataset | null> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      const data = (await res.json()) as PriceDataset;
      // Minimal shape validation — defensive against malformed responses
      if (
        !data ||
        typeof data !== "object" ||
        !data.splits ||
        !Array.isArray(data.splits.train) ||
        !Array.isArray(data.splits.validation) ||
        !Array.isArray(data.splits.test)
      ) {
        return null;
      }
      cache = data;
      return data;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Returns price points from the loaded real dataset, or null if not loaded.
 *
 * Split selection mirrors alert-backtest-v2's 60/20/20 contract:
 * - "all"        — train + validation + test concatenated (used by Monte Carlo
 *                  parameter optimization which does its own walk-forward split)
 * - "train"      — first 60%
 * - "validation" — middle 20%
 * - "test"       — last 20% (for final-only evaluation)
 *
 * Returns null when the cache is empty so callers can decide whether to fall
 * back to localStorage rather than mistakenly running on no data.
 */
export function getRealPriceHistory(
  split: "all" | "train" | "validation" | "test" = "all"
): PricePoint[] | null {
  if (!cache) return null;
  const points: PriceDatasetSplit[] =
    split === "all"
      ? [...cache.splits.train, ...cache.splits.validation, ...cache.splits.test]
      : cache.splits[split];

  return points.map((p) => ({
    timestamp: p.timestamp,
    price: p.price,
    txHash: p.txHash,
    type: p.type,
    volatility: p.volatility,
  }));
}

export function getDatasetMeta(): {
  loaded: boolean;
  totalPoints: number;
  sources: DatasetSource[];
  splits: { train: number; validation: number; test: number };
  fetchedAt: number | null;
  proxyAsset: string | null;
  proxyDisclaimer: string | null;
} {
  if (!cache) {
    return {
      loaded: false,
      totalPoints: 0,
      sources: [],
      splits: { train: 0, validation: 0, test: 0 },
      fetchedAt: null,
      proxyAsset: null,
      proxyDisclaimer: null,
    };
  }
  return {
    loaded: true,
    totalPoints: cache.totalPoints,
    sources: cache.sources,
    splits: {
      train: cache.splits.train.length,
      validation: cache.splits.validation.length,
      test: cache.splits.test.length,
    },
    fetchedAt: cache.fetchedAt,
    proxyAsset: cache.proxyAsset ?? null,
    proxyDisclaimer: cache.proxyDisclaimer ?? null,
  };
}

export function isRealPriceCacheLoaded(): boolean {
  return cache !== null;
}

export function clearRealPriceCache(): void {
  cache = null;
  inflight = null;
}
