import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTx = {
  sign: vi.fn(),
  toXDR: vi.fn(() => "AAAA...XDR"),
  hash: vi.fn(() => Buffer.from("dead", "hex")),
};

const mockBuilder = {
  addOperation: vi.fn().mockReturnThis(),
  addMemo: vi.fn().mockReturnThis(),
  setTimeout: vi.fn().mockReturnThis(),
  build: vi.fn(() => mockTx),
};

vi.mock("@stellar/stellar-sdk", () => {
  return {
    Account: vi.fn(),
    Asset: vi.fn(),
    Horizon: {
      Server: vi.fn().mockImplementation(function () {
        return {
          loadAccount: vi.fn(),
          submitTransaction: vi.fn(),
        };
      }),
    },
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({ rawPublicKey: vi.fn(() => Buffer.alloc(32)) }),
      fromPublicKey: vi.fn().mockReturnValue({ rawPublicKey: vi.fn(() => Buffer.alloc(32)) }),
    },
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
    },
    Operation: {
      invokeContractFunction: vi.fn(() => ({ type: "invokeContractFunction" })),
    },
    Transaction: vi.fn().mockImplementation(function () {
      return mockTx;
    }),
    TransactionBuilder: vi.fn().mockImplementation(function () {
      return mockBuilder;
    }),
    BASE_FEE: "100",
    Memo: {
      text: vi.fn((t: string) => ({ type: "text", value: t })),
    },
    xdr: {
      ScVal: { scvAddress: vi.fn(() => ({ type: "scvAddress" })) },
      ScAddress: { scAddressTypeAccount: vi.fn(() => ({ type: "account" })) },
      PublicKey: { publicKeyTypeEd25519: vi.fn(() => ({ type: "ed25519" })) },
      Int128Parts: vi.fn().mockImplementation(function (v: unknown) { return v; }),
      Int64: { fromString: vi.fn((s: string) => s) },
      Uint64: { fromString: vi.fn((s: string) => s) },
    },
  };
});

import { TransactionBuilder } from "../lib/web3/transaction-builder";
import { Horizon, Networks } from "@stellar/stellar-sdk";

function getLastServerMock() {
  const calls = vi.mocked(Horizon.Server).mock.results;
  return calls[calls.length - 1].value as {
    loadAccount: ReturnType<typeof vi.fn>;
    submitTransaction: ReturnType<typeof vi.fn>;
  };
}

describe("TransactionBuilder", () => {
  let builder: TransactionBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new TransactionBuilder();
  });

  describe("constructor", () => {
    it("uses testnet defaults", () => {
      const info = builder.getNetworkInfo();
      expect(info.isTestnet).toBe(true);
      expect(info.horizonUrl).toBe("https://horizon-testnet.stellar.org");
    });

    it("accepts custom config", () => {
      const b = new TransactionBuilder({
        horizonUrl: "https://horizon.stellar.org",
        networkPassphrase: Networks.PUBLIC,
      });
      const info = b.getNetworkInfo();
      expect(info.isTestnet).toBe(false);
      expect(info.horizonUrl).toBe("https://horizon.stellar.org");
    });
  });

  describe("buildTransaction", () => {
    it("loads account and builds transaction", async () => {
      const mockAccount = { id: "GADDR", sequence: "1" };
      getLastServerMock().loadAccount.mockResolvedValue(mockAccount);

      const tx = await builder.buildTransaction({
        sourceAddress: "GADDR",
        operations: [],
      });

      expect(getLastServerMock().loadAccount).toHaveBeenCalledWith("GADDR");
      expect(mockBuilder.build).toHaveBeenCalled();
      expect(tx).toBe(mockTx);
    });

    it("adds memo when provided", async () => {
      getLastServerMock().loadAccount.mockResolvedValue({ id: "GADDR", sequence: "1" });

      await builder.buildTransaction({
        sourceAddress: "GADDR",
        operations: [],
        memo: "test memo",
      });

      expect(mockBuilder.addMemo).toHaveBeenCalled();
    });

    it("does not add memo when not provided", async () => {
      getLastServerMock().loadAccount.mockResolvedValue({ id: "GADDR", sequence: "1" });

      await builder.buildTransaction({
        sourceAddress: "GADDR",
        operations: [],
      });

      expect(mockBuilder.addMemo).not.toHaveBeenCalled();
    });
  });

  describe("signTransaction", () => {
    it("signs transaction and returns xdr + hash", () => {
      const result = builder.signTransaction(
        mockTx as unknown as import("@stellar/stellar-sdk").Transaction,
        "SXXXXX"
      );
      expect(result.xdr).toBe("AAAA...XDR");
      expect(typeof result.hash).toBe("string");
      expect(result.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });
  });

  describe("submitTransaction", () => {
    it("returns successful result on success", async () => {
      getLastServerMock().submitTransaction.mockResolvedValue({
        successful: true,
        hash: "abc123",
        ledger: 42,
      });

      const result = await builder.submitTransaction("AAAA...XDR");
      expect(result.successful).toBe(true);
      expect(result.hash).toBe("abc123");
      expect(result.ledger).toBe(42);
    });

    it("returns error result on failure", async () => {
      getLastServerMock().submitTransaction.mockRejectedValue(new Error("tx failed"));

      const result = await builder.submitTransaction("AAAA...XDR");
      expect(result.successful).toBe(false);
      expect(result.error).toBe("tx failed");
    });
  });

  describe("simulateTransaction", () => {
    it("returns not-supported message", async () => {
      const result = await builder.simulateTransaction(
        mockTx as unknown as import("@stellar/stellar-sdk").Transaction
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("rpc");
    });
  });

  describe("estimateFee", () => {
    it("returns base fee", async () => {
      const fee = await builder.estimateFee(
        mockTx as unknown as import("@stellar/stellar-sdk").Transaction
      );
      expect(fee).toBe("100");
    });
  });

  describe("updateConfig", () => {
    it("updates network passphrase", () => {
      builder.updateConfig({ networkPassphrase: Networks.PUBLIC });
      expect(builder.getNetworkInfo().isTestnet).toBe(false);
    });
  });
});


describe("TransactionBuilder — additional coverage", () => {
  it("transactionBuilder should be a shared instance", async () => {
    const { transactionBuilder } = await import("../lib/web3/transaction-builder");
    expect(transactionBuilder).toBeInstanceOf(TransactionBuilder);
  });

  it("createMainnetBuilder should return a TransactionBuilder for mainnet", async () => {
    const { createMainnetBuilder } = await import("../lib/web3/transaction-builder");
    const mb = createMainnetBuilder();
    expect(mb).toBeInstanceOf(TransactionBuilder);
    expect(mb.getNetworkInfo().isTestnet).toBe(false);
    expect(mb.getNetworkInfo().networkPassphrase).toContain("Public Global Stellar");
  });
});
