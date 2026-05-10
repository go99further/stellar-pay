/**
 * Batch Request Handler
 *
 * Inspired by production best practices:
 * - Batch multiple requests into single call
 * - Automatic batching with time window
 * - Request deduplication
 * - Priority-based batching
 * - Error handling per request
 *
 * Pattern: Queue → Batch → Execute → Distribute → Report
 */

export interface BatchRequest<T = unknown, R = unknown> {
  id: string;
  data: T;
  priority: "low" | "normal" | "high";
  timestamp: number;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
}

export interface BatchConfig {
  maxBatchSize: number; // Maximum requests per batch
  maxWaitTime: number; // Maximum wait time in ms
  deduplication: boolean; // Enable request deduplication
  retryOnError: boolean; // Retry failed requests
  maxRetries: number; // Maximum retry attempts
}

export interface BatchResult<R = unknown> {
  requestId: string;
  success: boolean;
  result?: R;
  error?: string;
}

export interface BatchStats {
  totalRequests: number;
  totalBatches: number;
  averageBatchSize: number;
  deduplicatedRequests: number;
  failedRequests: number;
  averageLatency: number;
}

/**
 * Batch Request Handler
 * Efficiently batches multiple requests
 */
export class BatchRequestHandler<T = unknown, R = unknown> {
  private config: BatchConfig;
  private queue: BatchRequest<T, R>[] = [];
  private processing = false;
  private timeoutId: NodeJS.Timeout | null = null;
  private stats: BatchStats = {
    totalRequests: 0,
    totalBatches: 0,
    averageBatchSize: 0,
    deduplicatedRequests: 0,
    failedRequests: 0,
    averageLatency: 0,
  };
  private latencyHistory: number[] = [];
  private batchExecutor: (requests: T[]) => Promise<R[]>;
  private deduplicationMap: Map<string, BatchRequest<T, R>> = new Map();

  constructor(
    batchExecutor: (requests: T[]) => Promise<R[]>,
    config: Partial<BatchConfig> = {}
  ) {
    this.batchExecutor = batchExecutor;
    this.config = {
      maxBatchSize: 50,
      maxWaitTime: 100, // 100ms
      deduplication: true,
      retryOnError: true,
      maxRetries: 3,
      ...config,
    };
  }

  /**
   * Add request to batch
   */
  async request(data: T, priority: BatchRequest<T, R>["priority"] = "normal"): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const requestId = this.generateRequestId();

      // Check for duplicate request
      if (this.config.deduplication) {
        const dedupKey = this.getDeduplicationKey(data);
        const existing = this.deduplicationMap.get(dedupKey);

        if (existing) {
          this.stats.deduplicatedRequests++;
          // Piggyback on existing request
          const originalResolve = existing.resolve;
          existing.resolve = (result: R) => {
            originalResolve(result);
            resolve(result);
          };
          return;
        }

        const request: BatchRequest<T, R> = {
          id: requestId,
          data,
          priority,
          timestamp: Date.now(),
          resolve,
          reject,
        };

        this.deduplicationMap.set(dedupKey, request);
        this.queue.push(request);
      } else {
        this.queue.push({
          id: requestId,
          data,
          priority,
          timestamp: Date.now(),
          resolve,
          reject,
        });
      }

      this.stats.totalRequests++;

