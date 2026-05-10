import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStellarWalletsKit = {
  init: vi.fn(),
  authModal: vi.fn(),
  signTransaction: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: mockStellarWalletsKit,
  Networks: { TESTNET: "testnet" },
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FreighterModule: vi.fn(),
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/lobstr", () => ({
  LobstrModule: vi.fn(),
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/albedo", () => ({
  AlbedoModule: vi.fn(),
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({
  xBullModule: vi.fn(),
}));

describe("wallet-kit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("initWalletKit", () => {
    it("should initialize StellarWalletsKit with correct config", async () => {
      const { initWalletKit } = await import("../lib/wallet-kit");
      initWalletKit();

      expect(mockStellarWalletsKit.init).toHaveBeenCalledWith({
        network: "testnet",
        modules: expect.arrayContaining([
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ]),
      });
    });

    it("should only initialize once when called multiple times", async () => {
      const { initWalletKit } = await import("../lib/wallet-kit");
      initWalletKit();
      initWalletKit();
      initWalletKit();

      expect(mockStellarWalletsKit.init).toHaveBeenCalledTimes(1);
    });
  });

  describe("connectWithKit", () => {
    it("should initialize and return connected address", async () => {
      mockStellarWalletsKit.authModal.mockResolvedValue({
        address: "GCONNECTED123",
      });

      const { connectWithKit } = await import("../lib/wallet-kit");
      const address = await connectWithKit();

      expect(address).toBe("GCONNECTED123");
      expect(mockStellarWalletsKit.init).toHaveBeenCalled();
      expect(mockStellarWalletsKit.authModal).toHaveBeenCalled();
    });

    it("should propagate errors from authModal", async () => {
      mockStellarWalletsKit.authModal.mockRejectedValue(new Error("User cancelled"));

      const { connectWithKit } = await import("../lib/wallet-kit");
      await expect(connectWithKit()).rejects.toThrow("User cancelled");
    });

    it("should handle authModal returning undefined address", async () => {
      mockStellarWalletsKit.authModal.mockResolvedValue({
        address: undefined,
      });

      const { connectWithKit } = await import("../lib/wallet-kit");
      const address = await connectWithKit();

      expect(address).toBeUndefined();
    });
  });

  describe("signWithKit", () => {
    it("should sign transaction and return signed XDR", async () => {
      mockStellarWalletsKit.signTransaction.mockResolvedValue({
        signedTxXdr: "signed-xdr-123",
      });

      const { signWithKit } = await import("../lib/wallet-kit");
      const signedXdr = await signWithKit("unsigned-xdr");

      expect(signedXdr).toBe("signed-xdr-123");
      expect(mockStellarWalletsKit.signTransaction).toHaveBeenCalledWith("unsigned-xdr", undefined);
    });

    it("should pass options to signTransaction", async () => {
      mockStellarWalletsKit.signTransaction.mockResolvedValue({
        signedTxXdr: "signed-xdr-456",
      });

      const { signWithKit } = await import("../lib/wallet-kit");
      const opts = {
        networkPassphrase: "Test SDF Network ; September 2015",
        address: "GSIGNER123",
      };
      const signedXdr = await signWithKit("unsigned-xdr", opts);

      expect(signedXdr).toBe("signed-xdr-456");
      expect(mockStellarWalletsKit.signTransaction).toHaveBeenCalledWith("unsigned-xdr", opts);
    });

    it("should propagate signing errors", async () => {
      mockStellarWalletsKit.signTransaction.mockRejectedValue(new Error("Signing failed"));

      const { signWithKit } = await import("../lib/wallet-kit");
      await expect(signWithKit("unsigned-xdr")).rejects.toThrow("Signing failed");
    });

    it("should handle empty XDR string", async () => {
      mockStellarWalletsKit.signTransaction.mockResolvedValue({
        signedTxXdr: "",
      });

      const { signWithKit } = await import("../lib/wallet-kit");
      const signedXdr = await signWithKit("");

      expect(signedXdr).toBe("");
    });
  });

  describe("disconnectKit", () => {
    it("should call disconnect on StellarWalletsKit", async () => {
      mockStellarWalletsKit.disconnect.mockResolvedValue(undefined);

      const { disconnectKit } = await import("../lib/wallet-kit");
      await disconnectKit();

      expect(mockStellarWalletsKit.disconnect).toHaveBeenCalled();
    });

    it("should propagate disconnect errors", async () => {
      mockStellarWalletsKit.disconnect.mockRejectedValue(new Error("Disconnect failed"));

      const { disconnectKit } = await import("../lib/wallet-kit");
      await expect(disconnectKit()).rejects.toThrow("Disconnect failed");
    });

    it("should handle multiple disconnect calls", async () => {
      mockStellarWalletsKit.disconnect.mockResolvedValue(undefined);

      const { disconnectKit } = await import("../lib/wallet-kit");
      await disconnectKit();
      await disconnectKit();

      expect(mockStellarWalletsKit.disconnect).toHaveBeenCalledTimes(2);
    });
  });

  describe("integration scenarios", () => {
    it("should handle full connect-sign-disconnect flow", async () => {
      mockStellarWalletsKit.authModal.mockResolvedValue({
        address: "GUSER123",
      });
      mockStellarWalletsKit.signTransaction.mockResolvedValue({
        signedTxXdr: "signed-xdr",
      });
      mockStellarWalletsKit.disconnect.mockResolvedValue(undefined);

      const { connectWithKit, signWithKit, disconnectKit } = await import("../lib/wallet-kit");

      const address = await connectWithKit();
      expect(address).toBe("GUSER123");

      const signedXdr = await signWithKit("unsigned-xdr");
      expect(signedXdr).toBe("signed-xdr");

      await disconnectKit();
      expect(mockStellarWalletsKit.disconnect).toHaveBeenCalled();
    });

    it("should allow signing multiple transactions in one session", async () => {
      mockStellarWalletsKit.authModal.mockResolvedValue({
        address: "GUSER123",
      });
      mockStellarWalletsKit.signTransaction
        .mockResolvedValueOnce({ signedTxXdr: "signed-1" })
        .mockResolvedValueOnce({ signedTxXdr: "signed-2" })
        .mockResolvedValueOnce({ signedTxXdr: "signed-3" });

      const { connectWithKit, signWithKit } = await import("../lib/wallet-kit");

      await connectWithKit();
      const signed1 = await signWithKit("xdr-1");
      const signed2 = await signWithKit("xdr-2");
      const signed3 = await signWithKit("xdr-3");

      expect(signed1).toBe("signed-1");
      expect(signed2).toBe("signed-2");
      expect(signed3).toBe("signed-3");
      expect(mockStellarWalletsKit.signTransaction).toHaveBeenCalledTimes(3);
    });
  });
});
