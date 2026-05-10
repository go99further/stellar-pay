/**
 * Price Monitor (Streaming Subscription)
 *
 * Inspired by Plandex's streaming subscription pattern:
 * - Real-time price updates via polling
 * - Heartbeat mechanism for connection health
 * - Automatic reconnection on failure
 * - Event-driven notifications
 *
 * Pattern: Subscribe → Poll → Notify → Heartbeat → Reconnect
 */

export type PriceEventType = "price_update" | "alert_triggered" | "error" | "heartbeat";

export interface PriceEvent {
  type: PriceEventType;
  timestamp: number;
  data: PriceData | AlertData | ErrorData | HeartbeatData;
}

export interface PriceData {
  tokenPair: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  lastUpdated: number;
}

export interface AlertData {
  alertId: string;
  tokenPair: string;
  targetPrice: number;
  currentPrice: number;
  condition: "above" | "below";
}

export interface ErrorData {
  message: string;
  code?: string;
  retryable: boolean;
}

export interface HeartbeatData {
  status: "healthy" | "degraded";
  lastPollTime: number;
  missedPolls: number;
}

export type PriceEventHandler = (event: PriceEvent) => void;

export interface SubscriptionConfig {
  pollInterval: number; // milliseconds
  heartbeatInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number; // milliseconds
  timeout: number; // milliseconds
}

/**
 * Price Monitor
 * Monitors token prices and triggers alerts via streaming subscription
 */
export class PriceMonitor {
  private subscriptions: Map<string, Subscription> = new Map();
  private config: SubscriptionConfig;
  private isRunning = false;
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastPollTime = 0;
  private missedPolls = 0;

  constructor(config: Partial<SubscriptionConfig> = {}) {
    this.config = {
      pollInterval: 30000, // 30 seconds
      heartbeatInterval: 60000, // 1 minute
      maxRetries: 3,
      retryDelay: 5000, // 5 seconds
      timeout: 10000, // 10 seconds
      ...config,
    };
  }

  /**
   * Subscribe to price updates for a token pair
   */
  subscribe(
    tokenPair: string,
    handler: PriceEventHandler,
    alerts: Array<{ targetPrice: number; condition: "above" | "below" }> = []
  ): string {
    const subscriptionId = this.generateSubscriptionId();

    const subscription: Subscription = {
      id: subscriptionId,
      tokenPair,
      handler,
      alerts: alerts.map((alert) => ({
        ...alert,
        id: this.generateAlertId(),
        triggered: false,
      })),
      active: true,
      createdAt: Date.now(),
      lastUpdate: 0,
      errorCount: 0,
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Start monitoring if not already running
    if (!this.isRunning) {
      this.start();
    }

    return subscriptionId;
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribe(subscriptionId: string): boolean {
    const deleted = this.subscriptions.delete(subscriptionId);

    // Stop monitoring if no active subscriptions
    if (this.subscriptions.size === 0) {
      this.stop();
    }

    return deleted;
  }

  /**
   * Add alert to existing subscription
   */
  addAlert(
    subscriptionId: string,
    targetPrice: number,
    condition: "above" | "below"
  ): string | null {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      return null;
    }

    const alertId = this.generateAlertId();

    subscription.alerts.push({
      id: alertId,
      targetPrice,
      condition,
      triggered: false,
    });

    return alertId;
  }

  /**
   * Remove alert from subscription
   */
  removeAlert(subscriptionId: string, alertId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);

    if (!subscription) {
      return false;
    }

    const index = subscription.alerts.findIndex((a) => a.id === alertId);

    if (index === -1) {
      return false;
    }

    subscription.alerts.splice(index, 1);
    return true;
  }

  /**
   * Start monitoring
   */
  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.lastPollTime = Date.now();
    this.missedPolls = 0;

