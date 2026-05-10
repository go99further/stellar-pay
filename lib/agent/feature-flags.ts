/**
 * Feature Flags — runtime feature toggling
 *
 * Inspired by Aider/SWE-agent gradual rollout patterns:
 * - Boolean, percentage, and user-segment flags
 * - Override per user/context
 * - Flag change listeners
 * - Evaluation audit log
 */

export type FlagValue = boolean | string | number;

export interface FlagRule {
  type: "boolean" | "percentage" | "allowlist" | "denylist";
  value: FlagValue;
  percentage?: number;
  allowlist?: string[];
  denylist?: string[];
}

export interface FlagDefinition {
  name: string;
  defaultValue: FlagValue;
  rules?: FlagRule[];
  description?: string;
}

export interface EvaluationContext {
  userId?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface EvaluationResult {
  flagName: string;
  value: FlagValue;
  reason: "default" | "rule" | "override";
  timestamp: number;
}

export class FeatureFlags {
  private flags = new Map<string, FlagDefinition>();
  private overrides = new Map<string, Map<string, FlagValue>>();
  private globalOverrides = new Map<string, FlagValue>();
  private listeners = new Map<string, Array<(value: FlagValue) => void>>();
  private auditLog: EvaluationResult[] = [];
  private maxAuditLog: number;

  constructor(options: { maxAuditLog?: number } = {}) {
    this.maxAuditLog = options.maxAuditLog ?? 200;
  }

  define(flag: FlagDefinition): void {
    this.flags.set(flag.name, flag);
  }

  evaluate(flagName: string, context: EvaluationContext = {}): FlagValue {
    const flag = this.flags.get(flagName);
    const defaultValue = flag?.defaultValue ?? false;

    // User-level override
    if (context.userId) {
      const userOverrides = this.overrides.get(context.userId);
      if (userOverrides?.has(flagName)) {
        return this.record(flagName, userOverrides.get(flagName)!, "override");
      }
    }

    // Global override
    if (this.globalOverrides.has(flagName)) {
      return this.record(flagName, this.globalOverrides.get(flagName)!, "override");
    }

    if (!flag) return this.record(flagName, defaultValue, "default");

    // Evaluate rules
    for (const rule of flag.rules ?? []) {
      const result = this.evaluateRule(rule, context);
      if (result !== null) {
        return this.record(flagName, result, "rule");
      }
    }

    return this.record(flagName, defaultValue, "default");
  }

  isEnabled(flagName: string, context: EvaluationContext = {}): boolean {
    return this.evaluate(flagName, context) === true;
  }

  setOverride(flagName: string, value: FlagValue, userId?: string): void {
    if (userId) {
      if (!this.overrides.has(userId)) this.overrides.set(userId, new Map());
      this.overrides.get(userId)!.set(flagName, value);
    } else {
      this.globalOverrides.set(flagName, value);
    }
    this.notifyListeners(flagName, value);
  }

  clearOverride(flagName: string, userId?: string): void {
    if (userId) {
      this.overrides.get(userId)?.delete(flagName);
    } else {
      this.globalOverrides.delete(flagName);
    }
  }

  onChange(flagName: string, listener: (value: FlagValue) => void): () => void {
    if (!this.listeners.has(flagName)) this.listeners.set(flagName, []);
    this.listeners.get(flagName)!.push(listener);
    return () => {
      const arr = this.listeners.get(flagName);
      if (arr) this.listeners.set(flagName, arr.filter((l) => l !== listener));
    };
  }

  getAuditLog(flagName?: string): EvaluationResult[] {
    if (!flagName) return [...this.auditLog];
    return this.auditLog.filter((e) => e.flagName === flagName);
  }

  getAllFlags(): FlagDefinition[] { return [...this.flags.values()]; }

  private evaluateRule(rule: FlagRule, context: EvaluationContext): FlagValue | null {
    switch (rule.type) {
      case "boolean":
        return rule.value;
      case "percentage": {
        if (!context.userId) return null;
        const hash = this.hashUserId(context.userId);
        return hash < (rule.percentage ?? 0) ? rule.value : null;
      }
      case "allowlist":
        if (context.userId && rule.allowlist?.includes(context.userId)) return rule.value;
        return null;
      case "denylist":
        if (context.userId && rule.denylist?.includes(context.userId)) return false;
        return null;
    }
  }

  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) % 100;
    }
    return hash;
  }

  private record(flagName: string, value: FlagValue, reason: EvaluationResult["reason"]): FlagValue {
    const entry: EvaluationResult = { flagName, value, reason, timestamp: Date.now() };
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditLog) this.auditLog.shift();
    return value;
  }

  private notifyListeners(flagName: string, value: FlagValue): void {
    for (const listener of this.listeners.get(flagName) ?? []) {
      listener(value);
    }
  }
}
