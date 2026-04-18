/**
 * Simple in-memory cache with TTL support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /**
   * Get a cached value. Returns undefined if expired or not found.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /**
   * Set a value with TTL in milliseconds.
   */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Remove a specific key.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Remove all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of non-expired entries.
   */
  get size(): number {
    // Clean expired entries first
    for (const [key, entry] of this.store) {
      if (Date.now() > entry.expiresAt) {
        this.store.delete(key);
      }
    }
    return this.store.size;
  }
}

// Singleton cache instance
export const cache = new MemoryCache();

// Cache key constants
export const CACHE_KEYS = {
  BALANCE: (addr: string) => `balance:${addr}`,
  POLL_QUESTION: "poll:question",
  POLL_OPTIONS: "poll:options",
  POLL_VOTES: "poll:votes",
  POLL_TOTAL: "poll:total",
  HAS_VOTED: (addr: string) => `poll:voted:${addr}`,
  // AMM cache keys
  AMM_RESERVES: "amm:reserves",
  AMM_PRICE: (tokenIn: string, amount: string) => `amm:price:${tokenIn}:${amount}`,
  LP_BALANCE: (addr: string) => `amm:lp:${addr}`,
  LP_SUPPLY: "amm:lp:supply",
};

// TTL constants
export const CACHE_TTL = {
  BALANCE: 15_000,       // 15 seconds
  POLL_STATIC: 120_000,  // 2 minutes (question, options rarely change)
  POLL_VOTES: 10_000,    // 10 seconds (votes change more often)
  HAS_VOTED: 60_000,     // 1 minute
  // AMM TTLs
  AMM_RESERVES: 10_000,  // 10 seconds (changes on every swap/liquidity op)
  AMM_PRICE: 5_000,      // 5 seconds (short — price moves with reserves)
  LP_BALANCE: 10_000,    // 10 seconds
  LP_SUPPLY: 10_000,     // 10 seconds
};
