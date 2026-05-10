/**
 * Error Recovery Loop
 *
 * Inspired by SWE-agent's error recovery pattern:
 * - Automatic retry with exponential backoff
 * - Circuit breaker integration
 * - Recovery strategy selection
 * - Immutable error trajectory
 *
 * Pattern: Execute → Fail → Classify → Recover → Retry
 */

import { errorClassifier, type ClassifiedError } from "../errors/error-classifier";
import { CircuitBreaker } from "../circuit-breaker";

export interface RecoveryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  jitterFactor: number; // 0-1
  useCircuitBreaker: boolean;
  onRetry?: (attempt: number, error: ClassifiedError) => void;
  onRecovery?: (result: unknown) => void;
  onFailure?: (trajectory: ErrorTrajectory) => void;
}

export interface RetryAttempt {
  attempt: number;
  timestamp: number;
  error: ClassifiedError;
  delay: number;
  strategy: string;
}

export interface ErrorTrajectory {
  operationId: string;
  startTime: number;
  endTime?: number;
  totalAttempts: number;
  attempts: RetryAttempt[];
  finalResult?: unknown;
  finalError?: ClassifiedError;
  recovered: boolean;
}

/**
 * Error Recovery Loop
 * Automatically recovers from errors using intelligent retry strategies
 */
export class ErrorRecoveryLoop {
  private config: RecoveryConfig;
  private circuitBreaker?: CircuitBreaker;
  private trajectories: Map<string, ErrorTrajectory> = new Map();

  constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      backoffMultiplier: 2,
      jitterFactor: 0.25,
      useCircuitBreaker: true,
      ...config,
    };

    if (this.config.useCircuitBreaker) {
      this.circuitBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 60000, successThreshold: 2 });
    }
  }

  /**
   * Execute operation with automatic error recovery
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationId: string = this.generateOperationId()
  ): Promise<T> {
    const trajectory: ErrorTrajectory = {
      operationId,
      startTime: Date.now(),
      totalAttempts: 0,
      attempts: [],
      recovered: false,
    };

    this.trajectories.set(operationId, trajectory);

    try {
      const result = await this.executeWithRetry(operation, trajectory);
      trajectory.recovered = true;
      trajectory.finalResult = result;
      trajectory.endTime = Date.now();

      if (this.config.onRecovery) {
        this.config.onRecovery(result);
      }

      return result;
    } catch (error) {
      const classified = errorClassifier.classify(error);
      trajectory.finalError = classified;
      trajectory.endTime = Date.now();

      if (this.config.onFailure) {
        this.config.onFailure(trajectory);
      }

      throw new RecoveryError(
        `Operation failed after ${trajectory.totalAttempts} attempts: ${classified.message}`,
        trajectory
      );
    }
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    trajectory: ErrorTrajectory
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      trajectory.totalAttempts++;

      try {
        // Use circuit breaker if enabled
        if (this.circuitBreaker) {
          return await this.circuitBreaker.execute(operation);
        } else {
          return await operation();
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const classified = errorClassifier.classify(lastError);

        // Check if error is retryable
        if (!classified.retryable || attempt === this.config.maxRetries) {
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        // Record attempt
        const retryAttempt: RetryAttempt = {
          attempt: attempt + 1,
          timestamp: Date.now(),
          error: classified,
          delay,
          strategy: classified.recoveryStrategy,
        };

        trajectory.attempts.push(retryAttempt);

        // Notify retry callback
        if (this.config.onRetry) {
          this.config.onRetry(attempt + 1, classified);
        }

        // Apply recovery strategy
        await this.applyRecoveryStrategy(classified, delay);
      }
    }

    throw lastError || new Error("Operation failed");
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const exponentialDelay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);

    // Add jitter: ±jitterFactor randomness
    const jitterRange = cappedDelay * this.config.jitterFactor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;

    return Math.max(0, cappedDelay + jitter);
  }

  /**
   * Apply recovery strategy based on error classification
   */
  private async applyRecoveryStrategy(
    classified: ClassifiedError,
    delay: number
  ): Promise<void> {
    switch (classified.recoveryStrategy) {
      case "retry":
        // Simple retry without delay
        break;

      case "retry_with_backoff":
        // Wait with exponential backoff
        await this.sleep(delay);
        break;

      case "fallback":
        // Could implement fallback logic here
        await this.sleep(delay);
        break;

      case "user_action_required":
      case "abort":
        // Don't retry, throw immediately
        throw classified.originalError;

      case "ignore":
        // Ignore error and continue
        break;

      default:
        await this.sleep(delay);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get error trajectory
   */
  getTrajectory(operationId: string): ErrorTrajectory | null {
    return this.trajectories.get(operationId) || null;
  }

  /**
   * Get all trajectories
   */
  getAllTrajectories(): ErrorTrajectory[] {
    return Array.from(this.trajectories.values());
  }

  /**
   * Get recovery statistics
   */
  getStatistics(): {
    totalOperations: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    averageAttempts: number;
    recoveryRate: number;
  } {
    const trajectories = this.getAllTrajectories();
    const successful = trajectories.filter((t) => t.recovered).length;
    const failed = trajectories.length - successful;
    const totalAttempts = trajectories.reduce((sum, t) => sum + t.totalAttempts, 0);
    const averageAttempts = trajectories.length > 0 ? totalAttempts / trajectories.length : 0;
    const recoveryRate = trajectories.length > 0 ? (successful / trajectories.length) * 100 : 0;

    return {
      totalOperations: trajectories.length,
      successfulRecoveries: successful,
      failedRecoveries: failed,
      averageAttempts,
      recoveryRate,
    };
  }

  /**
   * Clear trajectory history
   */
  clearHistory(): void {
    this.trajectories.clear();
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
  updateConfig(config: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Custom error class for recovery failures
 */
export class RecoveryError extends Error {
  constructor(
    message: string,
    public trajectory: ErrorTrajectory
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}

/**
 * Global error recovery loop instance
 */
export const errorRecoveryLoop = new ErrorRecoveryLoop();

/**
 * Convenience function to execute with recovery
 */
export async function withRecovery<T>(
  operation: () => Promise<T>,
  config?: Partial<RecoveryConfig>
): Promise<T> {
  if (config) {
    const customLoop = new ErrorRecoveryLoop(config);
    return customLoop.execute(operation);
  }
  return errorRecoveryLoop.execute(operation);
}

/**
 * Usage example:
 *
 * // Basic usage
 * try {
 *   const result = await withRecovery(async () => {
 *     return await fetchPoolReserves();
 *   });
 *   console.log("Success:", result);
 * } catch (error) {
 *   if (error instanceof RecoveryError) {
 *     console.error("Recovery failed:", error.trajectory);
 *   }
 * }
 *
 * // Custom configuration
 * const result = await withRecovery(
 *   async () => {
 *     return await executeSwap(params);
 *   },
 *   {
 *     maxRetries: 5,
 *     baseDelay: 2000,
 *     onRetry: (attempt, error) => {
 *       console.log(`Retry attempt ${attempt}:`, error.message);
 *     },
 *     onRecovery: (result) => {
 *       console.log("Recovered successfully:", result);
 *     },
 *   }
 * );
 *
 * // Get statistics
 * const stats = errorRecoveryLoop.getStatistics();
 * console.log("Recovery rate:", stats.recoveryRate + "%");
 * console.log("Average attempts:", stats.averageAttempts);
 */
