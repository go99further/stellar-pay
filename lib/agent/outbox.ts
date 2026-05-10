/**
 * Outbox Pattern
 *
 * Inspired by transactional outbox patterns (microservices):
 * - Atomic write: business data + outbox message in same transaction
 * - Reliable message delivery (at-least-once)
 * - Message deduplication (idempotency key)
 * - Retry with exponential backoff
 * - Dead letter after max retries
 *
 * Pattern: Write → Outbox → Poll → Publish → Acknowledge
 */

export type OutboxStatus = "pending" | "processing" | "delivered" | "dead";

export interface OutboxMessage<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  nextRetryAt: number;
  lastError?: string;
  idempotencyKey?: string;
}

export interface OutboxPublisher<T = unknown> {
  publish(message: OutboxMessage<T>): Promise<void>;
}

export interface OutboxOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  pollIntervalMs?: number;
}

let idCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${++idCounter}`;
}

export class OutboxStore<T = unknown> {
  private messages: Map<string, OutboxMessage<T>> = new Map();
  private delivered: Map<string, OutboxMessage<T>> = new Map();
  private dead: Map<string, OutboxMessage<T>> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // key → id
  private opts: Required<OutboxOptions>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private publisher?: OutboxPublisher<T>;

  constructor(options: OutboxOptions = {}) {
    this.opts = {
      maxAttempts: 5,
      baseDelayMs: 100,
      pollIntervalMs: 500,
      ...options,
    };
  }

  write(topic: string, payload: T, idempotencyKey?: string): OutboxMessage<T> {
    // Deduplication
    if (idempotencyKey && this.idempotencyIndex.has(idempotencyKey)) {
      const existing = this.messages.get(this.idempotencyIndex.get(idempotencyKey)!)
        ?? this.delivered.get(this.idempotencyIndex.get(idempotencyKey)!);
      if (existing) return existing;
    }

    const msg: OutboxMessage<T> = {
      id: generateId(),
      topic,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts: this.opts.maxAttempts,
      createdAt: Date.now(),
      nextRetryAt: Date.now(),
      idempotencyKey,
    };

    this.messages.set(msg.id, msg);
    if (idempotencyKey) this.idempotencyIndex.set(idempotencyKey, msg.id);
    return msg;
  }

  async processNext(publisher: OutboxPublisher<T>): Promise<OutboxMessage<T> | null> {
    const now = Date.now();
    const pending = [...this.messages.values()].find(
      (m) => m.status === "pending" && m.nextRetryAt <= now
    );
    if (!pending) return null;

    pending.status = "processing";
    pending.attempts++;

    try {
      await publisher.publish(pending);
      pending.status = "delivered";
      this.messages.delete(pending.id);
      this.delivered.set(pending.id, pending);
      return pending;
    } catch (err) {
      pending.lastError = String(err);
      if (pending.attempts >= pending.maxAttempts) {
        pending.status = "dead";
        this.messages.delete(pending.id);
        this.dead.set(pending.id, pending);
      } else {
        pending.status = "pending";
        pending.nextRetryAt = now + this.opts.baseDelayMs * Math.pow(2, pending.attempts - 1);
      }
      return pending;
    }
  }

  async processAll(publisher: OutboxPublisher<T>): Promise<OutboxMessage<T>[]> {
    const processed: OutboxMessage<T>[] = [];
    let msg: OutboxMessage<T> | null;
    while ((msg = await this.processNext(publisher)) !== null) {
      processed.push(msg);
    }
    return processed;
  }

  startPolling(publisher: OutboxPublisher<T>): void {
    this.publisher = publisher;
    this.pollTimer = setInterval(() => this.processAll(publisher), this.opts.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  getPending(): OutboxMessage<T>[] {
    return [...this.messages.values()].filter((m) => m.status === "pending");
  }

  getDelivered(): OutboxMessage<T>[] {
    return [...this.delivered.values()];
  }

  getDead(): OutboxMessage<T>[] {
    return [...this.dead.values()];
  }

  getStats() {
    return {
      pending: this.getPending().length,
      delivered: this.delivered.size,
      dead: this.dead.size,
      total: this.messages.size + this.delivered.size + this.dead.size,
    };
  }

  requeue(id: string): boolean {
    const msg = this.dead.get(id);
    if (!msg) return false;
    msg.status = "pending";
    msg.attempts = 0;
    msg.nextRetryAt = Date.now();
    msg.lastError = undefined;
    this.dead.delete(id);
    this.messages.set(id, msg);
    return true;
  }
}
