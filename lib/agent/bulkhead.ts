/**
 * Bulkhead Pattern
 *
 * Inspired by Hystrix/Resilience4j bulkhead patterns:
 * - Thread pool isolation (semaphore-based in JS)
 * - Max concurrent executions per partition
 * - Queue with max wait time
 * - Rejection when at capacity
 * - Per-partition stats
 *
 * Pattern: Request → Acquire Slot → Execute → Release Slot → Stats
 */

export interface BulkheadOptions {
  maxConcurrent: number;   // max simultaneous executions
  maxQueue: number;        // max waiting requests
  maxWaitMs?: number;      // max time to wait for a slot (default: no wait)
}

export interface BulkheadStats {
  active: number;
  queued: number;
  rejected: number;
  completed: number;
  failed: number;
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class Bulkhead {
  private active = 0;
  private queue: QueueEntry[] = [];
  private stats = { rejected: 0, completed: 0, failed: 0 };
  private opts: Required<BulkheadOptions>;

  constructor(options: BulkheadOptions) {
    this.opts = { maxWaitMs: 0, ...options };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const result = await fn();
      this.stats.completed++;
      return result;
    } catch (err) {
      this.stats.failed++;
      throw err;
    } finally {
      this.release();
    }
  }

  getStats(): BulkheadStats {
    return {
      active: this.active,
      queued: this.queue.length,
      rejected: this.stats.rejected,
      completed: this.stats.completed,
      failed: this.stats.failed,
    };
  }

  private acquire(): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }

    if (this.queue.length >= this.opts.maxQueue) {
      this.stats.rejected++;
      return Promise.reject(new Error("Bulkhead full — request rejected"));
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject };

      if (this.opts.maxWaitMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            this.stats.rejected++;
            reject(new Error("Bulkhead wait timeout"));
          }
        }, this.opts.maxWaitMs);
      }

      this.queue.push(entry);
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve();
      // active stays the same — transferred to next
    } else {
      this.active--;
    }
  }
}

/**
 * BulkheadRegistry — named bulkheads for different resource partitions
 */
export class BulkheadRegistry {
  private bulkheads: Map<string, Bulkhead> = new Map();

  register(name: string, options: BulkheadOptions): this {
    this.bulkheads.set(name, new Bulkhead(options));
    return this;
  }

  get(name: string): Bulkhead {
    const bh = this.bulkheads.get(name);
    if (!bh) throw new Error(`Bulkhead not registered: ${name}`);
    return bh;
  }

  execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.get(name).execute(fn);
  }

  getAllStats(): Record<string, BulkheadStats> {
    const result: Record<string, BulkheadStats> = {};
    for (const [name, bh] of this.bulkheads.entries()) {
      result[name] = bh.getStats();
    }
    return result;
  }
}
