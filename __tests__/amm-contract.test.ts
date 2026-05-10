import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock variables declared outside the factory so tests can configure them
const mockGetAccount = vi.fn();
const mockSimulateTransaction = vi.fn();
const mockSendTransaction = vi.fn();
const mockGetTransaction = vi.fn();
const mockContractCall = vi.fn();
const mockTransactionBuilderBuild = vi.fn();
const mockAddOperation = vi.fn();
const mockSetTimeout = vi.fn();
const mockToXDR = vi.fn();
const mockFromXDR = vi.fn();

// Mock cache
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheInvalidate = vi.fn();

vi.mock("@stellar/stellar-sdk", () => {
  const mockTransactionBuilder = class {
    constructor(account: any, options: any) {}
    addOperation(...args: any[]) {
      mockAddOperation(...args);
      return this;
    }
    setTimeout(...args: any[]) {
      mockSetTimeout(...args);
      return this;
    }
    build() {
      return mockTransactionBuilderBuild();
    }
    static fromXDR(...args: any[]) {
      return mockFromXDR(...args);
    }
  };

  return {
    rpc: {
      Server: class {
        getAccount(...args: any[]) {
          return mockGetAccount(...args);
        }
        simulateTransaction(...args: any[]) {
          return mockSimulateTransaction(...args);
        }
        sendTransaction(...args: any[]) {
          return mockSendTransaction(...args);
        }
        getTransaction(...args: any[]) {
          return mockGetTransaction(...args);
        }
      },
      Api: {
        isSimulationError: (result: any) => result && result.error !== undefined,
      },
      assembleTransaction: vi.fn((tx: any, simResult: any) => ({
        build: () => ({ toXDR: mockToXDR }),
      })),
    },
    Contract: class {
      constructor(contractId: string) {}
      call(...args: any[]) {
        return mockContractCall(...args);
      }
    },
    TransactionBuilder: mockTransactionBuilder,
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
    },
    nativeToScVal: vi.fn((val: any, opts?: any) => ({ type: "scval", val, opts })),
    scValToNative: vi.fn((scVal: any) => scVal.nativeValue),
    xdr: {
      ScVal: class {},
    },
  };
});

vi.mock("../lib/cache", () => ({
  cache: {
    get: mockCacheGet,
    set: mockCacheSet,
    invalidate: mockCacheInvalidate,
  },
  CACHE_KEYS: {
    AMM_RESERVES: "amm:reserves",
    AMM_PRICE: (tokenIn: string, amount: string) => `amm:price:${tokenIn}:${amount}`,
    LP_BALANCE: (addr: string) => `amm:lp:${addr}`,
    LP_SUPPLY: "amm:lp:supply",
  },
  CACHE_TTL: {
    AMM_RESERVES: 10_000,
    AMM_PRICE: 5_000,
    LP_BALANCE: 10_000,
    LP_SUPPLY: 10_000,
  },
}));

