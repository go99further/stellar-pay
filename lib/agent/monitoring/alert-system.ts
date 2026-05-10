/**
 * Alert System
 *
 * Inspired by production monitoring patterns:
 * - Rule-based alert triggering
 * - Multiple notification channels
 * - Alert deduplication and grouping
 * - Severity levels and escalation
 * - Alert history and analytics
 *
 * Pattern: Monitor → Evaluate → Trigger → Notify → Track
 */

export type AlertSeverity = "info" | "warning" | "critical" | "fatal";
export type AlertStatus = "active" | "resolved" | "silenced" | "acknowledged";

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: (context: AlertContext) => boolean;
  severity: AlertSeverity;
  cooldown: number; // ms between repeated alerts
  tags: string[];
}

export interface AlertContext {
  metric: string;
  value: number;
  threshold?: number;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  context: AlertContext;
  firedAt: number;
  resolvedAt?: number;
  acknowledgedAt?: number;
  notificationsSent: number;
}

export interface NotificationChannel {
  name: string;
  send: (alert: Alert) => Promise<void>;
  severities: AlertSeverity[]; // Which severities to handle
}

export interface AlertStats {
  totalAlerts: number;
  activeAlerts: number;
  resolvedAlerts: number;
  bySeverity: Record<AlertSeverity, number>;
  averageResolutionTime: number;
}

/**
 * Alert System
 * Rule-based alerting with multiple notification channels
 */
export class AlertSystem {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Map<string, Alert> = new Map();
  private channels: NotificationChannel[] = [];
  private lastFired: Map<string, number> = new Map(); // ruleId -> timestamp

  /**
   * Register an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove an alert rule
   */
  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Add notification channel
   */
  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  /**
   * Evaluate all rules against context
   */
  async evaluate(context: AlertContext): Promise<Alert[]> {
    const triggered: Alert[] = [];

    for (const rule of this.rules.values()) {
      // Check cooldown
      const lastFiredAt = this.lastFired.get(rule.id) || 0;
      if (Date.now() - lastFiredAt < rule.cooldown) continue;

      // Evaluate condition
      let conditionMet = false;
      try {
        conditionMet = rule.condition(context);
      } catch {
        continue;
      }

      if (!conditionMet) continue;

      // Create alert
      const alert = this.createAlert(rule, context);
      this.alerts.set(alert.id, alert);
      this.lastFired.set(rule.id, Date.now());
      triggered.push(alert);

      // Send notifications
      await this.notify(alert);
    }

    return triggered;
  }

  /**
   * Manually fire an alert
   */
  async fire(
    ruleId: string,
    context: AlertContext,
    message?: string
  ): Promise<Alert | null> {
    const rule = this.rules.get(ruleId);
    if (!rule) return null;

    const alert = this.createAlert(rule, context, message);
    this.alerts.set(alert.id, alert);
    await this.notify(alert);
    return alert;
  }

  /**
   * Resolve an alert
   */
  resolve(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== "active") return false;

    alert.status = "resolved";
    alert.resolvedAt = Date.now();
    return true;
  }

  /**
   * Acknowledge an alert
   */
  acknowledge(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== "active") return false;

    alert.status = "acknowledged";
    alert.acknowledgedAt = Date.now();
    return true;
  }

  /**
   * Silence an alert
   */
  silence(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.status = "silenced";
    return true;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter((a) => a.status === "active")
      .sort((a, b) => {
        const severityOrder: Record<AlertSeverity, number> = {
          fatal: 4, critical: 3, warning: 2, info: 1,
        };
        return severityOrder[b.severity] - severityOrder[a.severity];
      });
  }

  /**
   * Get alert history
   */
  getHistory(limit = 50): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.firedAt - a.firedAt)
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats(): AlertStats {
    const all = Array.from(this.alerts.values());
    const bySeverity: Record<AlertSeverity, number> = {
      info: 0, warning: 0, critical: 0, fatal: 0,
    };

    let totalResolutionTime = 0;
    let resolvedCount = 0;

    for (const alert of all) {
      bySeverity[alert.severity]++;
      if (alert.resolvedAt) {
        totalResolutionTime += alert.resolvedAt - alert.firedAt;
        resolvedCount++;
      }
    }

    return {
      totalAlerts: all.length,
      activeAlerts: all.filter((a) => a.status === "active").length,
      resolvedAlerts: resolvedCount,
      bySeverity,
      averageResolutionTime: resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0,
    };
  }

  /**
   * Create alert from rule and context
   */
  private createAlert(
    rule: AlertRule,
    context: AlertContext,
    message?: string
  ): Alert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      status: "active",
      message: message || `${rule.name}: ${context.metric} = ${context.value}`,
      context,
      firedAt: Date.now(),
      notificationsSent: 0,
    };
  }

  /**
   * Send notifications for alert
   */
  private async notify(alert: Alert): Promise<void> {
    for (const channel of this.channels) {
      if (!channel.severities.includes(alert.severity)) continue;
      try {
        await channel.send(alert);
        alert.notificationsSent++;
      } catch {
        // Notification failure should not block alert creation
      }
    }
  }
}

/**
 * Pre-built alert rules for Stellar-Pay
 */
export const stellarPayAlertRules: AlertRule[] = [
  {
    id: "high_slippage",
    name: "High Slippage",
    description: "Swap slippage exceeds threshold",
    condition: (ctx) => ctx.metric === "slippage" && ctx.value > 0.05,
    severity: "warning",
    cooldown: 60000,
    tags: ["trading", "slippage"],
  },
  {
    id: "low_liquidity",
    name: "Low Pool Liquidity",
    description: "Pool liquidity below minimum",
    condition: (ctx) => ctx.metric === "pool_liquidity" && ctx.value < 1000,
    severity: "critical",
    cooldown: 300000,
    tags: ["pool", "liquidity"],
  },
  {
    id: "high_error_rate",
    name: "High Error Rate",
    description: "Error rate exceeds 10%",
    condition: (ctx) => ctx.metric === "error_rate" && ctx.value > 0.1,
    severity: "critical",
    cooldown: 120000,
    tags: ["reliability"],
  },
  {
    id: "rpc_latency",
    name: "High RPC Latency",
    description: "RPC response time exceeds 5s",
    condition: (ctx) => ctx.metric === "rpc_latency_ms" && ctx.value > 5000,
    severity: "warning",
    cooldown: 60000,
    tags: ["performance", "rpc"],
  },
  {
    id: "circuit_breaker_open",
    name: "Circuit Breaker Open",
    description: "Circuit breaker has opened",
    condition: (ctx) => ctx.metric === "circuit_breaker_state" && ctx.value === 1,
    severity: "fatal",
    cooldown: 30000,
    tags: ["reliability", "circuit_breaker"],
  },
];

/**
 * Global alert system
 */
export const alertSystem = new AlertSystem();

// Register default rules
for (const rule of stellarPayAlertRules) {
  alertSystem.addRule(rule);
}
