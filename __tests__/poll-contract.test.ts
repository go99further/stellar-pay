import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpcServer = {
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
  getEvents: vi.fn(),
};

const mockAccount = {
  accountId: () => "GTEST123",
  sequenceNumber: () => "123456789",
  incrementSequenceNumber: () => {},
};

const mockContract = {
  call: vi.fn(),
};

const mockTransactionBuilder = {
  addOperation: vi.fn().mockReturnThis(),
  setTimeout: vi.fn().mockReturnThis(),
  build: vi.fn(() => ({ toXDR: () => "mock-xdr" })),
};

class MockRpcServer {
  constructor() {
    return mockRpcServer;
  }
}

class MockContract {
  constructor() {
    return mockContract;
  }
}

class MockTransactionBuilder {
  constructor() {
    return mockTransactionBuilder;
  }
  static fromXDR = vi.fn(() => "mock-tx");
}

const mockNetworks = { TESTNET: "Test SDF Network ; September 2015" };

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: MockRpcServer,
    Api: {
      isSimulationError: vi.fn(),
    },
    assembleTransaction: vi.fn(),
  },
  Contract: MockContract,
  TransactionBuilder: MockTransactionBuilder,
  Networks: mockNetworks,
  scValToNative: vi.fn(),
  nativeToScVal: vi.fn((val) => val),
}));

