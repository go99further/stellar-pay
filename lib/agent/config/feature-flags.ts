/**
 * Feature Flags
 *
 * Inspired by production feature management:
 * - Runtime feature toggling without deploy
 * - Percentage-based rollouts
 * - User/context targeting
 * - A/B testing support
 * - Flag analytics
 *
 * Pattern: Define → Evaluate → Track → Analyze → Iterate
 */

export type FlagValue = boolean | string | number | Record<string, unknown>;

export interface FeatureFlag {
  key: string;
  description: string;
  defaultValue: FlagValue;
  variants?: FlagVariant[];
  targeting?: TargetingRule[];
  rollout?: RolloutConfig;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export interface FlagVariant {
  key: string;
  value: FlagValue;
  weight: number; // 0-100, must sum to 100 across variants
  description?: string;
}

export interface TargetingRule {
  attribute: string;
  operator: "equals" | "contains" | "startsWith" | "in" | "notIn";
  values: unknown[];
  value?: FlagValue; // Override value when rule matches
}

export interface RolloutConfig {
  percentage: number; // 0-100
  hashAttribute: string; // Attribute to hash for consistent assignment
}

export interface FlagContext {
  userId?: string;
  sessionId?: string;
  attributes: Record<string, unknown>;
}

export interface FlagEvaluation {
  key: string;
  value: FlagValue;
  variant?: string;
  reason: EvaluationReason;
  timestamp: number;
}

export type EvaluationReason =
  | "default"
  | "disabled"
  | "targeting_match"
  | "rollout"
  | "variant";

export interface FlagStats {
  key: string;
  totalEvaluations: number;
  variantCounts: Record<string, number>;
  lastEvaluated: number;
}

/**
 * Feature Flag Manager
 * Runtime feature toggling with targeting and rollouts
 */
export class FeatureFlagManager {
  private flags: Map<string, FeatureFlag> = new Map();
  private evaluationHistory: Map<string, FlagEvaluation[]> = new Map();
  private maxHistoryPerFlag = 1000;

