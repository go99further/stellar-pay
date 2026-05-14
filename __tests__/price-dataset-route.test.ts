import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      body,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    }),
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

vi.mock("node:path", () => ({
  default: {
    join: (...parts: string[]) => parts.join("/"),
  },
}));

import fs from "node:fs";
import { GET } from "../app/api/price-dataset/route";

interface MockResponse {
  body: unknown;
  status: number;
  headers: Record<string, string>;
}

const mockDataset = {
  fetchedAt: 1700000000000,
  totalPoints: 100,
  sources: [
    { name: "CoinGecko XLM/USD 90d hourly", count: 60, startTime: 1000, endTime: 2000 },
    { name: "Binance XLM/USDT 1h", count: 40, startTime: 1000, endTime: 2000 },
  ],
  splits: {
    train: [{ timestamp: 1000, price: 1.0, txHash: "t1", type: "swap", source: "CoinGecko XLM/USD 90d hourly" }],
    validation: [{ timestamp: 1500, price: 1.05, txHash: "t2", type: "swap", source: "Binance XLM/USDT 1h" }],
    test: [{ timestamp: 2000, price: 0.98, txHash: "t3", type: "swap", source: "CoinGecko XLM/USD 90d hourly" }],
  },
};

describe("GET /api/price-dataset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when data/price-dataset.json does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = (await GET()) as unknown as MockResponse;

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not found/i);
  });

  it("returns 200 with dataset when file exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockDataset));

    const res = (await GET()) as unknown as MockResponse;
    const body = res.body as typeof mockDataset;

    expect(res.status).toBe(200);
    expect(body.totalPoints).toBe(100);
    expect(body.sources).toHaveLength(2);
    expect(body.splits.train).toHaveLength(1);
    expect(body.splits.validation).toHaveLength(1);
    expect(body.splits.test).toHaveLength(1);
  });

  it("includes Cache-Control header when file exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockDataset));

    const res = (await GET()) as unknown as MockResponse;

    expect(res.headers["Cache-Control"]).toMatch(/max-age/);
  });

  it("returns correct source names", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockDataset));

    const res = (await GET()) as unknown as MockResponse;
    const body = res.body as typeof mockDataset;

    expect(body.sources[0].name).toBe("CoinGecko XLM/USD 90d hourly");
    expect(body.sources[1].name).toBe("Binance XLM/USDT 1h");
  });

  it("returns correct split sizes", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockDataset));

    const res = (await GET()) as unknown as MockResponse;
    const body = res.body as typeof mockDataset;

    expect(
      body.splits.train.length + body.splits.validation.length + body.splits.test.length
    ).toBe(3);
  });
});
