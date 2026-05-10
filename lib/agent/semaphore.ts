/**
 * Semaphore & Mutex — concurrency primitives
 *
 * Patterns from SWE-agent/Plandex concurrent execution:
 * - Semaphore: limit concurrent access to N slots
 * - Mutex: exclusive lock (semaphore with N=1)
 * - tryAcquire: non-blocking attempt
 * - withLock: RAII-style auto-release
 * - Fair queuing (FIFO)
 * - Timeout support
 */

export class Semaphore {
  private permits: number;
  private queue: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(private readonly maxPermits: number) {
    this.permits = maxPermits;
  }

  async acquire(timeoutMs?: number): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject };
      this.queue.push(entry);

      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error(`Semaphore acquire timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        // Prevent timer from keeping process alive
        if (typeof timer === "object" && timer.unref) timer.unref();
      }
    });
  }

  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  async withLock<T>(fn: () => Promise<T> | T, timeoutMs?: number): Promise<T> {
    await this.acquire(timeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get available(): number { return this.permits; }
  get waiting(): number { return this.queue.length; }
}

export class Mutex extends Semaphore {
  constructor() { super(1); }

  get locked(): boolean { return this.available === 0; }
}

export class ReadWriteLock {
  private readers = 0;
  private writerActive = false;
  private writeQueue: Array<{ resolve: () => void }> = [];
  private readQueue: Array<{ resolve: () => void }> = [];

  async acquireRead(): Promise<void> {
    if (!this.writerActive && this.writeQueue.length === 0) {
      this.readers++;
      return;
    }
    return new Promise((resolve) => this.readQueue.push({ resolve }));
  }

  releaseRead(): void {
    this.readers--;
    if (this.readers === 0 && this.writeQueue.length > 0) {
      this.writerActive = true;
      this.writeQueue.shift()!.resolve();
    }
  }

  async acquireWrite(): Promise<void> {
    if (!this.writerActive && this.readers === 0) {
      this.writerActive = true;
      return;
    }
    return new Promise((resolve) => this.writeQueue.push({ resolve }));
  }

  releaseWrite(): void {
    this.writerActive = false;
    if (this.writeQueue.length > 0) {
      this.writerActive = true;
      this.writeQueue.shift()!.resolve();
    } else {
      while (this.readQueue.length > 0) {
        this.readers++;
        this.readQueue.shift()!.resolve();
      }
    }
  }

  async withRead<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireRead();
    try { return await fn(); } finally { this.releaseRead(); }
  }

  async withWrite<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquireWrite();
    try { return await fn(); } finally { this.releaseWrite(); }
  }

  get readerCount(): number { return this.readers; }
  get isWriting(): boolean { return this.writerActive; }
}
