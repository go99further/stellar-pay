/**
 * Reflection Loop
 *
 * Inspired by Aider's reflection pattern:
 * - Self-assessment after each operation
 * - Learning from errors
 * - Strategy adjustment
 * - Performance improvement over time
 *
 * Pattern: Execute → Reflect → Learn → Adjust → Improve
 */

export interface Reflection {
  id: string;
  operationId: string;
  timestamp: number;
  outcome: "success" | "failure" | "partial";
  metrics: PerformanceMetrics;
  insights: Insight[];
  adjustments: Adjustment[];
  metadata: Record<string, unknown>;
}

export interface PerformanceMetrics {
  duration: number;
  retryCount: number;
  errorCount: number;
  successRate: number;
  efficiency: number; // 0-1
}

export interface Insight {
  type: "error_pattern" | "optimization" | "best_practice" | "anti_pattern";
  severity: "low" | "medium" | "high";
  description: string;
  evidence: string[];
  recommendation: string;
}

export interface Adjustment {
  parameter: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  expectedImpact: string;
}

export interface LearningPattern {
  pattern: string;
  occurrences: number;
  successRate: number;
  averageDuration: number;
  lastSeen: number;
  adjustments: Adjustment[];
}

/**
 * Reflection Loop
 * Enables agent to learn and improve from experience
 */
export class ReflectionLoop {
  private reflections: Map<string, Reflection> = new Map();
  private patterns: Map<string, LearningPattern> = new Map();
  private maxReflections = 1000;

  /**
   * Reflect on an operation
   */
  reflect(
    operationId: string,
    outcome: Reflection["outcome"],
    metrics: PerformanceMetrics,
    context: Record<string, unknown> = {}
  ): Reflection {
    const reflectionId = this.generateReflectionId();

    // Analyze operation
    const insights = this.analyzeOperation(outcome, metrics, context);

    // Generate adjustments
    const adjustments = this.generateAdjustments(insights, metrics);

    // Create reflection
    const reflection: Reflection = {
      id: reflectionId,
      operationId,
      timestamp: Date.now(),
      outcome,
      metrics,
      insights,
      adjustments,
      metadata: context,
    };

    this.reflections.set(reflectionId, reflection);

    // Update learning patterns
    this.updatePatterns(reflection);

    // Trim old reflections
    if (this.reflections.size > this.maxReflections) {
      this.trimOldReflections();
    }

    return reflection;
  }

  /**
   * Analyze operation and generate insights
   */
  private analyzeOperation(
    outcome: Reflection["outcome"],
    metrics: PerformanceMetrics,
    context: Record<string, unknown>
  ): Insight[] {
    const insights: Insight[] = [];

    // Check for error patterns
    if (metrics.errorCount > 0) {
      insights.push({
        type: "error_pattern",
        severity: metrics.errorCount > 2 ? "high" : "medium",
        description: `Operation encountered ${metrics.errorCount} errors`,
        evidence: [
          `Error count: ${metrics.errorCount}`,
          `Retry count: ${metrics.retryCount}`,
          `Success rate: ${(metrics.successRate * 100).toFixed(1)}%`,
        ],
        recommendation: "Review error handling and add more specific error recovery strategies",
      });
    }

    // Check for performance issues
    if (metrics.duration > 5000) {
      insights.push({
        type: "optimization",
        severity: metrics.duration > 10000 ? "high" : "medium",
        description: `Operation took ${(metrics.duration / 1000).toFixed(1)}s to complete`,
        evidence: [
          `Duration: ${metrics.duration}ms`,
          `Efficiency: ${(metrics.efficiency * 100).toFixed(1)}%`,
        ],
        recommendation: "Consider caching, batching, or parallel execution to improve performance",
      });
    }

    // Check for excessive retries
    if (metrics.retryCount > 2) {
      insights.push({
        type: "anti_pattern",
        severity: "medium",
        description: `Operation required ${metrics.retryCount} retries`,
        evidence: [
          `Retry count: ${metrics.retryCount}`,
          `Success rate: ${(metrics.successRate * 100).toFixed(1)}%`,
        ],
        recommendation: "Investigate root cause of failures and improve initial execution strategy",
      });
    }

    // Check for high efficiency
    if (metrics.efficiency > 0.9 && outcome === "success") {
      insights.push({
        type: "best_practice",
        severity: "low",
        description: "Operation executed efficiently",
        evidence: [
          `Efficiency: ${(metrics.efficiency * 100).toFixed(1)}%`,
          `Duration: ${metrics.duration}ms`,
          `No retries needed`,
        ],
        recommendation: "Current approach is working well, consider applying to similar operations",
      });
    }

    // Context-specific insights
    if (context.operationType === "swap") {
      if (metrics.duration > 3000) {
        insights.push({
          type: "optimization",
          severity: "medium",
          description: "Swap operation slower than expected",
          evidence: [`Duration: ${metrics.duration}ms`, `Expected: <3000ms`],
          recommendation: "Check network latency and consider using simulation cache",
        });
      }
    }

    return insights;
  }

