import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getMetricsHandler, getMetricsSchema } from "../lib/agent/tools/get-metrics";

describe("get-metrics tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
  });

  describe("getMetricsHandler", () => {
    it("should return parsed JSON from metrics endpoint", async () => {
      const mockData = { swapCount: 42, tvlA: "1000.0", tvlB: "2000.0" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });
      const result = await getMetricsHandler();
      expect(result).toEqual(mockData);
    });

    it("should use NEXT_PUBLIC_APP_URL when set", async () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://myapp.com";
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await getMetricsHandler();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://myapp.com/api/metrics",
        expect.any(Object)
      );
    });

    it("should use VERCEL_URL when NEXT_PUBLIC_APP_URL is not set", async () => {
      process.env.VERCEL_URL = "myapp.vercel.app";
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await getMetricsHandler();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://myapp.vercel.app/api/metrics",
        expect.any(Object)
      );
    });

    it("should fall back to localhost:3000 when no env vars set", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await getMetricsHandler();
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/metrics",
        expect.any(Object)
      );
    });

    it("should throw when response is not ok", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });
      await expect(getMetricsHandler()).rejects.toThrow("503");
    });

    it("should call fetch with cache: no-store", async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await getMetricsHandler();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        { cache: "no-store" }
      );
    });
  });
});

describe("getMetricsSchema", () => {
  it("should have name get_metrics", () => {
    expect(getMetricsSchema.name).toBe("get_metrics");
  });

  it("should have a description", () => {
    expect(typeof getMetricsSchema.description).toBe("string");
    expect(getMetricsSchema.description!.length).toBeGreaterThan(0);
  });

  it("should have an object input_schema", () => {
    expect(getMetricsSchema.input_schema.type).toBe("object");
  });
});