    // Start polling
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.config.pollInterval);

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Initial poll
    void this.poll();
  }

  /**
   * Stop monitoring
   */
  private stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * Poll for price updates
   */
  private async poll(): Promise<void> {
    const now = Date.now();

    try {
      // Get unique token pairs
      const tokenPairs = new Set(
        Array.from(this.subscriptions.values()).map((s) => s.tokenPair)
      );

      // Fetch prices for all token pairs
      const prices = await this.fetchPrices(Array.from(tokenPairs));

      // Update subscriptions and check alerts
      for (const subscription of this.subscriptions.values()) {
        if (!subscription.active) continue;

        const priceData = prices.get(subscription.tokenPair);

        if (!priceData) {
          subscription.errorCount++;
          this.notifyError(subscription, "Price data not available", true);
          continue;
        }

        // Reset error count on success
        subscription.errorCount = 0;
        subscription.lastUpdate = now;

        // Notify price update
        this.notifyPriceUpdate(subscription, priceData);

        // Check alerts
        this.checkAlerts(subscription, priceData);
      }

      this.lastPollTime = now;
      this.missedPolls = 0;
    } catch (error) {
      this.missedPolls++;

      // Notify all subscriptions of error
      for (const subscription of this.subscriptions.values()) {
        this.notifyError(
          subscription,
          error instanceof Error ? error.message : "Poll failed",
          true
        );
      }

      // Retry if under max retries
      if (this.missedPolls < this.config.maxRetries) {
        setTimeout(() => {
          void this.poll();
        }, this.config.retryDelay);
      }
    }
  }

  /**
   * Fetch prices from contract
   */
  private async fetchPrices(tokenPairs: string[]): Promise<Map<string, PriceData>> {
    const prices = new Map<string, PriceData>();

    // Stub: In real implementation, call contract get_reserves
    for (const pair of tokenPairs) {
      prices.set(pair, {
        tokenPair: pair,
        price: 1.0 + Math.random() * 0.1, // Stub: random price
        priceChange24h: (Math.random() - 0.5) * 10, // -5% to +5%
        volume24h: Math.random() * 1000000,
        lastUpdated: Date.now(),
      });
    }

    return prices;
  }

  /**
   * Check alerts for a subscription
   */
  private checkAlerts(subscription: Subscription, priceData: PriceData): void {
    for (const alert of subscription.alerts) {
      if (alert.triggered) continue;

      const shouldTrigger =
        (alert.condition === "above" && priceData.price >= alert.targetPrice) ||
        (alert.condition === "below" && priceData.price <= alert.targetPrice);

      if (shouldTrigger) {
        alert.triggered = true;

        const event: PriceEvent = {
          type: "alert_triggered",
          timestamp: Date.now(),
          data: {
            alertId: alert.id,
            tokenPair: subscription.tokenPair,
            targetPrice: alert.targetPrice,
            currentPrice: priceData.price,
            condition: alert.condition,
          },
        };

        subscription.handler(event);
      }
    }
  }

  /**
   * Notify price update
   */
  private notifyPriceUpdate(subscription: Subscription, priceData: PriceData): void {
    const event: PriceEvent = {
      type: "price_update",
      timestamp: Date.now(),
      data: priceData,
    };

    subscription.handler(event);
  }

  /**
   * Notify error
   */
  private notifyError(subscription: Subscription, message: string, retryable: boolean): void {
    const event: PriceEvent = {
      type: "error",
      timestamp: Date.now(),
      data: {
        message,
        retryable,
      },
    };

    subscription.handler(event);
  }

  /**
   * Send heartbeat to all subscriptions
   */
  private sendHeartbeat(): void {
    const status: HeartbeatData["status"] =
      this.missedPolls > 0 ? "degraded" : "healthy";

    const event: PriceEvent = {
      type: "heartbeat",
      timestamp: Date.now(),
      data: {
        status,
        lastPollTime: this.lastPollTime,
        missedPolls: this.missedPolls,
      },
    };

    for (const subscription of this.subscriptions.values()) {
      if (subscription.active) {
        subscription.handler(event);
      }
    }
  }

  /**
   * Get subscription status
   */
  getStatus(): {
    isRunning: boolean;
    subscriptionCount: number;
    lastPollTime: number;
    missedPolls: number;
  } {
    return {
      isRunning: this.isRunning,
      subscriptionCount: this.subscriptions.size,
      lastPollTime: this.lastPollTime,
      missedPolls: this.missedPolls,
    };
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.stop();
    this.subscriptions.clear();
  }
}

interface Subscription {
  id: string;
  tokenPair: string;
  handler: PriceEventHandler;
  alerts: Array<{
    id: string;
    targetPrice: number;
    condition: "above" | "below";
    triggered: boolean;
  }>;
  active: boolean;
  createdAt: number;
  lastUpdate: number;
  errorCount: number;
}

/**
 * Global price monitor instance
 */
export const priceMonitor = new PriceMonitor();

/**
 * Usage example:
 *
 * // Subscribe to price updates
 * const subscriptionId = priceMonitor.subscribe(
 *   "TKNA/TKNB",
 *   (event) => {
 *     if (event.type === "price_update") {
 *       const data = event.data as PriceData;
 *       console.log("Price:", data.price);
 *     } else if (event.type === "alert_triggered") {
 *       const data = event.data as AlertData;
 *       console.log("Alert triggered:", data);
 *     } else if (event.type === "heartbeat") {
 *       const data = event.data as HeartbeatData;
 *       console.log("Heartbeat:", data.status);
 *     }
 *   },
 *   [
 *     { targetPrice: 1.2, condition: "above" },
 *     { targetPrice: 0.9, condition: "below" },
 *   ]
 * );
 *
 * // Add alert later
 * priceMonitor.addAlert(subscriptionId, 1.5, "above");
 *
 * // Unsubscribe
 * priceMonitor.unsubscribe(subscriptionId);
 */