  /**
   * Generate adjustments based on insights
   */
  private generateAdjustments(
    insights: Insight[],
    metrics: PerformanceMetrics
  ): Adjustment[] {
    const adjustments: Adjustment[] = [];

    for (const insight of insights) {
      if (insight.type === "error_pattern" && insight.severity === "high") {
        adjustments.push({
          parameter: "maxRetries",
          oldValue: 3,
          newValue: 5,
          reason: "High error count detected",
          expectedImpact: "Increase success rate by allowing more retry attempts",
        });

        adjustments.push({
          parameter: "retryDelay",
          oldValue: 1000,
          newValue: 2000,
          reason: "Errors may be due to rate limiting",
          expectedImpact: "Reduce rate limit errors by increasing delay between retries",
        });
      }

      if (insight.type === "optimization" && insight.severity === "high") {
        adjustments.push({
          parameter: "cacheEnabled",
          oldValue: false,
          newValue: true,
          reason: "Performance issues detected",
          expectedImpact: "Reduce latency by caching frequently accessed data",
        });

        adjustments.push({
          parameter: "batchEnabled",
          oldValue: false,
          newValue: true,
          reason: "Multiple similar operations detected",
          expectedImpact: "Improve throughput by batching similar requests",
        });
      }

      if (insight.type === "anti_pattern") {
        adjustments.push({
          parameter: "validationEnabled",
          oldValue: false,
          newValue: true,
          reason: "Excessive retries indicate validation issues",
          expectedImpact: "Catch errors earlier with pre-execution validation",
        });
      }
    }

    return adjustments;
  }

  /**
   * Update learning patterns
   */
  private updatePatterns(reflection: Reflection): void {
    const patternKey = this.extractPatternKey(reflection);

    let pattern = this.patterns.get(patternKey);

    if (!pattern) {
      pattern = {
        pattern: patternKey,
        occurrences: 0,
        successRate: 0,
        averageDuration: 0,
        lastSeen: 0,
        adjustments: [],
      };
      this.patterns.set(patternKey, pattern);
    }

    // Update pattern statistics
    pattern.occurrences++;
    pattern.lastSeen = reflection.timestamp;

    // Update success rate (exponential moving average)
    const alpha = 0.3; // Weight for new observation
    const success = reflection.outcome === "success" ? 1 : 0;
    pattern.successRate = alpha * success + (1 - alpha) * pattern.successRate;

    // Update average duration
    pattern.averageDuration =
      (pattern.averageDuration * (pattern.occurrences - 1) + reflection.metrics.duration) /
      pattern.occurrences;

    // Accumulate adjustments
    for (const adjustment of reflection.adjustments) {
      const existing = pattern.adjustments.find((a) => a.parameter === adjustment.parameter);
      if (!existing) {
        pattern.adjustments.push(adjustment);
      }
    }
  }

  /**
   * Extract pattern key from reflection
   */
  private extractPatternKey(reflection: Reflection): string {
    const operationType = reflection.metadata.operationType || "unknown";
    const outcome = reflection.outcome;
    const hasErrors = reflection.metrics.errorCount > 0;

    return `${operationType}:${outcome}:${hasErrors ? "errors" : "clean"}`;
  }