describe("amm-contract", () => {
  let ammContract: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set env vars before importing
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://test-rpc.stellar.org";
    process.env.NEXT_PUBLIC_AMM_CONTRACT_ID = "CAMM123";
    process.env.NEXT_PUBLIC_LP_TOKEN_ID = "CLP456";
    process.env.NEXT_PUBLIC_TOKEN_A_ID = "CTOKENA";
    process.env.NEXT_PUBLIC_TOKEN_B_ID = "CTOKENB";

    // Dynamic import after env vars are set
    ammContract = await import("../lib/amm-contract");
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
    delete process.env.NEXT_PUBLIC_AMM_CONTRACT_ID;
    delete process.env.NEXT_PUBLIC_LP_TOKEN_ID;
    delete process.env.NEXT_PUBLIC_TOKEN_A_ID;
    delete process.env.NEXT_PUBLIC_TOKEN_B_ID;
  });

  describe("Config getters", () => {
    it("should return AMM contract ID", () => {
      expect(ammContract.getAmmContractId()).toBe("CAMM123");
    });

    it("should return Token A ID", () => {
      expect(ammContract.getTokenAId()).toBe("CTOKENA");
    });

    it("should return Token B ID", () => {
      expect(ammContract.getTokenBId()).toBe("CTOKENB");
    });

    it("should return LP token ID", () => {
      expect(ammContract.getLpTokenId()).toBe("CLP456");
    });
  });

  describe("getReserves", () => {
    const callerPublicKey = "GTEST123";

    it("should return cached reserves if available", async () => {
      mockCacheGet.mockReturnValue([1000n, 2000n]);

      const result = await ammContract.getReserves(callerPublicKey);

      expect(result).toEqual([1000n, 2000n]);
      expect(mockCacheGet).toHaveBeenCalledWith("amm:reserves");
      expect(mockGetAccount).not.toHaveBeenCalled();
    });

    it("should fetch and cache reserves on cache miss", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: ["5000", "10000"] },
        },
      });

      const result = await ammContract.getReserves(callerPublicKey);

      expect(result).toEqual([5000n, 10000n]);
      expect(mockCacheSet).toHaveBeenCalledWith("amm:reserves", [5000n, 10000n], 10_000);
    });

    it("should return [0n, 0n] on simulation error", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "simulation failed" });

      const result = await ammContract.getReserves(callerPublicKey);

      expect(result).toEqual([0n, 0n]);
      expect(mockCacheSet).not.toHaveBeenCalled();
    });

    it("should return [0n, 0n] when retval is null", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ result: null });

      const result = await ammContract.getReserves(callerPublicKey);

      expect(result).toEqual([0n, 0n]);
    });
  });

  describe("getPrice", () => {
    const callerPublicKey = "GTEST123";
    const tokenIn = "CTOKENA";
    const amountIn = 1000n;

    it("should return cached price if available", async () => {
      mockCacheGet.mockReturnValue(950n);

      const result = await ammContract.getPrice(callerPublicKey, tokenIn, amountIn);

      expect(result).toBe(950n);
      expect(mockCacheGet).toHaveBeenCalledWith(`amm:price:${tokenIn}:${amountIn}`);
      expect(mockGetAccount).not.toHaveBeenCalled();
    });

    it("should fetch and cache price on cache miss", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: "980" },
        },
      });

      const result = await ammContract.getPrice(callerPublicKey, tokenIn, amountIn);

      expect(result).toBe(980n);
      expect(mockCacheSet).toHaveBeenCalledWith(`amm:price:${tokenIn}:${amountIn}`, 980n, 5_000);
    });

    it("should return 0n on simulation error", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "price calculation failed" });

      const result = await ammContract.getPrice(callerPublicKey, tokenIn, amountIn);

      expect(result).toBe(0n);
      expect(mockCacheSet).not.toHaveBeenCalled();
    });
  });

  describe("getLpBalance", () => {
    const callerPublicKey = "GTEST123";
    const address = "GUSER456";

    it("should return cached LP balance if available", async () => {
      mockCacheGet.mockReturnValue(5000n);

      const result = await ammContract.getLpBalance(callerPublicKey, address);

      expect(result).toBe(5000n);
      expect(mockCacheGet).toHaveBeenCalledWith(`amm:lp:${address}`);
      expect(mockGetAccount).not.toHaveBeenCalled();
    });

    it("should fetch and cache LP balance on cache miss", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: "7500" },
        },
      });

      const result = await ammContract.getLpBalance(callerPublicKey, address);

      expect(result).toBe(7500n);
      expect(mockCacheSet).toHaveBeenCalledWith(`amm:lp:${address}`, 7500n, 10_000);
    });

    it("should return 0n on simulation error", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "balance query failed" });

      const result = await ammContract.getLpBalance(callerPublicKey, address);

      expect(result).toBe(0n);
    });
  });

  describe("getLpSupply", () => {
    const callerPublicKey = "GTEST123";

    it("should return cached LP supply if available", async () => {
      mockCacheGet.mockReturnValue(100000n);

      const result = await ammContract.getLpSupply(callerPublicKey);

      expect(result).toBe(100000n);
      expect(mockCacheGet).toHaveBeenCalledWith("amm:lp:supply");
      expect(mockGetAccount).not.toHaveBeenCalled();
    });

    it("should fetch and cache LP supply on cache miss", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: "250000" },
        },
      });

      const result = await ammContract.getLpSupply(callerPublicKey);

      expect(result).toBe(250000n);
      expect(mockCacheSet).toHaveBeenCalledWith("amm:lp:supply", 250000n, 10_000);
    });

    it("should return 0n on simulation error", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => callerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "supply query failed" });

      const result = await ammContract.getLpSupply(callerPublicKey);

      expect(result).toBe(0n);
    });
  });

  describe("buildSwapTransaction", () => {
    const userPublicKey = "GUSER123";
    const tokenIn = "CTOKENA";
    const amountIn = 1000n;
    const minAmountOut = 950n;

    it("should build and return swap transaction XDR", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => userPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: { nativeValue: "success" } },
      });
      mockToXDR.mockReturnValue("prepared-tx-xdr");

      const result = await ammContract.buildSwapTransaction(userPublicKey, tokenIn, amountIn, minAmountOut);

      expect(result).toBe("prepared-tx-xdr");
      expect(mockContractCall).toHaveBeenCalledWith(
        "swap",
        expect.objectContaining({ val: userPublicKey }),
        expect.objectContaining({ val: tokenIn }),
        expect.objectContaining({ val: Number(amountIn) }),
        expect.objectContaining({ val: Number(minAmountOut) })
      );
    });

    it("should throw error on simulation failure", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => userPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "insufficient liquidity" });

      await expect(
        ammContract.buildSwapTransaction(userPublicKey, tokenIn, amountIn, minAmountOut)
      ).rejects.toThrow("Simulation failed: insufficient liquidity");
    });

    it("should use correct fee and timeout", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => userPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: { nativeValue: "success" } },
      });
      mockToXDR.mockReturnValue("prepared-tx-xdr");

      await ammContract.buildSwapTransaction(userPublicKey, tokenIn, amountIn, minAmountOut);

      expect(mockSetTimeout).toHaveBeenCalledWith(60);
    });
  });

  describe("buildAddLiquidityTransaction", () => {
    const providerPublicKey = "GPROVIDER123";
    const amountA = 5000n;
    const amountB = 10000n;
    const minLp = 7000n;

    it("should build and return add liquidity transaction XDR", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => providerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: { nativeValue: "success" } },
      });
      mockToXDR.mockReturnValue("add-liq-xdr");

      const result = await ammContract.buildAddLiquidityTransaction(providerPublicKey, amountA, amountB, minLp);

      expect(result).toBe("add-liq-xdr");
      expect(mockContractCall).toHaveBeenCalledWith(
        "add_liquidity",
        expect.objectContaining({ val: providerPublicKey }),
        expect.objectContaining({ val: Number(amountA) }),
        expect.objectContaining({ val: Number(amountB) }),
        expect.objectContaining({ val: Number(minLp) })
      );
    });

    it("should throw error on simulation failure", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => providerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "invalid ratio" });

      await expect(
        ammContract.buildAddLiquidityTransaction(providerPublicKey, amountA, amountB, minLp)
      ).rejects.toThrow("Simulation failed: invalid ratio");
    });
  });

  describe("buildRemoveLiquidityTransaction", () => {
    const providerPublicKey = "GPROVIDER123";
    const lpAmount = 5000n;
    const minA = 2000n;
    const minB = 4000n;

    it("should build and return remove liquidity transaction XDR", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => providerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: { nativeValue: "success" } },
      });
      mockToXDR.mockReturnValue("remove-liq-xdr");

      const result = await ammContract.buildRemoveLiquidityTransaction(providerPublicKey, lpAmount, minA, minB);

      expect(result).toBe("remove-liq-xdr");
      expect(mockContractCall).toHaveBeenCalledWith(
        "remove_liquidity",
        expect.objectContaining({ val: providerPublicKey }),
        expect.objectContaining({ val: Number(lpAmount) }),
        expect.objectContaining({ val: Number(minA) }),
        expect.objectContaining({ val: Number(minB) })
      );
    });

    it("should throw error on simulation failure", async () => {
      mockGetAccount.mockResolvedValue({ accountId: () => providerPublicKey, sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({ error: "insufficient LP tokens" });

      await expect(
        ammContract.buildRemoveLiquidityTransaction(providerPublicKey, lpAmount, minA, minB)
      ).rejects.toThrow("Simulation failed: insufficient LP tokens");
    });
  });

  describe("submitAmmTransaction", () => {
    const signedXdr = "signed-tx-xdr";
    const txHash = "tx-hash-123";

    beforeEach(() => {
      mockFromXDR.mockReturnValue({ toXDR: () => signedXdr });
    });

    it("should submit transaction and return success result", async () => {
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });
      mockGetTransaction.mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS" });

      const result = await ammContract.submitAmmTransaction(signedXdr);

      expect(result).toEqual({ hash: txHash, status: "SUCCESS" });
      expect(mockSendTransaction).toHaveBeenCalled();
      expect(mockGetTransaction).toHaveBeenCalledWith(txHash);
      expect(mockCacheInvalidate).toHaveBeenCalledWith("amm:reserves");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("amm:lp:supply");
    });

    it("should poll until transaction is found", async () => {
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });
      mockGetTransaction
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS" });

      const result = await ammContract.submitAmmTransaction(signedXdr);

      expect(result.status).toBe("SUCCESS");
      expect(mockGetTransaction).toHaveBeenCalledTimes(4);
    }, 10000);

    it("should throw error on submission ERROR status", async () => {
      mockSendTransaction.mockResolvedValue({
        status: "ERROR",
        errorResult: { code: "tx_failed" },
      });

      await expect(ammContract.submitAmmTransaction(signedXdr)).rejects.toThrow(
        'Transaction submission failed: {"code":"tx_failed"}'
      );
    });

    it("should throw error on FAILED transaction status", async () => {
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });
      mockGetTransaction.mockResolvedValueOnce({ status: "FAILED" });

      await expect(ammContract.submitAmmTransaction(signedXdr)).rejects.toThrow("Transaction failed on-chain");
    });

    it("should handle submission error without errorResult", async () => {
      mockSendTransaction.mockResolvedValue({ status: "ERROR" });

      await expect(ammContract.submitAmmTransaction(signedXdr)).rejects.toThrow(
        "Transaction submission failed: unknown error"
      );
    });

    it("should invalidate caches after successful submission", async () => {
      mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: txHash });
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });

      await ammContract.submitAmmTransaction(signedXdr);

      expect(mockCacheInvalidate).toHaveBeenCalledWith("amm:reserves");
      expect(mockCacheInvalidate).toHaveBeenCalledWith("amm:lp:supply");
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle getReserves with empty array response", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => "GTEST", sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: ["0", "0"] },
        },
      });

      const result = await ammContract.getReserves("GTEST");

      expect(result).toEqual([0n, 0n]);
    });

    it("should handle getPrice with zero amount", async () => {
      mockCacheGet.mockReturnValue(undefined);
      mockGetAccount.mockResolvedValue({ accountId: () => "GTEST", sequenceNumber: () => "1" });
      mockTransactionBuilderBuild.mockReturnValue({ toXDR: () => "tx-xdr" });
      mockSimulateTransaction.mockResolvedValue({
        result: {
          retval: { nativeValue: "0" },
        },
      });

      const result = await ammContract.getPrice("GTEST", "CTOKENA", 0n);

      expect(result).toBe(0n);
    });

    it("should handle network errors in submitAmmTransaction", async () => {
      mockSendTransaction.mockRejectedValue(new Error("Network timeout"));

      await expect(ammContract.submitAmmTransaction("signed-xdr")).rejects.toThrow("Network timeout");
    });
  });
});