  /**
   * Define a feature flag
   */
  define(flag: Omit<FeatureFlag, "createdAt" | "updatedAt">): void {
    const now = Date.now();
    this.flags.set(flag.key, {
      ...flag,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Enable a flag
   */
  enable(key: string): boolean {
    const flag = this.flags.get(key);
    if (!flag) return false;
    flag.enabled = true;
    flag.updatedAt = Date.now();
    return true;
  }

  /**
   * Disable a flag
   */
  disable(key: string): boolean {
    const flag = this.flags.get(key);
    if (!flag) return false;
    flag.enabled = false;
    flag.updatedAt = Date.now();
    return true;
  }

  /**
   * Evaluate a flag for a given context
   */
  evaluate(key: string, context: FlagContext = { attributes: {} }): FlagEvaluation {
    const flag = this.flags.get(key);

    if (!flag) {
      return this.makeEvaluation(key, false, undefined, "default");
    }

    if (!flag.enabled) {
      return this.recordEvaluation(
        this.makeEvaluation(key, flag.defaultValue, undefined, "disabled")
      );
    }

    // Check targeting rules
    if (flag.targeting && flag.targeting.length > 0) {
      for (const rule of flag.targeting) {
        if (this.matchesRule(rule, context)) {
          const value = rule.value ?? true;
          return this.recordEvaluation(
            this.makeEvaluation(key, value, undefined, "targeting_match")
          );
        }
      }
    }

    // Check rollout
    if (flag.rollout) {
      const inRollout = this.isInRollout(flag.rollout, context);
      if (!inRollout) {
        return this.recordEvaluation(
          this.makeEvaluation(key, flag.defaultValue, undefined, "default")
        );
      }
    }

    // Check variants (A/B testing)
    if (flag.variants && flag.variants.length > 0) {
      const variant = this.selectVariant(flag.variants, context, key);
      if (variant) {
        return this.recordEvaluation(
          this.makeEvaluation(key, variant.value, variant.key, "variant")
        );
      }
    }

    // Default: flag is enabled, return true or default value
    const value = flag.defaultValue === false ? true : flag.defaultValue;
    return this.recordEvaluation(
      this.makeEvaluation(key, value, undefined, "rollout")
    );
  }

  /**
   * Evaluate as boolean
   */
  isEnabled(key: string, context: FlagContext = { attributes: {} }): boolean {
    const evaluation = this.evaluate(key, context);
    return Boolean(evaluation.value);
  }

  /**
   * Evaluate as string
   */
  getString(key: string, context: FlagContext = { attributes: {} }): string {
    const evaluation = this.evaluate(key, context);
    return String(evaluation.value);
  }

  /**
   * Evaluate as number
   */
  getNumber(key: string, context: FlagContext = { attributes: {} }): number {
    const evaluation = this.evaluate(key, context);
    return Number(evaluation.value);
  }

  /**
   * Get all flags
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * Get flag by key
   */
  getFlag(key: string): FeatureFlag | null {
    return this.flags.get(key) || null;
  }

  /**
   * Update flag configuration
   */
  update(key: string, updates: Partial<FeatureFlag>): boolean {
    const flag = this.flags.get(key);
    if (!flag) return false;

    Object.assign(flag, updates, { updatedAt: Date.now() });
    return true;
  }

  /**
   * Delete a flag
   */
  delete(key: string): boolean {
    return this.flags.delete(key);
  }

  /**
   * Get evaluation statistics
   */
  getStats(key: string): FlagStats | null {
    const history = this.evaluationHistory.get(key);
    if (!history || history.length === 0) return null;

    const variantCounts: Record<string, number> = {};
    for (const eval_ of history) {
      const variantKey = eval_.variant || String(eval_.value);
      variantCounts[variantKey] = (variantCounts[variantKey] || 0) + 1;
    }

    return {
      key,
      totalEvaluations: history.length,
      variantCounts,
      lastEvaluated: history[history.length - 1].timestamp,
    };
  }

  /**
   * Check if context matches targeting rule
   */
  private matchesRule(rule: TargetingRule, context: FlagContext): boolean {
    const attrValue = context.attributes[rule.attribute];
    if (attrValue === undefined) return false;

    switch (rule.operator) {
      case "equals":
        return attrValue === rule.values[0];
      case "contains":
        return String(attrValue).includes(String(rule.values[0]));
      case "startsWith":
        return String(attrValue).startsWith(String(rule.values[0]));
      case "in":
        return rule.values.includes(attrValue);
      case "notIn":
        return !rule.values.includes(attrValue);
      default:
        return false;
    }
  }

  /**
   * Check if context is in rollout percentage
   */
  private isInRollout(rollout: RolloutConfig, context: FlagContext): boolean {
    const hashValue = context.attributes[rollout.hashAttribute] || context.userId || "default";
    const hash = this.simpleHash(String(hashValue));
    const bucket = hash % 100;
    return bucket < rollout.percentage;
  }

  /**
   * Select variant based on weights
   */
  private selectVariant(
    variants: FlagVariant[],
    context: FlagContext,
    flagKey: string
  ): FlagVariant | null {
    const hashValue = context.userId || context.sessionId || "default";
    const hash = this.simpleHash(`${flagKey}:${hashValue}`);
    const bucket = hash % 100;

    let cumulative = 0;
    for (const variant of variants) {
      cumulative += variant.weight;
      if (bucket < cumulative) return variant;
    }

    return variants[variants.length - 1] || null;
  }

  /**
   * Simple hash function for consistent bucketing
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Create evaluation object
   */
  private makeEvaluation(
    key: string,
    value: FlagValue,
    variant: string | undefined,
    reason: EvaluationReason
  ): FlagEvaluation {
    return { key, value, variant, reason, timestamp: Date.now() };
  }

  /**
   * Record evaluation in history
   */
  private recordEvaluation(evaluation: FlagEvaluation): FlagEvaluation {
    let history = this.evaluationHistory.get(evaluation.key);
    if (!history) {
      history = [];
      this.evaluationHistory.set(evaluation.key, history);
    }

    history.push(evaluation);
    if (history.length > this.maxHistoryPerFlag) {
      history.shift();
    }

    return evaluation;
  }
}

/**
 * Global feature flag manager
 */
export const featureFlags = new FeatureFlagManager();

// Define default Stellar-Pay feature flags
featureFlags.define({
  key: "enable_simulation_cache",
  description: "Cache swap simulation results",
  defaultValue: true,
  enabled: true,
  tags: ["performance"],
});

featureFlags.define({
  key: "enable_batch_requests",
  description: "Batch RPC requests for efficiency",
  defaultValue: true,
  enabled: true,
  tags: ["performance"],
});

featureFlags.define({
  key: "enable_reflection_loop",
  description: "Enable agent self-learning",
  defaultValue: false,
  enabled: true,
  rollout: { percentage: 50, hashAttribute: "userId" },
  tags: ["ai", "experimental"],
});

featureFlags.define({
  key: "new_swap_ui",
  description: "New swap interface",
  defaultValue: false,
  enabled: true,
  variants: [
    { key: "control", value: false, weight: 50, description: "Old UI" },
    { key: "treatment", value: true, weight: 50, description: "New UI" },
  ],
  tags: ["ui", "ab_test"],
});

featureFlags.define({
  key: "max_slippage_tolerance",
  description: "Maximum allowed slippage percentage",
  defaultValue: 0.5,
  enabled: true,
  tags: ["trading", "safety"],
});
