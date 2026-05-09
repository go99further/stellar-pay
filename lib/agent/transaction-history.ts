/**
 * Transaction history manager for localStorage
 * Tracks successful swaps, liquidity operations, and failed transactions
 */

const TRANSACTION_HISTORY_KEY = "stellar-pay-transaction-history";
const MAX_TRANSACTIONS = 50;

export interface TransactionRecord {
  id: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  timestamp: number;
  details: Record<string, unknown>;
  txHash: string;
  status: "success" | "failed";
}

/**
 * Save a transaction to localStorage
 */
export function saveTransaction(record: Omit<TransactionRecord, "id" | "timestamp">): void {
  try {
    const history = getTransactionHistory();
    const newRecord: TransactionRecord = {
      ...record,
      id: generateId(),
      timestamp: Date.now(),
    };

    // Add to beginning (newest first)
    history.unshift(newRecord);

    // Keep only the last MAX_TRANSACTIONS
    const trimmed = history.slice(0, MAX_TRANSACTIONS);

    localStorage.setItem(TRANSACTION_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (error) {
    // Gracefully handle localStorage errors (quota exceeded, disabled, etc.)
    console.warn("Failed to save transaction to localStorage:", error);
  }
}

/**
 * Get all transaction history (newest first)
 */
export function getTransactionHistory(): TransactionRecord[] {
  try {
    const raw = localStorage.getItem(TRANSACTION_HISTORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Validate structure
    return parsed.filter(isValidTransactionRecord);
  } catch (error) {
    console.warn("Failed to read transaction history from localStorage:", error);
    return [];
  }
}

/**
 * Clear all transaction history
 */
export function clearHistory(): void {
  try {
    localStorage.removeItem(TRANSACTION_HISTORY_KEY);
  } catch (error) {
    console.warn("Failed to clear transaction history:", error);
  }
}

/**
 * Get recent transactions (default: last 10)
 */
export function getRecentTransactions(limit = 10): TransactionRecord[] {
  return getTransactionHistory().slice(0, limit);
}

/**
 * Generate Stellar Expert link for a transaction
 */
export function getStellarExpertLink(txHash: string, network: "testnet" | "public" = "testnet"): string {
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isValidTransactionRecord(record: unknown): record is TransactionRecord {
  if (typeof record !== "object" || record === null) return false;
  const r = record as Record<string, unknown>;

  return (
    typeof r.id === "string" &&
    (r.type === "swap" || r.type === "add_liquidity" || r.type === "remove_liquidity") &&
    typeof r.timestamp === "number" &&
    typeof r.details === "object" &&
    r.details !== null &&
    typeof r.txHash === "string" &&
    (r.status === "success" || r.status === "failed")
  );
}
