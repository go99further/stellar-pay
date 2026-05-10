/**
 * Exception Classifier
 *
 * Inspired by Aider's error classification pattern:
 * - Categorize errors by type and severity
 * - Provide actionable recovery suggestions
 * - Track error patterns for learning
 * - Support custom error handlers
 *
 * Pattern: Error → Classify → Suggest → Handle
 */

export type ErrorCategory =
  | "validation"
  | "network"
  | "contract"
  | "user"
  | "system"
  | "unknown";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type RecoveryStrategy =
  | "retry"
  | "retry_with_backoff"
  | "user_action_required"
  | "fallback"
  | "abort"
  | "ignore";

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  originalError: Error;
  message: string;
  code?: string;
  recoveryStrategy: RecoveryStrategy;
  suggestions: string[];
  metadata: Record<string, unknown>;
  retryable: boolean;
  userFacing: boolean;
}

export interface ErrorPattern {
  pattern: RegExp | string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoveryStrategy: RecoveryStrategy;
  suggestions: string[];
}

/**
 * Error Classifier
 * Analyzes errors and provides recovery strategies
 */
export class ErrorClassifier {
  private patterns: ErrorPattern[] = [];
  private errorHistory: ClassifiedError[] = [];
  private maxHistorySize = 100;

  constructor() {
    this.initializeDefaultPatterns();
  }

  /**
   * Classify an error and provide recovery strategy
   */
  classify(error: Error | unknown): ClassifiedError {
    const err = this.normalizeError(error);
    const message = err.message.toLowerCase();

    // Try to match against known patterns
    for (const pattern of this.patterns) {
      if (this.matchesPattern(message, pattern.pattern)) {
        const classified: ClassifiedError = {
          category: pattern.category,
          severity: pattern.severity,
          originalError: err,
          message: err.message,
          code: this.extractErrorCode(err),
          recoveryStrategy: pattern.recoveryStrategy,
          suggestions: pattern.suggestions,
          metadata: this.extractMetadata(err),
          retryable: this.isRetryable(pattern.recoveryStrategy),
          userFacing: this.isUserFacing(pattern.category),
        };

        this.recordError(classified);
        return classified;
      }
    }

    // Unknown error - use conservative defaults
    const classified: ClassifiedError = {
      category: "unknown",
      severity: "medium",
      originalError: err,
      message: err.message,
      code: this.extractErrorCode(err),
      recoveryStrategy: "abort",
      suggestions: ["Check logs for more details", "Contact support if issue persists"],
      metadata: this.extractMetadata(err),
      retryable: false,
      userFacing: true,
    };

    this.recordError(classified);
    return classified;
  }

  /**
   * Add custom error pattern
   */
  addPattern(pattern: ErrorPattern): void {
    this.patterns.unshift(pattern); // Add to front for priority
  }

  /**
   * Get error history
   */
  getHistory(): ClassifiedError[] {
    return [...this.errorHistory];
  }

