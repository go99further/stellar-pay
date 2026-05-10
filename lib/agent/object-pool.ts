/**
 * Object Pool — reusable resource management
 *
 * Patterns from SWE-agent connection pooling:
 * - Pre-allocate and reuse expensive objects
 * - Acquire / release lifecycle
 * - Max pool size with queuing
 * - Idle timeout eviction
 * - Health validation before reuse
 * - Pool stats
 */

export interface PoolOptions<T> {
  factory: () => T | Promise<T>;
  destroy?: (obj: T) => void | Promise<void>;
  validate?: (obj: T) => boolean | Promise<boolean>;
  minSize?: number;
  maxSize?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
}

interface PoolEntry<T> {
  obj: T;
  lastUsed: number;
}

export class ObjectPool<T> {
  private idle: PoolEntry<T>[] = [];
  private active = new Set<T>();
  private waitQueue: Array<{ resolve: (obj: T) => void; reject: (e: Error) => void }> = [];
  private factory: () => T | Promise<T>;
  private destroy?: (obj: T) => void | Promise<void>;
  private validate?: (obj: T) => boolean | Promise<boolean>;
  private minSize: number;
  private maxSize: number;
  private acquireTimeoutMs: number;
  private idleTimeoutMs?: number;
  private _created = 0;
  private _destroyed = 0;
  private _acquired = 0;
  private _released = 0;

  constructor(options: PoolOptions<T>) {
    this.factory = options.factory;
    this.destroy = options.destroy;
    this.validate = options.validate;
    this.minSize = options.minSize ?? 0;
    this.maxSize = options.maxSize ?? 10;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 5000;
    this.idleTimeoutMs = options.idleTimeoutMs;
  }

  async initialize(): Promise<void> {
    for (let i = 0; i < this.minSize; i++) {
      const obj = await this.factory();
      this._created++;
      this.idle.push({ obj, lastUsed: Date.now() });
    }
  }

  async acquire(): Promise<T> {
    // Try idle pool first
    while (this.idle.length > 0) {
      const entry = this.idle.pop()!;
      if (this.idleTimeoutMs && Date.now() - entry.lastUsed > this.idleTimeoutMs) {
        await this.destroy?.(entry.obj);
        this._destroyed++;
        continue;
      }
      if (this.validate && !(await this.validate(entry.obj))) {
        await this.destroy?.(entry.obj);
        this._destroyed++;
        continue;
      }
      this.active.add(entry.obj);
      this._acquired++;
      return entry.obj;
    }

    // Create new if under limit
    if (this.active.size + this.idle.length < this.maxSize) {
      const obj = await this.factory();
      this._created++;
      this.active.add(obj);
      this._acquired++;
      return obj;
    }

    // Wait for release
    return new Promise<T>((resolve, reject) => {
      const entry = { resolve, reject };
      this.waitQueue.push(entry);
      if (this.acquireTimeoutMs > 0) {
        const timer = setTimeout(() => {
          const idx = this.waitQueue.indexOf(entry);
          if (idx !== -1) {
            this.waitQueue.splice(idx, 1);
            reject(new Error(`Pool acquire timed out after ${this.acquireTimeoutMs}ms`));
          }
        }, this.acquireTimeoutMs);
        if (typeof timer === "object" && (timer as NodeJS.Timeout).unref) {
          (timer as NodeJS.Timeout).unref();
        }
      }
    });
  }

  async release(obj: T): Promise<void> {
    if (!this.active.has(obj)) return;
    this.active.delete(obj);
    this._released++;

    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      this.active.add(obj);
      this._acquired++;
      waiter.resolve(obj);
      return;
    }

    this.idle.push({ obj, lastUsed: Date.now() });
  }

  async withResource<R>(fn: (obj: T) => Promise<R> | R): Promise<R> {
    const obj = await this.acquire();
    try {
      return await fn(obj);
    } finally {
      await this.release(obj);
    }
  }

  async drain(): Promise<void> {
    for (const entry of this.idle) {
      await this.destroy?.(entry.obj);
      this._destroyed++;
    }
    this.idle = [];
  }

  get stats() {
    return {
      idle: this.idle.length,
      active: this.active.size,
      waiting: this.waitQueue.length,
      created: this._created,
      destroyed: this._destroyed,
      acquired: this._acquired,
      released: this._released,
    };
  }

  get size(): number { return this.idle.length + this.active.size; }
}
