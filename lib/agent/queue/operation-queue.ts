/**
 * Operation Queue
 *
 * Inspired by Plandex's operation queue pattern:
 * - Priority-based execution
 * - Cancellation support
 * - Automatic retry on failure
 * - Concurrent execution control
 *
 * Pattern: Enqueue → Prioritize → Execute → Retry/Complete
 */

export type OperationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type OperationPriority = "low" | "normal" | "high" | "critical";

export interface Operation<T = unknown> {
  id: string;
  type: string;
  priority: OperationPriority;
  status: OperationStatus;
  execute: () => Promise<T>;
  onComplete?: (result: T) => void;
  onError?: (error: Error) => void;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: Error;
  metadata: Record<string, unknown>;
}

export interface QueueConfig {
  maxConcurrent: number;
  defaultMaxRetries: number;
  retryDelay: number;
  priorityWeights: Record<OperationPriority, number>;
}

export interface QueueStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  averageExecutionTime: number;
}

/**
 * Operation Queue
 * Manages operation execution with priority, concurrency, and retry
 */
export class OperationQueue {
  private config: QueueConfig;
  private operations: Map<string, Operation> = new Map();
  private runningCount = 0;
  private isProcessing = false;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = {
      maxConcurrent: 5,
      defaultMaxRetries: 3,
      retryDelay: 1000,
      priorityWeights: {
        low: 1,
        normal: 2,
        high: 3,
        critical: 4,
      },
      ...config,
    };
  }

  /**
   * Enqueue an operation
   */
  enqueue<T>(
    type: string,
    execute: () => Promise<T>,
    options: {
      priority?: OperationPriority;
      maxRetries?: number;
      onComplete?: (result: T) => void;
      onError?: (error: Error) => void;
      metadata?: Record<string, unknown>;
    } = {}
  ): string {
    const operationId = this.generateOperationId();

    const operation: Operation<T> = {
      id: operationId,
      type,
      priority: options.priority || "normal",
      status: "pending",
      execute,
      onComplete: options.onComplete,
      onError: options.onError,
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultMaxRetries,
      createdAt: Date.now(),
      metadata: options.metadata || {},
    };

    this.operations.set(operationId, operation);

    // Start processing if not already running
    if (!this.isProcessing) {
      void this.processQueue();
    }

    return operationId;
  }

  /**
   * Cancel an operation
   */
  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId);

    if (!operation) {
      return false;
    }

    // Can only cancel pending operations
    if (operation.status !== "pending") {
      return false;
    }

    operation.status = "cancelled";
    operation.completedAt = Date.now();

    return true;
  }

  /**
   * Get operation by ID
   */
  getOperation(operationId: string): Operation | null {
    return this.operations.get(operationId) || null;
  }

  /**
   * Get operations by status
   */
  getOperationsByStatus(status: OperationStatus): Operation[] {
    return Array.from(this.operations.values()).filter((op) => op.status === status);
  }

  /**
   * Get operations by type
   */
  getOperationsByType(type: string): Operation[] {
    return Array.from(this.operations.values()).filter((op) => op.type === type);
  }

  /**
   * Process queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (true) {
      // Check if we can run more operations
      if (this.runningCount >= this.config.maxConcurrent) {
        await this.sleep(100);
        continue;
      }

      // Get next operation to execute
      const operation = this.getNextOperation();

      if (!operation) {
        // No more pending operations
        break;
      }

      // Execute operation (don't await, run concurrently)
      void this.executeOperation(operation);
    }

    this.isProcessing = false;
  }

  /**
   * Get next operation based on priority
   */
  private getNextOperation(): Operation | null {
    const pending = this.getOperationsByStatus("pending");

    if (pending.length === 0) {
      return null;
    }

    // Sort by priority (higher first), then by creation time (older first)
    pending.sort((a, b) => {
      const priorityDiff =
        this.config.priorityWeights[b.priority] - this.config.priorityWeights[a.priority];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return a.createdAt - b.createdAt;
    });

    return pending[0];
  }

  /**
   * Execute an operation
   */
  private async executeOperation(operation: Operation): Promise<void> {
    operation.status = "running";
    operation.startedAt = Date.now();
    this.runningCount++;

    try {
      const result = await operation.execute();

      operation.status = "completed";
      operation.result = result;
      operation.completedAt = Date.now();

      if (operation.onComplete) {
        operation.onComplete(result);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      operation.error = err;

      // Retry if under max retries
      if (operation.retryCount < operation.maxRetries) {
        operation.retryCount++;
        operation.status = "pending";

        // Wait before retry
        await this.sleep(this.config.retryDelay * operation.retryCount);

        // Re-enqueue for retry
        void this.processQueue();
      } else {
        operation.status = "failed";
        operation.completedAt = Date.now();

        if (operation.onError) {
          operation.onError(err);
        }
      }
    } finally {
      this.runningCount--;

      // Continue processing queue
      if (this.getOperationsByStatus("pending").length > 0) {
        void this.processQueue();
      }
    }
  }

  /**
   * Wait for operation to complete
   */
  async waitFor(operationId: string, timeout: number = 30000): Promise<Operation> {
    const startTime = Date.now();

    while (true) {
      const operation = this.getOperation(operationId);

      if (!operation) {
        throw new Error(`Operation ${operationId} not found`);
      }

      if (operation.status === "completed" || operation.status === "failed" || operation.status === "cancelled") {
        return operation;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(`Operation ${operationId} timed out`);
      }

      await this.sleep(100);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const operations = Array.from(this.operations.values());

    const completed = operations.filter((op) => op.status === "completed");
    const totalExecutionTime = completed.reduce((sum, op) => {
      if (op.startedAt && op.completedAt) {
        return sum + (op.completedAt - op.startedAt);
      }
      return sum;
    }, 0);

    return {
      total: operations.length,
      pending: operations.filter((op) => op.status === "pending").length,
      running: operations.filter((op) => op.status === "running").length,
      completed: completed.length,
      failed: operations.filter((op) => op.status === "failed").length,
      cancelled: operations.filter((op) => op.status === "cancelled").length,
      averageExecutionTime: completed.length > 0 ? totalExecutionTime / completed.length : 0,
    };
  }

  /**
   * Clear completed operations
   */
  clearCompleted(): number {
    const completed = this.getOperationsByStatus("completed");
    for (const operation of completed) {
      this.operations.delete(operation.id);
    }
    return completed.length;
  }

  /**
   * Clear all operations
   */
  clearAll(): void {
    this.operations.clear();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }
}

/**
 * Global operation queue instance
 */
export const operationQueue = new OperationQueue();

/**
 * Convenience function to enqueue operation
 */
export function enqueueOperation<T>(
  type: string,
  execute: () => Promise<T>,
  options?: Parameters<OperationQueue["enqueue"]>[2]
): string {
  return operationQueue.enqueue(type, execute, options);
}

/**
 * Usage example:
 *
 * // Enqueue a swap operation
 * const opId = operationQueue.enqueue(
 *   "swap",
 *   async () => {
 *     return await executeSwap(params);
 *   },
 *   {
 *     priority: "high",
 *     maxRetries: 5,
 *     onComplete: (result) => {
 *       console.log("Swap completed:", result);
 *     },
 *     onError: (error) => {
 *       console.error("Swap failed:", error);
 *     },
 *     metadata: { tokenIn: "TKNA", tokenOut: "TKNB" },
 *   }
 * );
 *
 * // Wait for completion
 * const operation = await operationQueue.waitFor(opId);
 * console.log("Result:", operation.result);
 *
 * // Cancel operation
 * operationQueue.cancel(opId);
 *
 * // Get statistics
 * const stats = operationQueue.getStats();
 * console.log("Queue stats:", stats);
 *
 * // Clear completed operations
 * const cleared = operationQueue.clearCompleted();
 * console.log("Cleared operations:", cleared);
 */
