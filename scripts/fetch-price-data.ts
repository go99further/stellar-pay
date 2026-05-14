#!/usr/bin/env npx tsx
/**
 * Fetch diverse real price data for alert backtest
 *
 * Sources (6):
 *   1. Stellar Horizon mainnet — XLM/USDC DEX trades (structurally identical to AMM swaps)
 *   2. Stellar Horizon mainnet — all recent trades (broader DEX activity, mixed pairs)
 *   3. Stellar Horizon testnet — testnet trades (same ledger structure as deployed contract)
 *   4. CoinGecko — XLM/USD 90-day hourly (covers bull/bear/sideways regimes)
 *   5. Binance — XLM/USDT 1h OHLCV (high-liquidity CEX, different microstructure)
 *   6. Kraken — XLM/USD 1h OHLCV (different exchange, different order flow)
 *
 * All prices normalized to start at 1.0 per source before merging.
 * Walk-forward split: 60% train / 20% validation / 20% test (no overlap).
 *
 * Usage:  npx tsx scripts/fetch-price-data.ts
 * Output: data/price-dataset.json
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

interface RawPoint {
  timestamp: number; // ms
  price: number;
  id: string;
}

export interface DatasetPoint {
  timestamp: number;
  price: number;
  txHash: string;
  type: "swap";
  source: string;
  volatility?: number;
}

export interface SourceMeta {
  name: string;
  count: number;
  startTime: number;
  endTime: number;
}

export interface PriceDataset {
  fetchedAt: number;
  totalPoints: number;
  sources: SourceMeta[];
  splits: {
    train: DatasetPoint[];
    validation: DatasetPoint[];
    test: DatasetPoint[];
  };
}

// ── Horizon helpers ────────────────────────────────────────────────────────

interface HorizonTrade {
  id: string;
  ledger_close_time: string;
  base_amount: string;
  counter_amount: string;
}

function parseHorizonTrades(records: HorizonTrade[]): RawPoint[] {
  return records
    .filter((r) => parseFloat(r.base_amount) > 0)
    .map((r) => ({
      timestamp: new Date(r.ledger_close_time).getTime(),
      price: parseFloat(r.counter_amount) / parseFloat(r.base_amount),
      id: r.id,
    }))
    .filter((p) => isFinite(p.price) && p.price > 0);
}

// ── Fetchers ───────────────────────────────────────────────────────────────

async function fetchHorizonMainnetDex(): Promise<RawPoint[]> {
  // Trade aggregations: 1h OHLCV for XLM/USDC on the Stellar DEX
  // Most structurally similar to the AMM — real on-chain swap prices
  const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const url =
    "https://horizon.stellar.org/trade_aggregations" +
    "?base_asset_type=native" +
    "&counter_asset_type=credit_alphanum4" +
    "&counter_asset_code=USDC" +
    `&counter_asset_issuer=${issuer}` +
    "&resolution=3600000&limit=200&order=desc";
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    _embedded: {
      records: {
        timestamp: string;
        close: string;
      }[];
    };
  };
  return data._embedded.records
    .map((r, i) => ({
      timestamp: parseInt(r.timestamp, 10),
      price: parseFloat(r.close),
      id: `horizon_dex_${i}`,
    }))
    .filter((p) => isFinite(p.price) && p.price > 0);
}

async function fetchHorizonMainnetAll(): Promise<RawPoint[]> {
  const url = "https://horizon.stellar.org/trades?limit=200&order=desc";
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { _embedded: { records: HorizonTrade[] } };
  return parseHorizonTrades(data._embedded.records);
}

async function fetchHorizonTestnet(): Promise<RawPoint[]> {
  const url = "https://horizon-testnet.stellar.org/trades?limit=200&order=desc";
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { _embedded: { records: HorizonTrade[] } };
  return parseHorizonTrades(data._embedded.records);
}

async function fetchCoinGecko(): Promise<RawPoint[]> {
  const url =
    "https://api.coingecko.com/api/v3/coins/stellar/market_chart" +
    "?vs_currency=usd&days=90";
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { prices: [number, number][] };
  return data.prices.map(([timestamp, price], i) => ({
    timestamp,
    price,
    id: `coingecko_${i}`,
  }));
}

async function fetchBinance(): Promise<RawPoint[]> {
  const url =
    "https://api.binance.com/api/v3/klines?symbol=XLMUSDT&interval=1h&limit=500";
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as [
    number,
    string,
    string,
    string,
    string,
    ...unknown[]
  ][];
  return data
    .map((k, i) => ({
      timestamp: k[0],
      price: parseFloat(k[4]), // close
      id: `binance_${i}`,
    }))
    .filter((p) => isFinite(p.price) && p.price > 0);
}

async function fetchKraken(): Promise<RawPoint[]> {
  const url = "https://api.kraken.com/0/public/OHLC?pair=XLMUSD&interval=60";
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    result: Record<
      string,
      [number, string, string, string, string, string, string, number][]
    >;
  };
  const key = Object.keys(data.result).find((k) => k !== "last");
  if (!key) throw new Error("No OHLC key in Kraken response");
  return data.result[key]
    .map((k, i) => ({
      timestamp: k[0] * 1000, // seconds → ms
      price: parseFloat(k[4]), // close
      id: `kraken_${i}`,
    }))
    .filter((p) => isFinite(p.price) && p.price > 0);
}

// ── Processing ─────────────────────────────────────────────────────────────

// Normalize so the first price in each source = 1.0, preserving relative moves
function normalize(points: RawPoint[]): RawPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const base = sorted[0].price;
  if (base === 0) return sorted;
  return sorted.map((p) => ({ ...p, price: p.price / base }));
}

function addVolatility(points: DatasetPoint[]): void {
  for (let i = 1; i < points.length; i++) {
    points[i].volatility =
      Math.abs((points[i].price - points[i - 1].price) / points[i - 1].price);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const FETCHERS: { name: string; fn: () => Promise<RawPoint[]> }[] = [
  {
    name: "Stellar Horizon DEX mainnet (XLM/USDC)",
    fn: fetchHorizonMainnetDex,
  },
  {
    name: "Stellar Horizon trades mainnet (all pairs)",
    fn: fetchHorizonMainnetAll,
  },
  { name: "Stellar Horizon testnet", fn: fetchHorizonTestnet },
  { name: "CoinGecko XLM/USD 90d hourly", fn: fetchCoinGecko },
  { name: "Binance XLM/USDT 1h", fn: fetchBinance },
  { name: "Kraken XLM/USD 1h", fn: fetchKraken },
];

async function main() {
  console.log("Fetching price data from 6 sources...\n");

  const results = await Promise.allSettled(FETCHERS.map((f) => f.fn()));

  const allPoints: DatasetPoint[] = [];
  const sources: SourceMeta[] = [];

  for (let i = 0; i < FETCHERS.length; i++) {
    const result = results[i];
    const name = FETCHERS[i].name;

    if (result.status === "rejected") {
      console.warn(`  ✗ ${name}: ${(result.reason as Error).message}`);
      continue;
    }

    const normalized = normalize(result.value);
    if (normalized.length === 0) {
      console.warn(`  ✗ ${name}: 0 points after normalization`);
      continue;
    }

    const enriched: DatasetPoint[] = normalized.map((p) => ({
      timestamp: p.timestamp,
      price: p.price,
      txHash: p.id,
      type: "swap" as const,
      source: name,
    }));

    allPoints.push(...enriched);
    sources.push({
      name,
      count: enriched.length,
      startTime: normalized[0].timestamp,
      endTime: normalized[normalized.length - 1].timestamp,
    });

    console.log(`  ✓ ${name}: ${enriched.length} points`);
  }

  if (allPoints.length === 0) {
    console.error("\nNo data fetched. Check network connectivity.");
    process.exit(1);
  }

  // Walk-forward order: sort by timestamp across all sources
  allPoints.sort((a, b) => a.timestamp - b.timestamp);
  addVolatility(allPoints);

  // 60 / 20 / 20 split — strictly by position (time-ordered, no overlap)
  const trainEnd = Math.floor(allPoints.length * 0.6);
  const valEnd = Math.floor(allPoints.length * 0.8);

  const dataset: PriceDataset = {
    fetchedAt: Date.now(),
    totalPoints: allPoints.length,
    sources,
    splits: {
      train: allPoints.slice(0, trainEnd),
      validation: allPoints.slice(trainEnd, valEnd),
      test: allPoints.slice(valEnd),
    },
  };

  const outPath = path.join(process.cwd(), "data", "price-dataset.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));

  console.log(`\nTotal : ${allPoints.length} points from ${sources.length} sources`);
  console.log(
    `Split : ${dataset.splits.train.length} train / ` +
      `${dataset.splits.validation.length} val / ` +
      `${dataset.splits.test.length} test`
  );
  console.log(`Output: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