  /**
   * Get error statistics
   */
  getStatistics(): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    retryableCount: number;
  } {
    const byCategory: Record<ErrorCategory, number> = {
      validation: 0,
      network: 0,
      contract: 0,
      user: 0,
      system: 0,
      unknown: 0,
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    let retryableCount = 0;

    for (const error of this.errorHistory) {
      byCategory[error.category]++;
      bySeverity[error.severity]++;
      if (error.retryable) retryableCount++;
    }

    return {
      total: this.errorHistory.length,
      byCategory,
      bySeverity,
      retryableCount,
    };
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  // ── Private methods ──

  private initializeDefaultPatterns(): void {
    // Validation errors
    this.patterns.push({
      pattern: /invalid.*address|address.*invalid/i,
      category: "validation",
      severity: "medium",
      recoveryStrategy: "user_action_required",
      suggestions: ["Check wallet address format", "Ensure address is 56 characters"],
    });

    this.patterns.push({
      pattern: /insufficient.*balance|balance.*insufficient/i,
      category: "validation",
      severity: "high",
      recoveryStrategy: "user_action_required",
      suggestions: ["Check token balance", "Reduce transaction amount"],
    });

    this.patterns.push({
      pattern: /deadline.*passed|expired.*deadline/i,
      category: "validation",
      severity: "medium",
      recoveryStrategy: "retry",
      suggestions: ["Increase deadline", "Retry transaction immediately"],
    });

    this.patterns.push({
      pattern: /slippage.*exceeded|price.*impact/i,
      category: "validation",
      severity: "high",
      recoveryStrategy: "user_action_required",
      suggestions: [
        "Increase slippage tolerance",
        "Reduce trade size",
        "Wait for better market conditions",
      ],
    });

    // Network errors
    this.patterns.push({
      pattern: /network.*error|connection.*failed|timeout/i,
      category: "network",
      severity: "medium",
      recoveryStrategy: "retry_with_backoff",
      suggestions: ["Check internet connection", "Retry in a few seconds"],
    });

    this.patterns.push({
      pattern: /rpc.*error|stellar.*rpc/i,
      category: "network",
      severity: "high",
      recoveryStrategy: "retry_with_backoff",
      suggestions: ["Stellar RPC may be down", "Try again in a few minutes"],
    });

    this.patterns.push({
      pattern: /rate.*limit|too.*many.*requests/i,
      category: "network",
      severity: "medium",
      recoveryStrategy: "retry_with_backoff",
      suggestions: ["Wait before retrying", "Reduce request frequency"],
    });

    // Contract errors
    this.patterns.push({
      pattern: /contract.*panic|panic.*contract/i,
      category: "contract",
      severity: "high",
      recoveryStrategy: "abort",
      suggestions: ["Check contract state", "Review transaction parameters"],
    });

    this.patterns.push({
      pattern: /pool.*not.*found|liquidity.*pool/i,
      category: "contract",
      severity: "high",
      recoveryStrategy: "user_action_required",
      suggestions: ["Verify token pair", "Check if pool exists"],
    });

    this.patterns.push({
      pattern: /insufficient.*liquidity/i,
      category: "contract",
      severity: "high",
      recoveryStrategy: "user_action_required",
      suggestions: ["Reduce trade size", "Split into multiple trades"],
    });

    // User errors
    this.patterns.push({
      pattern: /user.*rejected|transaction.*cancelled/i,
      category: "user",
      severity: "low",
      recoveryStrategy: "ignore",
      suggestions: ["User cancelled transaction"],
    });

    this.patterns.push({
      pattern: /wallet.*not.*connected/i,
      category: "user",
      severity: "medium",
      recoveryStrategy: "user_action_required",
      suggestions: ["Connect wallet", "Refresh page and try again"],
    });

    // System errors
    this.patterns.push({
      pattern: /out.*of.*memory|memory.*exceeded/i,
      category: "system",
      severity: "critical",
      recoveryStrategy: "abort",
      suggestions: ["System resource issue", "Contact support"],
    });

    this.patterns.push({
      pattern: /internal.*server.*error|500/i,
      category: "system",
      severity: "high",
      recoveryStrategy: "retry_with_backoff",
      suggestions: ["Server error", "Try again later"],
    });
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === "string") {
      return new Error(error);
    }
    return new Error(String(error));
  }

  private matchesPattern(message: string, pattern: RegExp | string): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(message);
    }
    return message.includes(pattern.toLowerCase());
  }

  private extractErrorCode(error: Error): string | undefined {
    // Try to extract error code from error object
    const errorWithCode = error as Error & { code?: string };
    return errorWithCode.code;
  }

  private extractMetadata(error: Error): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      name: error.name,
      stack: error.stack,
    };

    // Extract additional properties
    const errorObj = error as unknown as Record<string, unknown>;
    for (const key of Object.keys(errorObj)) {
      if (key !== "name" && key !== "message" && key !== "stack") {
        metadata[key] = errorObj[key];
      }
    }

    return metadata;
  }

  private isRetryable(strategy: RecoveryStrategy): boolean {
    return strategy === "retry" || strategy === "retry_with_backoff";
  }

  private isUserFacing(category: ErrorCategory): boolean {
    return category === "validation" || category === "user";
  }

  private recordError(error: ClassifiedError): void {
    this.errorHistory.unshift(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.pop();
    }
  }
}

/**
 * Global error classifier instance
 */
export const errorClassifier = new ErrorClassifier();

/**
 * Convenience function to classify and handle errors
 */
export function classifyAndHandle(
  error: unknown,
  onClassified?: (classified: ClassifiedError) => void
): ClassifiedError {
  const classified = errorClassifier.classify(error);

  if (onClassified) {
    onClassified(classified);
  }

  return classified;
}

/**
 * Usage example:
 *
 * try {
 *   await executeSwap(params);
 * } catch (error) {
 *   const classified = errorClassifier.classify(error);
 *
 *   console.log("Error category:", classified.category);
 *   console.log("Severity:", classified.severity);
 *   console.log("Recovery strategy:", classified.recoveryStrategy);
 *   console.log("Suggestions:", classified.suggestions);
 *
 *   if (classified.retryable) {
 *     // Retry logic
 *     await retryWithBackoff(() => executeSwap(params));
 *   } else if (classified.userFacing) {
 *     // Show user-friendly error message
 *     showErrorToUser(classified.message, classified.suggestions);
 *   } else {
 *     // Log for debugging
 *     logError(classified);
 *   }
 * }
 *
 * // Get error statistics
 * const stats = errorClassifier.getStatistics();
 * console.log("Total errors:", stats.total);
 * console.log("By category:", stats.byCategory);
 */
