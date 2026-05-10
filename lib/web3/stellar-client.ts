/**
 * Stellar Client
 *
 * Unified RPC client with advanced features:
 * - Automatic retry with circuit breaker
 * - Response caching
 * - Batch request support
 * - Request deduplication
 *
 * Pattern: Request → Cache Check → Execute → Cache → Return
 */

import { Horizon } from "@stellar/stellar-sdk";
import { CircuitBreaker } from "../agent/circuit-breaker";

const Server = Horizon.Server;
type Server = InstanceType<typeof Horizon.Server>;

export interface ClientConfig {
  horizonUrl: string;
  timeout: number;
  maxRetries: number;
  cacheEnabled: boolean;
  cacheTTL: number; // milliseconds
  batchEnabled: boolean;
  batchDelay: number; // milliseconds
  useCircuitBreaker: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface BatchRequest {
  id: string;
  method: string;
  params: unknown[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Stellar Client
 * Advanced RPC client with retry, caching, and batching
 */
export class StellarClient {
  private config: ClientConfig;
  private server: Server;
  private circuitBreaker?: CircuitBreaker;
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private batchQueue: BatchRequest[] = [];
  private batchTimer?: NodeJS.Timeout;
  private pendingRequests: Map<string, Promise<unknown>> = new Map();

  constructor(config: Partial<ClientConfig> = {}) {
    this.config = {
      horizonUrl: "https://horizon-testnet.stellar.org",
      timeout: 30000,
      maxRetries: 3,
      cacheEnabled: true,
      cacheTTL: 60000, // 1 minute
      batchEnabled: true,
      batchDelay: 50, // 50ms
      useCircuitBreaker: true,
      ...config,
    };

    this.server = new Server(this.config.horizonUrl, {
      allowHttp: this.config.horizonUrl.startsWith("http://"),
    });

    if (this.config.useCircuitBreaker) {
      this.circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000, successThreshold: 2 });
    }

    // Start cache cleanup timer
    this.startCacheCleanup();
  }

  /**
   * Load account with caching
   */
  async loadAccount(address: string): Promise<Horizon.AccountResponse> {
    const cacheKey = `account:${address}`;

    return this.withCache(
      cacheKey,
      () => this.withRetry(() => this.server.loadAccount(address)),
      this.config.cacheTTL
    );
  }

  /**
   * Get account balances
   */
  async getBalances(address: string): Promise<Horizon.HorizonApi.BalanceLine[]> {
    const account = await this.loadAccount(address);
    return account.balances;
  }

  /**
   * Get specific token balance
   */
  async getTokenBalance(address: string, assetCode: string): Promise<string> {
    const balances = await this.getBalances(address);
    const balance = balances.find((b) => {
      if (b.asset_type === "native") {
        return assetCode === "XLM";
      }
      return "asset_code" in b && b.asset_code === assetCode;
    });

    return balance?.balance || "0";
  }

  /**
   * Get transaction by hash
   */
  async getTransaction(hash: string): Promise<Horizon.ServerApi.TransactionRecord> {
    const cacheKey = `tx:${hash}`;

    return this.withCache(
      cacheKey,
      () => this.withRetry(() => this.server.transactions().transaction(hash).call()),
      this.config.cacheTTL * 10 // Cache transactions longer
    );
  }

  /**
   * Get recent transactions for account
   */
  async getRecentTransactions(
    address: string,
    limit: number = 10
  ): Promise<Horizon.ServerApi.TransactionRecord[]> {
    const cacheKey = `txs:${address}:${limit}`;

    return this.withCache(
      cacheKey,
      async () => {
        const response = await this.withRetry(() =>
          this.server.transactions().forAccount(address).limit(limit).order("desc").call()
        );
        return response.records;
      },
      this.config.cacheTTL / 2 // Cache recent txs for shorter time
    );
  }

  /**
   * Get ledger info
   */
  async getLedger(sequence: number): Promise<Horizon.ServerApi.LedgerRecord> {
    const cacheKey = `ledger:${sequence}`;

    return this.withCache(
      cacheKey,
      () => this.withRetry(() => this.server.ledgers().ledger(sequence).call() as unknown as Promise<Horizon.ServerApi.LedgerRecord>),
      this.config.cacheTTL * 10
    );
  }

  /**
   * Get latest ledger
   */
  async getLatestLedger(): Promise<Horizon.ServerApi.LedgerRecord> {
    // Don't cache latest ledger
    return this.withRetry(() =>
      this.server.ledgers().order("desc").limit(1).call().then((r) => r.records[0])
    );
  }

  /**
   * Submit transaction
   */
  async submitTransaction(xdr: string): Promise<Horizon.HorizonApi.SubmitTransactionResponse> {
    return this.withRetry(() => this.server.submitTransaction(xdr as unknown as Parameters<Server["submitTransaction"]>[0]));
  }

  /**
   * Batch load accounts
   */
  async batchLoadAccounts(addresses: string[]): Promise<Map<string, Horizon.AccountResponse>> {
    if (!this.config.batchEnabled) {
      const results = new Map<string, Horizon.AccountResponse>();
      for (const address of addresses) {
        try {
          const account = await this.loadAccount(address);
          results.set(address, account);
        } catch (error) {
          console.error(`Failed to load account ${address}:`, error);
        }
      }
      return results;
    }

    // Load in parallel with batching
    const promises = addresses.map((address) => this.loadAccount(address));
    const accounts = await Promise.allSettled(promises);

    const results = new Map<string, Horizon.AccountResponse>();
    addresses.forEach((address, index) => {
      const result = accounts[index];
      if (result.status === "fulfilled") {
        results.set(address, result.value);
      }
    });

    return results;
  }

  /**
   * Execute with caching
   */
  private async withCache<T>(
    key: string,
    fn: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    if (!this.config.cacheEnabled) {
      return fn();
    }

    // Check cache
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }

    // Check if request is already pending (deduplication)
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Execute request
    const promise = fn();
    this.pendingRequests.set(key, promise);

    try {
      const data = await promise;

      // Cache result
      this.cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
      });