      // Schedule batch processing
      this.scheduleBatch();
    });
  }

  /**
   * Schedule batch processing
   */
  private scheduleBatch(): void {
    // If already processing, wait
    if (this.processing) return;

    // If batch is full, process immediately
    if (this.queue.length >= this.config.maxBatchSize) {
      this.processBatch();
      return;
    }

    // Schedule batch after wait time
    if (!this.timeoutId) {
      this.timeoutId = setTimeout(() => {
        this.processBatch();
      }, this.config.maxWaitTime);
    }
  }

  /**
   * Process current batch
   */
  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    // Clear timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Sort by priority
    this.queue.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    // Take batch
    const batchSize = Math.min(this.queue.length, this.config.maxBatchSize);
    const batch = this.queue.splice(0, batchSize);

    this.stats.totalBatches++;
    this.stats.averageBatchSize =
      (this.stats.averageBatchSize * (this.stats.totalBatches - 1) + batch.length) /
      this.stats.totalBatches;

    const startTime = Date.now();

    try {
      // Execute batch
      const requests = batch.map((r) => r.data);
      const results = await this.batchExecutor(requests);

      const latency = Date.now() - startTime;
      this.latencyHistory.push(latency);
      if (this.latencyHistory.length > 100) {
        this.latencyHistory.shift();
      }
      this.stats.averageLatency =
        this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;

      // Distribute results
      for (let i = 0; i < batch.length; i++) {
        const request = batch[i];
        const result = results[i];

        if (result !== undefined) {
          request.resolve(result);

          // Clear deduplication
          if (this.config.deduplication) {
            const dedupKey = this.getDeduplicationKey(request.data);
            this.deduplicationMap.delete(dedupKey);
          }
        } else {
          this.stats.failedRequests++;
          request.reject(new Error("No result for request"));
        }
      }
    } catch (error) {
      // Handle batch error
      const errorMessage = error instanceof Error ? error.message : String(error);

      for (const request of batch) {
        this.stats.failedRequests++;
        request.reject(new Error(`Batch error: ${errorMessage}`));

        // Clear deduplication
        if (this.config.deduplication) {
          const dedupKey = this.getDeduplicationKey(request.data);
          this.deduplicationMap.delete(dedupKey);
        }
      }
    } finally {
      this.processing = false;

      // Process remaining queue
      if (this.queue.length > 0) {
        this.scheduleBatch();
      }
    }
  }

  /**
   * Get deduplication key for request
   */
  private getDeduplicationKey(data: T): string {
    return JSON.stringify(data);
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get current statistics
   */
  getStatistics(): BatchStats {
    return { ...this.stats };
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Flush queue immediately
   */
  async flush(): Promise<void> {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    while (this.queue.length > 0) {
      await this.processBatch();
    }
  }

  /**
   * Clear queue
   */
  clear(): void {
    for (const request of this.queue) {
      request.reject(new Error("Queue cleared"));
    }
    this.queue = [];
    this.deduplicationMap.clear();

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BatchConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Typed Batch Handler
 * Specialized batch handler with type safety
 */
export class TypedBatchHandler<K extends string, T, R> {
  private handlers: Map<K, BatchRequestHandler<T, R>> = new Map();

  /**
   * Register batch handler for type
   */
  register(
    type: K,
    executor: (requests: T[]) => Promise<R[]>,
    config?: Partial<BatchConfig>
  ): void {
    this.handlers.set(type, new BatchRequestHandler(executor, config));
  }

  /**
   * Execute request of specific type
   */
  async execute(
    type: K,
    data: T,
    priority: BatchRequest<T, R>["priority"] = "normal"
  ): Promise<R> {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler registered for type: ${type}`);
    }
    return handler.request(data, priority);
  }

  /**
   * Get handler for type
   */
  getHandler(type: K): BatchRequestHandler<T, R> | null {
    return this.handlers.get(type) || null;
  }

  /**
   * Get statistics for all handlers
   */
  getAllStatistics(): Record<K, BatchStats> {
    const stats = {} as Record<K, BatchStats>;
    for (const [type, handler] of this.handlers.entries()) {
      stats[type] = handler.getStatistics();
    }
    return stats;
  }

  /**
   * Flush all handlers
   */
  async flushAll(): Promise<void> {
    await Promise.all(
      Array.from(this.handlers.values()).map((handler) => handler.flush())
    );
  }
}

/**
 * Usage example:
 *
 * // Single type batching
 * const accountBatcher = new BatchRequestHandler(
 *   async (addresses: string[]) => {
 *     // Batch load accounts
 *     return await stellarClient.loadAccounts(addresses);
 *   },
 *   {
 *     maxBatchSize: 50,
 *     maxWaitTime: 100,
 *     deduplication: true,
 *   }
 * );
 *
 * // Request account data (will be batched)
 * const account1 = await accountBatcher.request("GADDRESS1");
 * const account2 = await accountBatcher.request("GADDRESS2");
 *
 * // Multi-type batching
 * type RequestType = "account" | "balance" | "transaction";
 *
 * const batcher = new TypedBatchHandler<RequestType, string, any>();
 *
 * batcher.register("account", async (addresses) => {
 *   return await stellarClient.loadAccounts(addresses);
 * });
 *
 * batcher.register("balance", async (addresses) => {
 *   return await stellarClient.getBalances(addresses);
 * });
 *
 * // Execute requests
 * const account = await batcher.execute("account", "GADDRESS1");
 * const balance = await batcher.execute("balance", "GADDRESS1");
 *
 * // Get statistics
 * console.log("Stats:", batcher.getAllStatistics());
 */
