import { describe, it, expect, vi, beforeEach } from "vitest";

const mockServer = {
  loadAccount: vi.fn(),
  fetchBaseFee: vi.fn(),
  submitTransaction: vi.fn(),
};

const mockAccount = {
  balances: [
    { asset_type: "native", balance: "100.5000000" },
    { asset_type: "credit_alphanum4", balance: "50.0000000" },
  ],
  sequence: "123456789",
  accountId: () => "GTEST123",
  incrementSequenceNumber: () => {},
};

class MockHorizonServer {
  constructor() {
    return mockServer;
  }
}

const mockNetworks = { TESTNET: "Test SDF Network ; September 2015" };

const mockTransaction = {
  toXDR: vi.fn(() => "mock-xdr"),
};

const mockTransactionBuilder = {
  addOperation: vi.fn().mockReturnThis(),
  setTimeout: vi.fn().mockReturnThis(),
  build: vi.fn(() => mockTransaction),
};

class MockTransactionBuilder {
  constructor() {
    return mockTransactionBuilder;
  }
  static fromXDR = vi.fn(() => ({ hash: "tx-hash" }));
}

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: MockHorizonServer,
  },
  Networks: mockNetworks,
  TransactionBuilder: MockTransactionBuilder,
  Operation: {
    payment: vi.fn(),
  },
  Asset: {
    native: vi.fn(),
  },
}));

vi.mock("@stellar/freighter-api", () => ({
  signTransaction: vi.fn(),
}));

describe("stellar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServer.loadAccount.mockResolvedValue(mockAccount);
    mockServer.fetchBaseFee.mockResolvedValue(100);
  });

  describe("fetchBalance", () => {
    it("should return native balance for valid account", async () => {
      const { fetchBalance } = await import("../lib/stellar");
      const balance = await fetchBalance("GTEST123");
      expect(balance).toBe("100.5000000");
      expect(mockServer.loadAccount).toHaveBeenCalledWith("GTEST123");
    });

    it("should return 0 when no native balance found", async () => {
      mockServer.loadAccount.mockResolvedValue({
        balances: [{ asset_type: "credit_alphanum4", balance: "50.0000000" }],
      });

      const { fetchBalance } = await import("../lib/stellar");
      const balance = await fetchBalance("GTEST123");
      expect(balance).toBe("0");
    });

    it("should propagate errors from server", async () => {
      mockServer.loadAccount.mockRejectedValue(new Error("Account not found"));

      const { fetchBalance } = await import("../lib/stellar");
      await expect(fetchBalance("GINVALID")).rejects.toThrow("Account not found");
    });

    it("should handle empty balances array", async () => {
      mockServer.loadAccount.mockResolvedValue({
        balances: [],
      });

      const { fetchBalance } = await import("../lib/stellar");
      const balance = await fetchBalance("GTEST123");
      expect(balance).toBe("0");
    });
  });

  describe("sendPayment", () => {
    beforeEach(async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      const { signTransaction } = await import("@stellar/freighter-api");

      (StellarSdk.Operation.payment as any).mockReturnValue({ type: "payment" });
      (StellarSdk.Asset.native as any).mockReturnValue({ type: "native" });
      (signTransaction as any).mockResolvedValue({
        signedTxXdr: "signed-xdr",
        error: null,
      });
      mockServer.submitTransaction.mockResolvedValue({ hash: "tx-hash-123" });
    });

    it("should send payment successfully", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      const { sendPayment } = await import("../lib/stellar");
      const hash = await sendPayment("GSENDER", "GDEST", "10");

      expect(mockServer.loadAccount).toHaveBeenCalledWith("GSENDER");
      expect(mockServer.fetchBaseFee).toHaveBeenCalled();
      expect(StellarSdk.Operation.payment).toHaveBeenCalledWith({
        destination: "GDEST",
        asset: expect.anything(),
        amount: "10",
      });
      expect(mockServer.submitTransaction).toHaveBeenCalled();
      expect(hash).toBe("tx-hash-123");
    });

    it("should throw error when signing fails", async () => {
      const { signTransaction } = await import("@stellar/freighter-api");
      (signTransaction as any).mockResolvedValue({
        signedTxXdr: null,
        error: "User rejected",
      });

      const { sendPayment } = await import("../lib/stellar");
      await expect(sendPayment("GSENDER", "GDEST", "10")).rejects.toThrow("User rejected");
    });

    it("should propagate transaction submission errors", async () => {
      mockServer.submitTransaction.mockRejectedValue(new Error("Insufficient balance"));

      const { sendPayment } = await import("../lib/stellar");
      await expect(sendPayment("GSENDER", "GDEST", "10")).rejects.toThrow("Insufficient balance");
    });

    it("should handle account loading errors", async () => {
      mockServer.loadAccount.mockRejectedValue(new Error("Network error"));

      const { sendPayment } = await import("../lib/stellar");
      await expect(sendPayment("GSENDER", "GDEST", "10")).rejects.toThrow("Network error");
    });
  });

  describe("fundWithFriendbot", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("should return true on successful funding", async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const { fundWithFriendbot } = await import("../lib/stellar");
      const result = await fundWithFriendbot("GTEST123");

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://friendbot.stellar.org/?addr=GTEST123"
      );
    });

    it("should return false on failed funding", async () => {
      (global.fetch as any).mockResolvedValue({ ok: false });

      const { fundWithFriendbot } = await import("../lib/stellar");
      const result = await fundWithFriendbot("GTEST123");

      expect(result).toBe(false);
    });

    it("should encode special characters in public key", async () => {
      (global.fetch as any).mockResolvedValue({ ok: true });

      const { fundWithFriendbot } = await import("../lib/stellar");
      await fundWithFriendbot("G+TEST/123");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://friendbot.stellar.org/?addr=G%2BTEST%2F123"
      );
    });

    it("should propagate fetch errors", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      const { fundWithFriendbot } = await import("../lib/stellar");
      await expect(fundWithFriendbot("GTEST123")).rejects.toThrow("Network error");
    });
  });
});
