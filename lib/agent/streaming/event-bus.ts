/**
 * Event Bus
 *
 * Inspired by production event-driven architecture patterns:
 * - Publish/subscribe with typed events
 * - Wildcard subscriptions
 * - Event replay for late subscribers
 * - Dead letter queue for unhandled events
 * - Middleware pipeline (logging, filtering, transformation)
 *
 * Pattern: Publish → Route → Filter → Deliver → Acknowledge
 */

export interface EventEnvelope<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  timestamp: number;
  source: string;
  correlationId?: string;
  retryCount: number;
}

export interface Subscription {
  id: string;
  topic: string; // supports "*" wildcard
  handler: EventHandler;
  filter?: (event: EventEnvelope) => boolean;
  once: boolean;
  createdAt: number;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;
export type Middleware = (event: EventEnvelope, next: () => Promise<void>) => Promise<void>;

export interface EventBusConfig {
  maxReplayBuffer: number;  // max events to keep for replay
  deadLetterEnabled: boolean;
  maxRetries: number;
}

export interface EventBusStats {
  published: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  activeSubscriptions: number;
}

/**
 * Event Bus
 * Typed publish/subscribe with middleware and replay
 */
export class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private replayBuffer: EventEnvelope[] = [];
  private deadLetterQueue: EventEnvelope[] = [];
  private middlewares: Middleware[] = [];
  private config: EventBusConfig;
  private stats: EventBusStats = {
    published: 0,
    delivered: 0,
    failed: 0,
    deadLettered: 0,
    activeSubscriptions: 0,
  };

  constructor(config: Partial<EventBusConfig> = {}) {
    this.config = {
      maxReplayBuffer: 100,
      deadLetterEnabled: true,
      maxRetries: 3,
      ...config,
    };
  }

  /**
   * Subscribe to a topic
   */
  subscribe<T = unknown>(
    topic: string,
    handler: EventHandler<T>,
    options: { filter?: (event: EventEnvelope<T>) => boolean; once?: boolean } = {}
  ): string {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.subscriptions.set(subId, {
      id: subId,
      topic,
      handler: handler as EventHandler,
      filter: options.filter as ((event: EventEnvelope) => boolean) | undefined,
      once: options.once ?? false,
      createdAt: Date.now(),
    });
    this.stats.activeSubscriptions++;
    return subId;
  }

  /**
   * Subscribe once — auto-unsubscribes after first delivery
   */
  once<T = unknown>(topic: string, handler: EventHandler<T>): string {
    return this.subscribe(topic, handler, { once: true });
  }

  /**
   * Unsubscribe by subscription ID
   */
  unsubscribe(subId: string): boolean {
    const removed = this.subscriptions.delete(subId);
    if (removed) this.stats.activeSubscriptions--;
    return removed;
  }

  /**
   * Add middleware to the processing pipeline
   */
  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Publish an event
   */
  async publish<T = unknown>(
    topic: string,
    payload: T,
    options: { source?: string; correlationId?: string } = {}
  ): Promise<void> {
    const event: EventEnvelope<T> = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      topic,
      payload,
      timestamp: Date.now(),
      source: options.source ?? "unknown",
      correlationId: options.correlationId,
      retryCount: 0,
    };

    this.stats.published++;

    // Buffer for replay
    this.replayBuffer.push(event as EventEnvelope);
    if (this.replayBuffer.length > this.config.maxReplayBuffer) {
      this.replayBuffer.shift();
    }

    await this.dispatch(event as EventEnvelope);
  }

  /**
   * Replay buffered events to a new subscriber
   */
  async replay(subId: string, fromTimestamp = 0): Promise<number> {
    const sub = this.subscriptions.get(subId);
    if (!sub) return 0;

    const events = this.replayBuffer.filter(
      (e) => e.timestamp >= fromTimestamp && this.topicMatches(sub.topic, e.topic)
    );

    for (const event of events) {
      if (!sub.filter || sub.filter(event)) {
        await sub.handler(event);
      }
    }

    return events.length;
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue(): EventEnvelope[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry dead-lettered events
   */
  async retryDeadLetters(): Promise<number> {
    const toRetry = [...this.deadLetterQueue];
    this.deadLetterQueue = [];
    this.stats.deadLettered -= toRetry.length;

    let retried = 0;
    for (const event of toRetry) {
      event.retryCount++;
      await this.dispatch(event);
      retried++;
    }
    return retried;
  }

  /**
   * Get statistics
   */
  getStats(): EventBusStats {
    return { ...this.stats };
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscriptions.clear();
    this.stats.activeSubscriptions = 0;
  }

  private async dispatch(event: EventEnvelope): Promise<void> {
    const matching = this.getMatchingSubscriptions(event.topic);

    if (matching.length === 0 && this.config.deadLetterEnabled) {
      this.deadLetterQueue.push(event);
      this.stats.deadLettered++;
      return;
    }

    for (const sub of matching) {
      if (sub.filter && !sub.filter(event)) continue;

      try {
        await this.runMiddleware(event, async () => {
          await sub.handler(event);
          this.stats.delivered++;
        });

        if (sub.once) {
          this.unsubscribe(sub.id);
        }
      } catch {
        this.stats.failed++;
        if (event.retryCount < this.config.maxRetries) {
          event.retryCount++;
          // Re-queue for retry (fire-and-forget)
          void this.dispatch(event);
        } else if (this.config.deadLetterEnabled) {
          this.deadLetterQueue.push(event);
          this.stats.deadLettered++;
        }
      }
    }
  }

  private async runMiddleware(event: EventEnvelope, final: () => Promise<void>): Promise<void> {
    const chain = [...this.middlewares, async (_e: EventEnvelope, next: () => Promise<void>) => { await final(); await next(); }];
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < chain.length) {
        const mw = chain[index++];
        await mw(event, next);
      }
    };

    await next();
  }

  private getMatchingSubscriptions(topic: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter((sub) =>
      this.topicMatches(sub.topic, topic)
    );
  }

  private topicMatches(pattern: string, topic: string): boolean {
    if (pattern === "*") return true;
    if (pattern === topic) return true;
    // Support prefix wildcard: "swap.*" matches "swap.completed"
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return topic.startsWith(prefix + ".");
    }
    return false;
  }
}

export const eventBus = new EventBus();
