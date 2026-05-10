/**
 * Distributed Lock
 *
 * Inspired by Redis SETNX / Redlock patterns:
 * - Mutual exclusion for critical sections
 * - TTL-based auto-release (prevents deadlocks)
 * - Reentrant locks (same owner can re-acquire)
 * - Lock extension (refresh TTL while holding)
 * - Wait queue with timeout
 *
 * Pattern: Acquire → Execute → Release | Expire
 */

export interface LockOptions {
  ttl: number;          // ms before auto-release
  waitTimeout: number;  // ms to wait for lock acquisition
  reentrant: boolean;   // allow same owner to re-acquire
}

export interface LockRecord {
  key: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
  depth: number;        // reentrant depth
}

export interface LockStats {
  acquired: number;
  released: number;
  expired: number;
  contentions: number;  // times a lock was already held on acquire attempt
  timeouts: number;
}

type WaitEntry = {
  resolve: (lock: LockRecord) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
};

/**
 * In-process Distributed Lock Manager
 */
export class LockManager {
  private locks: Map<string, LockRecord> = new Map();
  private waitQueues: Map<string, WaitEntry[]> = new Map();
  private stats: LockStats = {
    acquired: 0,
    released: 0,
    expired: 0,
    contentions: 0,
    timeouts: 0,
  };
  private cleanupTimer: NodeJS.Timeout;

  constructor(cleanupIntervalMs = 5000) {
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), cleanupIntervalMs);
  }

  /**
   * Acquire a lock
   */
  async acquire(key: string, owner: string, options: Partial<LockOptions> = {}): Promise<LockRecord> {
    const opts: LockOptions = {
      ttl: 30000,
      waitTimeout: 5000,
      reentrant: true,
      ...options,
    };

    const existing = this.locks.get(key);

    // Check if expired
    if (existing && Date.now() > existing.expiresAt) {
      this.locks.delete(key);
      this.stats.expired++;
      this.drainWaitQueue(key);
    }

    const current = this.locks.get(key);

    // Reentrant: same owner re-acquires
    if (current && current.owner === owner && opts.reentrant) {
      current.depth++;
      current.expiresAt = Date.now() + opts.ttl;
      this.stats.acquired++;
      return current;
    }

    // Lock is free
    if (!current) {
      const lock: LockRecord = {
        key,
        owner,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + opts.ttl,
        depth: 1,
      };
      this.locks.set(key, lock);
      this.stats.acquired++;
      return lock;
    }

    // Lock is held by someone else — wait
    this.stats.contentions++;

    if (opts.waitTimeout <= 0) {
      throw new Error(`Lock "${key}" is held by "${current.owner}"`);
    }

    return this.waitForLock(key, owner, opts);
  }

  /**
   * Release a lock
   */
  release(key: string, owner: string): boolean {
    const lock = this.locks.get(key);
    if (!lock || lock.owner !== owner) return false;

    lock.depth--;
    if (lock.depth <= 0) {
      this.locks.delete(key);
      this.stats.released++;
      this.drainWaitQueue(key);
    }
    return true;
  }

  /**
   * Extend lock TTL
   */
  extend(key: string, owner: string, additionalMs: number): boolean {
    const lock = this.locks.get(key);
    if (!lock || lock.owner !== owner) return false;
    if (Date.now() > lock.expiresAt) return false;
    lock.expiresAt += additionalMs;
    return true;
  }

  /**
   * Execute a function while holding a lock
   */
  async withLock<T>(
    key: string,
    owner: string,
    fn: () => Promise<T>,
    options: Partial<LockOptions> = {}
  ): Promise<T> {
    const lock = await this.acquire(key, owner, options);
    try {
      return await fn();
    } finally {
      this.release(key, lock.owner);
    }
  }

  /**
   * Check if a key is locked
   */
  isLocked(key: string): boolean {
    const lock = this.locks.get(key);
    if (!lock) return false;
    if (Date.now() > lock.expiresAt) {
      this.locks.delete(key);
      this.stats.expired++;
      return false;
    }
    return true;
  }

  /**
   * Get lock info
   */
  getLock(key: string): LockRecord | null {
    const lock = this.locks.get(key);
    if (!lock) return null;
    if (Date.now() > lock.expiresAt) {
      this.locks.delete(key);
      this.stats.expired++;
      return null;
    }
    return { ...lock };
  }

  /**
   * Get statistics
   */
  getStats(): LockStats {
    return { ...this.stats };
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  private waitForLock(key: string, owner: string, opts: LockOptions): Promise<LockRecord> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const queue = this.waitQueues.get(key) ?? [];
        const idx = queue.findIndex((e) => e.timeout === timeout);
        if (idx !== -1) queue.splice(idx, 1);
        this.stats.timeouts++;
        reject(new Error(`Timeout waiting for lock "${key}" after ${opts.waitTimeout}ms`));
      }, opts.waitTimeout);

      const entry: WaitEntry = { resolve: (lock) => resolve(lock), reject, timeout };
      const queue = this.waitQueues.get(key) ?? [];
      queue.push(entry);
      this.waitQueues.set(key, queue);
    });
  }

  private drainWaitQueue(key: string): void {
    const queue = this.waitQueues.get(key);
    if (!queue || queue.length === 0) return;

    const waiter = queue.shift()!;
    clearTimeout(waiter.timeout);

    const lock: LockRecord = {
      key,
      owner: "unknown", // will be set by the waiter's acquire call
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 30000,
      depth: 1,
    };
    this.locks.set(key, lock);
    this.stats.acquired++;
    waiter.resolve(lock);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks.entries()) {
      if (now > lock.expiresAt) {
        this.locks.delete(key);
        this.stats.expired++;
        this.drainWaitQueue(key);
      }
    }
  }
}

export const lockManager = new LockManager();
