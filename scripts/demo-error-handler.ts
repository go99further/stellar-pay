/**
 * Demo script showing error handler capabilities
 */

import { handleAgentError } from "../lib/agent/error-handler";
import {
  WalletNotFoundError,
  TransactionRejectedError,
  InsufficientBalanceError,
  SlippageError,
} from "../lib/errors";

console.log("=== Error Handler Demo ===\n");

// 1. Insufficient XLM
console.log("1. Insufficient XLM:");
const xlmError = new Error("insufficient XLM for transaction fees");
const xlmRecovery = handleAgentError(xlmError);
console.log(`   Message: ${xlmRecovery.userMessage}`);
console.log(`   Suggestion: ${xlmRecovery.suggestion}`);
console.log(`   Retryable: ${xlmRecovery.retryable}`);
console.log(`   Action: ${xlmRecovery.actionLabel} -> ${xlmRecovery.actionUrl}\n`);

// 2. Slippage exceeded
console.log("2. Slippage Exceeded:");
const slippageError = new SlippageError();
const slippageRecovery = handleAgentError(slippageError);
console.log(`   Message: ${slippageRecovery.userMessage}`);
console.log(`   Suggestion: ${slippageRecovery.suggestion}`);
console.log(`   Retryable: ${slippageRecovery.retryable}\n`);

// 3. Wallet not found
console.log("3. Wallet Not Found:");
const walletError = new WalletNotFoundError("Freighter");
const walletRecovery = handleAgentError(walletError);
console.log(`   Message: ${walletRecovery.userMessage}`);
console.log(`   Suggestion: ${walletRecovery.suggestion}`);
console.log(`   Retryable: ${walletRecovery.retryable}`);
console.log(`   Action: ${walletRecovery.actionLabel} -> ${walletRecovery.actionUrl}\n`);

// 4. Network timeout
console.log("4. Network Timeout:");
const timeoutError = new Error("Stellar network timeout");
const timeoutRecovery = handleAgentError(timeoutError);
console.log(`   Message: ${timeoutRecovery.userMessage}`);
console.log(`   Suggestion: ${timeoutRecovery.suggestion}`);
console.log(`   Retryable: ${timeoutRecovery.retryable}\n`);

// 5. Transaction rejected
console.log("5. Transaction Rejected:");
const rejectedError = new TransactionRejectedError();
const rejectedRecovery = handleAgentError(rejectedError);
console.log(`   Message: ${rejectedRecovery.userMessage}`);
console.log(`   Suggestion: ${rejectedRecovery.suggestion}`);
console.log(`   Retryable: ${rejectedRecovery.retryable}\n`);

// 6. Insufficient balance
console.log("6. Insufficient Balance:");
const balanceError = new InsufficientBalanceError();
const balanceRecovery = handleAgentError(balanceError);
console.log(`   Message: ${balanceRecovery.userMessage}`);
console.log(`   Suggestion: ${balanceRecovery.suggestion}`);
console.log(`   Retryable: ${balanceRecovery.retryable}\n`);

console.log("=== All error scenarios handled gracefully ===");
