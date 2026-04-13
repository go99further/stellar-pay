/**
 * Typed error classes for Stellar dApp
 * Covers the 3 required error types for Yellow Belt
 */

export class WalletNotFoundError extends Error {
  constructor(walletName?: string) {
    super(
      walletName
        ? `${walletName} wallet extension not found. Please install it first.`
        : "No compatible wallet extension found. Please install Freighter, xBull, or Albedo."
    );
    this.name = "WalletNotFoundError";
  }
}

export class TransactionRejectedError extends Error {
  constructor() {
    super("Transaction was rejected or cancelled by the user.");
    this.name = "TransactionRejectedError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(required?: string, available?: string) {
    const msg =
      required && available
        ? `Insufficient balance. Required: ${required} XLM, Available: ${available} XLM.`
        : "Insufficient balance to complete this transaction.";
    super(msg);
    this.name = "InsufficientBalanceError";
  }
}

/**
 * Classify an unknown error into one of our typed errors
 */
export function classifyError(err: unknown): Error {
  const message =
    err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("not found") ||
    lower.includes("not installed") ||
    lower.includes("no wallet") ||
    lower.includes("extension")
  ) {
    return new WalletNotFoundError();
  }

  if (
    lower.includes("rejected") ||
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("denied") ||
    lower.includes("user refused") ||
    lower.includes("user declined")
  ) {
    return new TransactionRejectedError();
  }

  if (
    lower.includes("insufficient") ||
    lower.includes("underfunded") ||
    lower.includes("not enough")
  ) {
    return new InsufficientBalanceError();
  }

  return err instanceof Error ? err : new Error(message);
}

/**
 * Get a user-friendly error message with icon
 */
export function getErrorDisplay(err: Error): {
  title: string;
  message: string;
  type: "wallet" | "rejected" | "balance" | "unknown";
} {
  if (err instanceof WalletNotFoundError) {
    return {
      title: "Wallet Not Found",
      message: err.message,
      type: "wallet",
    };
  }
  if (err instanceof TransactionRejectedError) {
    return {
      title: "Transaction Rejected",
      message: err.message,
      type: "rejected",
    };
  }
  if (err instanceof InsufficientBalanceError) {
    return {
      title: "Insufficient Balance",
      message: err.message,
      type: "balance",
    };
  }
  return {
    title: "Error",
    message: err.message,
    type: "unknown",
  };
}