describe("poll-contract", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
    process.env.NEXT_PUBLIC_CONTRACT_ID = "CTEST123";

    mockRpcServer.getAccount.mockResolvedValue(mockAccount);
  });

  describe("getRpcServer", () => {
    it("should return the RPC server instance", async () => {
      const { getRpcServer } = await import("../lib/poll-contract");
      const server = getRpcServer();
      expect(server).toBeDefined();
    });
  });

  describe("getContractId", () => {
    it("should return the contract ID from env", async () => {
      const { getContractId } = await import("../lib/poll-contract");
      const contractId = getContractId();
      expect(contractId).toBe("CTEST123");
    });

    it("should return empty string when env var not set", async () => {
      vi.resetModules();
      delete process.env.NEXT_PUBLIC_CONTRACT_ID;
      const { getContractId } = await import("../lib/poll-contract");
      const contractId = getContractId();
      expect(contractId).toBe("");
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CTEST123";
    });
  });

  describe("readPollQuestion", () => {
    it("should return poll question on successful simulation", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue("What is your favorite color?");

      const { readPollQuestion } = await import("../lib/poll-contract");
      const question = await readPollQuestion("GTEST123");

      expect(question).toBe("What is your favorite color?");
      expect(mockRpcServer.getAccount).toHaveBeenCalledWith("GTEST123");
      expect(mockContract.call).toHaveBeenCalledWith("get_question");
    });

    it("should throw error on simulation failure", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);

      const { readPollQuestion } = await import("../lib/poll-contract");
      await expect(readPollQuestion("GTEST123")).rejects.toThrow("Failed to read poll question");
    });

    it("should return default message when no result", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: null,
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);

      const { readPollQuestion } = await import("../lib/poll-contract");
      const question = await readPollQuestion("GTEST123");

      expect(question).toBe("No poll active");
    });
  });

  describe("readPollOptions", () => {
    it("should return poll options on successful simulation", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue(["Red", "Blue", "Green"]);

      const { readPollOptions } = await import("../lib/poll-contract");
      const options = await readPollOptions("GTEST123");

      expect(options).toEqual(["Red", "Blue", "Green"]);
      expect(mockContract.call).toHaveBeenCalledWith("get_options");
    });

    it("should return empty array on simulation error", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);

      const { readPollOptions } = await import("../lib/poll-contract");
      const options = await readPollOptions("GTEST123");

      expect(options).toEqual([]);
    });

    it("should return empty array when no result", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: null,
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);

      const { readPollOptions } = await import("../lib/poll-contract");
      const options = await readPollOptions("GTEST123");

      expect(options).toEqual([]);
    });
  });

  describe("readPollVotes", () => {
    it("should return vote counts as Map", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      const mockMap = new Map([[0, 5], [1, 10], [2, 3]]);
      (StellarSdk.scValToNative as any).mockReturnValue(mockMap);

      const { readPollVotes } = await import("../lib/poll-contract");
      const votes = await readPollVotes("GTEST123");

      expect(votes).toBeInstanceOf(Map);
      expect(votes.get(0)).toBe(5);
      expect(votes.get(1)).toBe(10);
      expect(votes.get(2)).toBe(3);
    });

    it("should convert object to Map when native returns object", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue({ "0": 5, "1": 10 });

      const { readPollVotes } = await import("../lib/poll-contract");
      const votes = await readPollVotes("GTEST123");

      expect(votes).toBeInstanceOf(Map);
      expect(votes.get(0)).toBe(5);
      expect(votes.get(1)).toBe(10);
    });

    it("should return empty Map on simulation error", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);

      const { readPollVotes } = await import("../lib/poll-contract");
      const votes = await readPollVotes("GTEST123");

      expect(votes).toBeInstanceOf(Map);
      expect(votes.size).toBe(0);
    });
  });

  describe("readTotalVotes", () => {
    it("should return total vote count", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue(42);

      const { readTotalVotes } = await import("../lib/poll-contract");
      const total = await readTotalVotes("GTEST123");

      expect(total).toBe(42);
      expect(mockContract.call).toHaveBeenCalledWith("get_total_votes");
    });

    it("should return 0 on simulation error", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);

      const { readTotalVotes } = await import("../lib/poll-contract");
      const total = await readTotalVotes("GTEST123");

      expect(total).toBe(0);
    });
  });

  describe("checkHasVoted", () => {
    it("should return true when address has voted", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue(true);
      (StellarSdk.nativeToScVal as any).mockReturnValue((val: any) => val);

      const { checkHasVoted } = await import("../lib/poll-contract");
      const hasVoted = await checkHasVoted("GTEST123", "GVOTER");

      expect(hasVoted).toBe(true);
    });

    it("should return false when address has not voted", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.scValToNative as any).mockReturnValue(false);
      (StellarSdk.nativeToScVal as any).mockReturnValue((val: any) => val);

      const { checkHasVoted } = await import("../lib/poll-contract");
      const hasVoted = await checkHasVoted("GTEST123", "GVOTER");

      expect(hasVoted).toBe(false);
    });

    it("should return false on simulation error", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);
      (StellarSdk.nativeToScVal as any).mockReturnValue((val: any) => val);

      const { checkHasVoted } = await import("../lib/poll-contract");
      const hasVoted = await checkHasVoted("GTEST123", "GVOTER");

      expect(hasVoted).toBe(false);
    });
  });

  describe("buildVoteTransaction", () => {
    it("should build and return transaction XDR", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.simulateTransaction.mockResolvedValue({
        result: { retval: "mock-retval" },
      });
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarSdk.nativeToScVal as any).mockReturnValue((val: any) => val);
      (StellarSdk.rpc.assembleTransaction as any).mockReturnValue({
        build: () => ({ toXDR: () => "prepared-xdr" }),
      });

      const { buildVoteTransaction } = await import("../lib/poll-contract");
      const xdr = await buildVoteTransaction("GVOTER", 1);

      expect(xdr).toBe("prepared-xdr");
    });

    it("should throw error on simulation failure", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      (StellarSdk.rpc.Api.isSimulationError as any).mockReturnValue(true);
      mockRpcServer.simulateTransaction.mockResolvedValue({
        error: "Simulation failed",
      });
      (StellarSdk.nativeToScVal as any).mockReturnValue((val: any) => val);

      const { buildVoteTransaction } = await import("../lib/poll-contract");
      await expect(buildVoteTransaction("GVOTER", 1)).rejects.toThrow("Simulation failed");
    });
  });

  describe("submitTransaction", () => {
    it("should submit transaction and return hash and status", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "tx-hash-123",
      });
      mockRpcServer.getTransaction.mockResolvedValue({
        status: "SUCCESS",
      });
      (StellarSdk.TransactionBuilder.fromXDR as any).mockReturnValue("mock-tx");

      const { submitTransaction } = await import("../lib/poll-contract");
      const result = await submitTransaction("signed-xdr");

      expect(result.hash).toBe("tx-hash-123");
      expect(result.status).toBe("SUCCESS");
      expect(mockRpcServer.sendTransaction).toHaveBeenCalledWith("mock-tx");
    });

    it("should throw error when submission fails", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "ERROR",
        errorResult: { code: "tx_failed" },
      });
      (StellarSdk.TransactionBuilder.fromXDR as any).mockReturnValue("mock-tx");

      const { submitTransaction } = await import("../lib/poll-contract");
      await expect(submitTransaction("signed-xdr")).rejects.toThrow("Transaction submission failed");
    });

    it("should poll until transaction is found", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "tx-hash-123",
      });
      mockRpcServer.getTransaction
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValueOnce({ status: "SUCCESS" });
      (StellarSdk.TransactionBuilder.fromXDR as any).mockReturnValue("mock-tx");

      vi.useFakeTimers();
      const { submitTransaction } = await import("../lib/poll-contract");
      const promise = submitTransaction("signed-xdr");

      await vi.advanceTimersByTimeAsync(4000);
      const result = await promise;

      expect(result.status).toBe("SUCCESS");
      expect(mockRpcServer.getTransaction).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it("should throw error when transaction fails on-chain", async () => {
      const StellarSdk = await import("@stellar/stellar-sdk");
      mockRpcServer.sendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "tx-hash-123",
      });
      mockRpcServer.getTransaction.mockResolvedValue({
        status: "FAILED",
      });
      (StellarSdk.TransactionBuilder.fromXDR as any).mockReturnValue("mock-tx");

      const { submitTransaction } = await import("../lib/poll-contract");
      await expect(submitTransaction("signed-xdr")).rejects.toThrow("Transaction failed on-chain");
    });
  });

  describe("fetchContractEvents", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_CONTRACT_ID = "CTEST123";
    });

    it("should fetch events successfully", async () => {
      vi.resetModules();
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 1000 });
      mockRpcServer.getEvents.mockResolvedValue({
        events: [{ id: "event1" }, { id: "event2" }],
      });

      const { fetchContractEvents } = await import("../lib/poll-contract");
      const result = await fetchContractEvents(500);

      expect(result.events).toHaveLength(2);
      expect(result.latestLedger).toBe(1000);
      expect(mockRpcServer.getEvents).toHaveBeenCalledWith({
        startLedger: 500,
        filters: [{ type: "contract", contractIds: ["CTEST123"] }],
        limit: 20,
      });
    });

    it("should use default start ledger when not provided", async () => {
      vi.resetModules();
      mockRpcServer.getLatestLedger.mockResolvedValue({ sequence: 1500 });
      mockRpcServer.getEvents.mockResolvedValue({ events: [] });

      const { fetchContractEvents } = await import("../lib/poll-contract");
      await fetchContractEvents();

      expect(mockRpcServer.getEvents).toHaveBeenCalledWith({
        startLedger: 500,
        filters: [{ type: "contract", contractIds: ["CTEST123"] }],
        limit: 20,
      });
    });

    it("should return empty result on error", async () => {
      vi.resetModules();
      mockRpcServer.getLatestLedger.mockRejectedValue(new Error("Network error"));

      const { fetchContractEvents } = await import("../lib/poll-contract");
      const result = await fetchContractEvents();

      expect(result.events).toEqual([]);
      expect(result.latestLedger).toBe(0);
    });
  });
});