  /**
   * Get learned patterns
   */
  getPatterns(): LearningPattern[] {
    return Array.from(this.patterns.values()).sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Get pattern by key
   */
  getPattern(patternKey: string): LearningPattern | null {
    return this.patterns.get(patternKey) || null;
  }

  /**
   * Get recommendations for operation type
   */
  getRecommendations(operationType: string): Adjustment[] {
    const relevantPatterns = Array.from(this.patterns.values()).filter((p) =>
      p.pattern.startsWith(operationType)
    );

    // Aggregate adjustments from successful patterns
    const adjustmentMap = new Map<string, Adjustment>();

    for (const pattern of relevantPatterns) {
      if (pattern.successRate > 0.7) {
        // Only consider successful patterns
        for (const adjustment of pattern.adjustments) {
          adjustmentMap.set(adjustment.parameter, adjustment);
        }
      }
    }

    return Array.from(adjustmentMap.values());
  }

  /**
   * Get reflection by ID
   */
  getReflection(reflectionId: string): Reflection | null {
    return this.reflections.get(reflectionId) || null;
  }

  /**
   * Get recent reflections
   */
  getRecentReflections(limit: number = 10): Reflection[] {
    return Array.from(this.reflections.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get learning statistics
   */
  getStatistics(): {
    totalReflections: number;
    totalPatterns: number;
    averageSuccessRate: number;
    mostCommonPattern: string;
    topInsightType: string;
  } {
    const reflections = Array.from(this.reflections.values());
    const patterns = Array.from(this.patterns.values());

    const successCount = reflections.filter((r) => r.outcome === "success").length;
    const averageSuccessRate = reflections.length > 0 ? successCount / reflections.length : 0;

    const mostCommonPattern =
      patterns.length > 0
        ? patterns.reduce((max, p) => (p.occurrences > max.occurrences ? p : max)).pattern
        : "none";

    const insightCounts = new Map<string, number>();
    for (const reflection of reflections) {
      for (const insight of reflection.insights) {
        insightCounts.set(insight.type, (insightCounts.get(insight.type) || 0) + 1);
      }
    }

    const topInsightType =
      insightCounts.size > 0
        ? Array.from(insightCounts.entries()).reduce((max, [type, count]) =>
            count > (insightCounts.get(max) || 0) ? type : max
          , Array.from(insightCounts.keys())[0])
        : "none";

    return {
      totalReflections: reflections.length,
      totalPatterns: patterns.length,
      averageSuccessRate,
      mostCommonPattern,
      topInsightType,
    };
  }

  /**
   * Clear all reflections and patterns
   */
  clearAll(): void {
    this.reflections.clear();
    this.patterns.clear();
  }

  /**
   * Trim old reflections
   */
  private trimOldReflections(): void {
    const reflections = Array.from(this.reflections.entries());
    reflections.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = reflections.length - this.maxReflections + 100;
    for (let i = 0; i < toRemove; i++) {
      this.reflections.delete(reflections[i][0]);
    }
  }

  /**
   * Generate unique reflection ID
   */
  private generateReflectionId(): string {
    return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

/**
 * Global reflection loop instance
 */
export const reflectionLoop = new ReflectionLoop();

/**
 * Usage example:
 *
 * // After operation completes
 * const reflection = reflectionLoop.reflect(
 *   "op_123",
 *   "success",
 *   {
 *     duration: 2500,
 *     retryCount: 1,
 *     errorCount: 1,
 *     successRate: 0.95,
 *     efficiency: 0.85,
 *   },
 *   {
 *     operationType: "swap",
 *     tokenIn: "TKNA",
 *     tokenOut: "TKNB",
 *   }
 * );
 *
 * console.log("Insights:", reflection.insights);
 * console.log("Adjustments:", reflection.adjustments);
 *
 * // Get recommendations for future operations
 * const recommendations = reflectionLoop.getRecommendations("swap");
 * console.log("Apply these adjustments:", recommendations);
 *
 * // Get learned patterns
 * const patterns = reflectionLoop.getPatterns();
 * console.log("Top pattern:", patterns[0]);
 *
 * // Get statistics
 * const stats = reflectionLoop.getStatistics();
 * console.log("Success rate:", stats.averageSuccessRate);
 */