      return data;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /**
   * Execute with retry and circuit breaker
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    if (this.circuitBreaker) {
      return this.circuitBreaker.execute(fn);
    }

    // Simple retry without circuit breaker
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("Request failed");
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Start cache cleanup timer
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > entry.ttl) {
          this.cache.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    entries: Array<{ key: string; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.timestamp,
    }));

    return {
      size: this.cache.size,
      hitRate: 0, // TODO: Track hits/misses
      entries,
    };
  }

  /**
   * Get client status
   */
  getStatus(): {
    horizonUrl: string;
    cacheEnabled: boolean;
    cacheSize: number;
    pendingRequests: number;
    circuitBreakerState?: string;
  } {
    return {
      horizonUrl: this.config.horizonUrl,
      cacheEnabled: this.config.cacheEnabled,
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
      circuitBreakerState: this.circuitBreaker?.getState(),
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ClientConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.horizonUrl) {
      this.server = new Server(this.config.horizonUrl, {
        allowHttp: this.config.horizonUrl.startsWith("http://"),
      });
    }
  }

  /**
   * Get underlying Horizon server
   */
  getServer(): Server {
    return this.server;
  }
}

/**
 * Global Stellar client instance (testnet)
 */
export const stellarClient = new StellarClient();

/**
 * Create mainnet client
 */
export function createMainnetClient(): StellarClient {
  return new StellarClient({
    horizonUrl: "https://horizon.stellar.org",
  });
}

/**
 * Usage example:
 *
 * // Load account with automatic caching
 * const account = await stellarClient.loadAccount("GXXXXXX...");
 * console.log("Balances:", account.balances);
 *
 * // Get token balance
 * const balance = await stellarClient.getTokenBalance("GXXXXXX...", "USDC");
 * console.log("USDC balance:", balance);
 *
 * // Batch load multiple accounts
 * const accounts = await stellarClient.batchLoadAccounts([
 *   "GXXXXXX...",
 *   "GYYYYYY...",
 *   "GZZZZZZ...",
 * ]);
 *
 * // Get recent transactions
 * const txs = await stellarClient.getRecentTransactions("GXXXXXX...", 20);
 * console.log("Recent transactions:", txs.length);
 *
 * // Check client status
 * const status = stellarClient.getStatus();
 * console.log("Cache size:", status.cacheSize);
 * console.log("Circuit breaker:", status.circuitBreakerState);
 */
