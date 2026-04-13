import { describe, it, expect } from "vitest";
import {
  classifyError,
  WalletNotFoundError,
  TransactionRejectedError,
  InsufficientBalanceError,
  getErrorDisplay,
} from "@/lib/errors";

describe("Error Classification", () => {
  it("classifies wallet not found errors", () => {
    const err = classifyError(new Error("Freighter extension not found"));
    expect(err).toBeInstanceOf(WalletNotFoundError);
    expect(err.name).toBe("WalletNotFoundError");
  });

  it("classifies transaction rejected errors", () => {
    const err = classifyError(new Error("User rejected the transaction"));
    expect(err).toBeInstanceOf(TransactionRejectedError);
    expect(err.name).toBe("TransactionRejectedError");
  });

  it("classifies insufficient balance errors", () => {
    const err = classifyError(new Error("insufficient balance for operation"));
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(err.name).toBe("InsufficientBalanceError");
  });

  it("returns original error for unknown types", () => {
    const original = new Error("something random happened");
    const err = classifyError(original);
    expect(err).toBe(original);
    expect(err).not.toBeInstanceOf(WalletNotFoundError);
    expect(err).not.toBeInstanceOf(TransactionRejectedError);
    expect(err).not.toBeInstanceOf(InsufficientBalanceError);
  });

  it("handles string errors", () => {
    const err = classifyError("wallet not installed");
    expect(err).toBeInstanceOf(WalletNotFoundError);
  });

  it("getErrorDisplay returns correct type for each error", () => {
    expect(getErrorDisplay(new WalletNotFoundError()).type).toBe("wallet");
    expect(getErrorDisplay(new TransactionRejectedError()).type).toBe("rejected");
    expect(getErrorDisplay(new InsufficientBalanceError()).type).toBe("balance");
    expect(getErrorDisplay(new Error("unknown")).type).toBe("unknown");
  });
});
