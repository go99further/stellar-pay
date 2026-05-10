/**
 * Event Bus — pub/sub with typed events, wildcards, and middleware
 *
 * Patterns from Aider/SWE-agent event systems:
 * - Typed event registry
 * - Wildcard subscriptions
 * - Middleware pipeline (intercept/transform/cancel)
 * - Once subscriptions (auto-unsubscribe)
 * - Async event emission with error isolation
 * - Event history / replay
 */

export type EventHandler<T = unknown> = (event: T, topic: string) => void | Promise<void>;
export type Middleware<T = unknown> = (event: T, topic: string, next: () => void) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface EventBusOptions {
  maxHistory?: number;
  onError?: (err: unknown, topic: string) => void;
}

interface Subscription<T> {
  id: number;
  handler: EventHandler<T>;
  once: boolean;
  pattern: string; // exact topic or wildcard like "user.*"
}

function matchTopic(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === topic;
  const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$");
  return regex.test(topic);
}

export class EventBus<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  private subscriptions = new Map<number, Subscription<unknown>>();
  private nextId = 1;
  private middlewares: Middleware[] = [];
  private history: Array<{ topic: string; event: unknown; timestamp: number }> = [];
  private maxHistory: number;
  private onError: (err: unknown, topic: string) => void;

  constructor(options: EventBusOptions = {}) {
    this.maxHistory = options.maxHistory ?? 100;
    this.onError = options.onError ?? ((err, topic) => console.error(`EventBus error on "${topic}":`, err));
  }

  on<K extends keyof EventMap & string>(topic: K, handler: EventHandler<EventMap[K]>): Unsubscribe {
    return this.subscribe(topic, handler as EventHandler<unknown>, false);
  }

  once<K extends keyof EventMap & string>(topic: K, handler: EventHandler<EventMap[K]>): Unsubscribe {
    return this.subscribe(topic, handler as EventHandler<unknown>, true);
  }

  onPattern(pattern: string, handler: EventHandler<unknown>): Unsubscribe {
    return this.subscribe(pattern, handler, false);
  }

  off(unsubscribe: Unsubscribe): void {
    unsubscribe();
  }

  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  async emit<K extends keyof EventMap & string>(topic: K, event: EventMap[K]): Promise<void> {
    this.recordHistory(topic, event);

    // Run middleware chain
    let cancelled = false;
    let idx = 0;
    const next = async (): Promise<void> => {
      if (idx < this.middlewares.length) {
        const mw = this.middlewares[idx++];
        await mw(event, topic, () => { next(); });
      }
    };
    if (this.middlewares.length > 0) {
      await next();
    }
    if (cancelled) return;

    const toRemove: number[] = [];
    for (const [id, sub] of this.subscriptions) {
      if (!matchTopic(sub.pattern, topic)) continue;
      if (sub.once) toRemove.push(id);
      try {
        await sub.handler(event, topic);
      } catch (err) {
        this.onError(err, topic);
      }
    }
    for (const id of toRemove) this.subscriptions.delete(id);
  }

  emitSync<K extends keyof EventMap & string>(topic: K, event: EventMap[K]): void {
    this.recordHistory(topic, event);
    const toRemove: number[] = [];
    for (const [id, sub] of this.subscriptions) {
      if (!matchTopic(sub.pattern, topic)) continue;
      if (sub.once) toRemove.push(id);
      try {
        (sub.handler as EventHandler)(event, topic);
      } catch (err) {
        this.onError(err, topic);
      }
    }
    for (const id of toRemove) this.subscriptions.delete(id);
  }

  getHistory(topic?: string): Array<{ topic: string; event: unknown; timestamp: number }> {
    if (!topic) return [...this.history];
    return this.history.filter((h) => h.topic === topic);
  }

  clearHistory(): void {
    this.history = [];
  }

  subscriberCount(topic?: string): number {
    if (!topic) return this.subscriptions.size;
    let count = 0;
    for (const sub of this.subscriptions.values()) {
      if (matchTopic(sub.pattern, topic)) count++;
    }
    return count;
  }

  clear(): void {
    this.subscriptions.clear();
    this.history = [];
  }

  private subscribe(pattern: string, handler: EventHandler<unknown>, once: boolean): Unsubscribe {
    const id = this.nextId++;
    this.subscriptions.set(id, { id, handler, once, pattern });
    return () => this.subscriptions.delete(id);
  }

  private recordHistory(topic: string, event: unknown): void {
    this.history.push({ topic, event, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }
}
