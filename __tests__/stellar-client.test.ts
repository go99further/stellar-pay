import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@stellar/stellar-sdk", () => {
  return {
    Horizon: {
      Server: vi.fn().mockImplementation(function () {
        return {
          loadAccount: vi.fn(),
          transactions: vi.fn(),
          ledgers: vi.fn(),
          submitTransaction: vi.fn(),
        };
      }),
    },
  };
});

vi.mock("../lib/agent/circuit-breaker", () => ({
  CircuitBreaker: vi.fn().mockImplementation(function () {
    return {
      execute: vi.fn((fn: () => Promise<unknown>) => fn()),
      getState: vi.fn(() => "CLOSED"),
    };
  }),
}));

import { StellarClient } from "../lib/web3/stellar-client";
import { Horizon } from "@stellar/stellar-sdk";

function getLastServerMock() {
  const calls = vi.mocked(Horizon.Server).mock.results;
  return calls[calls.length - 1].value as {
    loadAccount: ReturnType<typeof vi.fn>;
    transactions: ReturnType<typeof vi.fn>;
    ledgers: ReturnType<typeof vi.fn>;
    submitTransaction: ReturnType<typeof vi.fn>;
  };
}

describe("StellarClient", () => {
  let client: StellarClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new StellarClient({ useCircuitBreaker: false, cacheEnabled: false });
  });

  describe("constructor", () => {
    it("creates client with default config", () => {
      const c = new StellarClient({ useCircuitBreaker: false });
      const status = c.getStatus();
      expect(status.horizonUrl).toBe("https://horizon-testnet.stellar.org");
      expect(status.cacheEnabled).toBe(true);
    });

    it("accepts custom horizonUrl", () => {
      const c = new StellarClient({ horizonUrl: "https://horizon.stellar.org", useCircuitBreaker: false });
      expect(c.getStatus().horizonUrl).toBe("https://horizon.stellar.org");
    });
  });

  describe("loadAccount", () => {
    it("calls server.loadAccount with address", async () => {
      const mockAccount = {
        id: "GADDR",
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      };
      getLastServerMock().loadAccount.mockResolvedValue(mockAccount);

      const result = await client.loadAccount("GADDR");
      expect(result).toEqual(mockAccount);
      expect(getLastServerMock().loadAccount).toHaveBeenCalledWith("GADDR");
    });

    it("caches account on second call", async () => {
      const cachedClient = new StellarClient({ useCircuitBreaker: false, cacheEnabled: true });
      const mockAccount = { id: "GADDR", balances: [] };
      getLastServerMock().loadAccount.mockResolvedValue(mockAccount);

      await cachedClient.loadAccount("GADDR");
      await cachedClient.loadAccount("GADDR");

      expect(getLastServerMock().loadAccount).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTokenBalance", () => {
    it("returns native XLM balance", async () => {
      getLastServerMock().loadAccount.mockResolvedValue({
        id: "GADDR",
        balances: [{ asset_type: "native", balance: "50.0000000" }],
      });

      const balance = await client.getTokenBalance("GADDR", "XLM");
      expect(balance).toBe("50.0000000");
    });

    it("returns 0 when token not found", async () => {
      getLastServerMock().loadAccount.mockResolvedValue({ id: "GADDR", balances: [] });

      const balance = await client.getTokenBalance("GADDR", "USDC");
      expect(balance).toBe("0");
    });

    it("returns non-native token balance", async () => {
      getLastServerMock().loadAccount.mockResolvedValue({
        id: "GADDR",
        balances: [
          { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "200.0000000" },
        ],
      });

      const balance = await client.getTokenBalance("GADDR", "USDC");
      expect(balance).toBe("200.0000000");
    });
  });

  describe("getStatus", () => {
    it("returns status object with expected fields", () => {
      const status = client.getStatus();
      expect(status).toHaveProperty("horizonUrl");
      expect(status).toHaveProperty("cacheEnabled");
      expect(status).toHaveProperty("cacheSize");
      expect(status).toHaveProperty("pendingRequests");
    });
  });

  describe("updateConfig", () => {
    it("updates horizonUrl", () => {
      client.updateConfig({ horizonUrl: "https://horizon.stellar.org" });
      expect(client.getStatus().horizonUrl).toBe("https://horizon.stellar.org");
    });
  });

  describe("getCacheStats", () => {
    it("returns cache stats object", () => {
      const stats = client.getCacheStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("hitRate");
      expect(stats).toHaveProperty("entries");
      expect(Array.isArray(stats.entries)).toBe(true);
    });
  });

  describe("batchLoadAccounts", () => {
    it("loads multiple accounts in parallel", async () => {
      const batchClient = new StellarClient({ useCircuitBreaker: false, cacheEnabled: false, batchEnabled: true });
      getLastServerMock().loadAccount
        .mockResolvedValueOnce({ id: "GADDR1", balances: [] })
        .mockResolvedValueOnce({ id: "GADDR2", balances: [] });

      const result = await batchClient.batchLoadAccounts(["GADDR1", "GADDR2"]);
      expect(result.size).toBe(2);
      expect(result.has("GADDR1")).toBe(true);
      expect(result.has("GADDR2")).toBe(true);
    });

    it("skips failed accounts gracefully when batchEnabled=false", async () => {
      const batchClient = new StellarClient({ useCircuitBreaker: false, cacheEnabled: false, batchEnabled: false, maxRetries: 1 });
      getLastServerMock().loadAccount
        .mockResolvedValueOnce({ id: "GADDR1", balances: [] })
        .mockRejectedValue(new Error("not found"));

      const result = await batchClient.batchLoadAccounts(["GADDR1", "GADDR2"]);
      expect(result.size).toBe(1);
      expect(result.has("GADDR1")).toBe(true);
      expect(result.has("GADDR2")).toBe(false);
    });

    it("skips failed accounts gracefully when batchEnabled=true (Promise.allSettled)", async () => {
      const batchClient = new StellarClient({ useCircuitBreaker: false, cacheEnabled: false, batchEnabled: true, maxRetries: 1 });
      getLastServerMock().loadAccount
        .mockResolvedValueOnce({ id: "GADDR1", balances: [] })
        .mockRejectedValue(new Error("not found"));

      const result = await batchClient.batchLoadAccounts(["GADDR1", "GADDR2"]);
      expect(result.size).toBe(1);
      expect(result.has("GADDR1")).toBe(true);
      expect(result.has("GADDR2")).toBe(false);
    });
  });
});

