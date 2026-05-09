/**
 * Comprehensive error recovery and user-friendly error messages for the agent.
 * Handles edge cases gracefully with helpful error messages and recovery suggestions.
 */

import {
  WalletNotFoundError,
  TransactionRejectedError,
  InsufficientBalanceError,
  SlippageError,
  InsufficientLiquidityError,
} from "@/lib/errors";

export interface ErrorRecovery {
  error: Error;
  userMessage: string;
  suggestion: string;
  retryable: boolean;
  actionLabel?: string;
  actionUrl?: string;
}

/**
 * Classify and enhance errors with user-friendly messages and recovery suggestions.
 */
export function handleAgentError(err: unknown): ErrorRecovery {
  const error = err instanceof Error ? err : new Error(String(err));
  const message = error.message.toLowerCase();

  // 1. Insufficient XLM for transaction fees
  if (
    message.includes("insufficient") &&
    (message.includes("xlm") || message.includes("native") || message.includes("fee"))
  ) {
    return {
      error,
      userMessage: "You need at least 1 XLM for transaction fees.",
      suggestion:
        "Visit Friendbot to get testnet XLM, or check your XLM balance. Transaction fees on Stellar are very low but required.",
      retryable: false,
      actionLabel: "Get Testnet XLM",
      actionUrl: "https://laboratory.stellar.org/#account-creator?network=test",
    };
  }

  // 2. Insufficient token balance (TKNA, TKNB)
  if (error instanceof InsufficientBalanceError || message.includes("insufficient balance")) {
    const tokenMatch = message.match(/tkna|tknb/i);
    const token = tokenMatch ? tokenMatch[0].toUpperCase() : "tokens";
    return {
      error,
      userMessage: `You don't have enough ${token} for this transaction.`,
      suggestion: `Check your ${token} balance and reduce the amount, or add liquidity to get more tokens.`,
      retryable: false,
    };
  }

  // 3. Slippage exceeded
  if (error instanceof SlippageError || message.includes("slippage")) {
    return {
      error,
      userMessage: "Price moved beyond your slippage tolerance.",
      suggestion:
        "Try increasing slippage to 1.5% or 2%, split into smaller trades, or wait for better market conditions.",
      retryable: true,
    };
  }

  // 4. Insufficient liquidity
  if (
    error instanceof InsufficientLiquidityError ||
    message.includes("no liquidity") ||
    message.includes("pool is empty") ||
    message.includes("zero output")
  ) {
    return {
      error,
      userMessage: "The pool doesn't have enough liquidity for this trade.",
      suggestion:
        "Try a smaller amount, add liquidity to the pool first, or check the pool reserves.",
      retryable: false,
    };
  }

  // 5. Freighter not installed
  if (error instanceof WalletNotFoundError || message.includes("freighter")) {
    return {
      error,
      userMessage: "Freighter wallet not detected.",
      suggestion: "Please install the Freighter browser extension and refresh the page.",
      retryable: false,
      actionLabel: "Install Freighter",
      actionUrl: "https://www.freighter.app/",
    };
  }

  // 6. Transaction rejected by user
  if (error instanceof TransactionRejectedError || message.includes("rejected")) {
    return {
      error,
      userMessage: "Transaction was cancelled.",
      suggestion: "No funds were moved. You can try again when ready.",
      retryable: true,
    };
  }

  // 7. Network timeout
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network error") ||
    message.includes("fetch failed")
  ) {
    return {
      error,
      userMessage: "Stellar network timeout.",
      suggestion: "The network is slow or unavailable. Retrying automatically...",
      retryable: true,
    };
  }

  // 8. RPC node errors
  if (
    message.includes("rpc") ||
    message.includes("soroban") ||
    message.includes("horizon") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500")
  ) {
    return {
      error,
      userMessage: "Stellar RPC node error.",
      suggestion:
        "The Stellar network node is temporarily unavailable. This usually resolves in a few seconds. Retrying...",
      retryable: true,
    };
  }

  // 9. Contract errors (from parseContractError)
  if (message.includes("amount_in must be positive")) {
    return {
      error,
      userMessage: "Input amount must be greater than 0.",
      suggestion: "Please specify a positive amount to trade.",
      retryable: false,
    };
  }

  if (message.includes("token_in is not tokena or tokenb")) {
    return {
      error,
      userMessage: "Unsupported token type.",
      suggestion: "This pool only supports TKNA and TKNB tokens.",
      retryable: false,
    };
  }

  // 10. Wallet connection errors
  if (
    message.includes("not connected") ||
    message.includes("no wallet") ||
    message.includes("connect wallet")
  ) {
    return {
      error,
      userMessage: "Wallet not connected.",
      suggestion: "Please connect your Freighter wallet to continue.",
      retryable: false,
    };
  }

  // 11. Transaction simulation errors
  if (message.includes("simulation failed") || message.includes("simulate")) {
    return {
      error,
      userMessage: "Transaction simulation failed.",
      suggestion:
        "The transaction would fail on-chain. Check your balance, slippage settings, and pool liquidity.",
      retryable: false,
    };
  }

  // 12. Rate limiting
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return {
      error,
      userMessage: "Rate limit exceeded.",
      suggestion: "Too many requests. Please wait a moment before trying again.",
      retryable: true,
    };
  }

  // 13. Account not found (not funded)
  if (message.includes("account not found") || message.includes("not funded")) {
    return {
      error,
      userMessage: "Account not found on Stellar network.",
      suggestion:
        "Your account needs to be funded with at least 1 XLM. Visit Friendbot to activate your testnet account.",
      retryable: false,
      actionLabel: "Activate Account",
      actionUrl: "https://laboratory.stellar.org/#account-creator?network=test",
    };
  }

  // Default: unknown error
  return {
    error,
    userMessage: "An unexpected error occurred.",
    suggestion: error.message || "Please try again or contact support if the issue persists.",
    retryable: false,
  };
}

/**
 * Retry logic with exponential backoff for retryable errors.
 */
export async function withErrorRecovery<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: ErrorRecovery) => void;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, initialDelay = 1000, maxDelay = 10000, onRetry } = options;

  let lastError: ErrorRecovery | null = null;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const recovery = handleAgentError(err);
      lastError = recovery;

      // If not retryable or last attempt, throw
      if (!recovery.retryable || attempt === maxAttempts) {
        throw recovery;
      }

      // Notify caller of retry
      if (onRetry) {
        onRetry(attempt, recovery);
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error("Unknown error in withErrorRecovery");
}

/**
 * Format error for display in UI.
 */
export function formatErrorForDisplay(recovery: ErrorRecovery): {
  title: string;
  message: string;
  suggestion: string;
  action?: { label: string; url: string };
} {
  return {
    title: recovery.error.name || "Error",
    message: recovery.userMessage,
    suggestion: recovery.suggestion,
    action:
      recovery.actionLabel && recovery.actionUrl
        ? { label: recovery.actionLabel, url: recovery.actionUrl }
        : undefined,
  };
}

/**
 * Check if an error is a network/transient error that should trigger auto-retry.
 */
export function isTransientError(err: unknown): boolean {
  const recovery = handleAgentError(err);
  const message = recovery.error.message.toLowerCase();
  return (
    recovery.retryable &&
    (message.includes("timeout") ||
      message.includes("network") ||
      message.includes("rpc") ||
      message.includes("503") ||
      message.includes("502"))
  );
}
