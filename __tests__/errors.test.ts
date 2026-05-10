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

import { SlippageError, InsufficientLiquidityError } from "../lib/errors";

describe("SlippageError", () => {
  it("should have correct name and message", () => {
    const err = new SlippageError("5%", "3%");
    expect(err.name).toBe("SlippageError");
    expect(err.message).toContain("5%");
    expect(err.message).toContain("3%");
  });

  it("should work without arguments", () => {
    const err = new SlippageError();
    expect(err.name).toBe("SlippageError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("InsufficientLiquidityError", () => {
  it("should have correct name", () => {
    const err = new InsufficientLiquidityError();
    expect(err.name).toBe("InsufficientLiquidityError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("getErrorDisplay — additional cases", () => {
  it("should return slippage type for SlippageError", () => {
    const display = getErrorDisplay(new SlippageError("5%", "3%"));
    expect(display.type).toBe("slippage");
  });

  it("should return liquidity type for InsufficientLiquidityError", () => {
    const display = getErrorDisplay(new InsufficientLiquidityError());
    expect(display.type).toBe("liquidity");
  });
});
