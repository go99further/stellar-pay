/**
 * Connection Pool
 *
 * Inspired by production database/RPC patterns:
 * - Reuse connections to reduce overhead
 * - Limit max concurrent connections
 * - Health checking and eviction
 * - Automatic reconnection
 * - Pool statistics
 *
 * Pattern: Acquire → Use → Release → Recycle
 */

export interface PooledConnection<T> {
  id: string;
  resource: T;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  healthy: boolean;
}

export interface PoolConfig {
  minSize: number;
  maxSize: number;
  acquireTimeout: number; // ms to wait for available connection
  idleTimeout: number; // ms before idle connection is evicted
  maxUseCount: number; // max times a connection can be reused
  healthCheckInterval: number; // ms between health checks
}

export interface PoolStats {
  total: number;
  idle: number;
  active: number;
  waiting: number;
  totalAcquired: number;
  totalReleased: number;
  totalEvicted: number;
}

type ConnectionFactory<T> = () => Promise<T>;
type ConnectionDestroyer<T> = (resource: T) => Promise<void>;
type ConnectionHealthCheck<T> = (resource: T) => Promise<boolean>;

/**
 * Generic Connection Pool
 */
export class ConnectionPool<T> {
  private config: PoolConfig;
  private idle: PooledConnection<T>[] = [];
  private active: Map<string, PooledConnection<T>> = new Map();
  private waitQueue: Array<{
    resolve: (conn: PooledConnection<T>) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private factory: ConnectionFactory<T>;
  private destroyer: ConnectionDestroyer<T>;
  private healthCheck?: ConnectionHealthCheck<T>;
  private healthCheckTimer?: NodeJS.Timeout;
  private stats = {
    totalAcquired: 0,
    totalReleased: 0,
    totalEvicted: 0,
  };

  constructor(
    factory: ConnectionFactory<T>,
    destroyer: ConnectionDestroyer<T>,
    config: Partial<PoolConfig> = {},
    healthCheck?: ConnectionHealthCheck<T>
  ) {
    this.factory = factory;
    this.destroyer = destroyer;
    this.healthCheck = healthCheck;
    this.config = {
      minSize: 2,
      maxSize: 10,
      acquireTimeout: 5000,
      idleTimeout: 30000,
      maxUseCount: 100,
      healthCheckInterval: 60000,
      ...config,
    };

    this.initialize();
  }

  /**
   * Initialize pool with minimum connections
   */
  private async initialize(): Promise<void> {
    const promises = Array.from({ length: this.config.minSize }, () =>
      this.createConnection()
    );
    const connections = await Promise.allSettled(promises);
    for (const result of connections) {
      if (result.status === "fulfilled") {
        this.idle.push(result.value);
      }
    }

    if (this.healthCheck) {
      this.startHealthChecks();
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PooledConnection<T>> {
    // Try to get an idle connection
    const conn = this.getIdleConnection();
    if (conn) {
      this.active.set(conn.id, conn);
      conn.lastUsedAt = Date.now();
      this.stats.totalAcquired++;
      return conn;
    }

    // Create new connection if under max
    const totalSize = this.idle.length + this.active.size;
    if (totalSize < this.config.maxSize) {
      const newConn = await this.createConnection();
      this.active.set(newConn.id, newConn);
      newConn.lastUsedAt = Date.now();
      this.stats.totalAcquired++;
      return newConn;
    }

    // Wait for a connection to become available
    return this.waitForConnection();
  }

  /**
   * Release a connection back to the pool
   */
  async release(connId: string): Promise<void> {
    const conn = this.active.get(connId);
    if (!conn) return;

    this.active.delete(connId);
    this.stats.totalReleased++;

    // Check if connection should be evicted
    if (
      !conn.healthy ||
      conn.useCount >= this.config.maxUseCount ||
      Date.now() - conn.createdAt > this.config.idleTimeout * 10
    ) {
      await this.evict(conn);
      this.replenish();
      return;
    }

    // Return to idle pool
    this.idle.push(conn);

    // Fulfill waiting requests
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timeout);
      const idleConn = this.idle.pop()!;
      this.active.set(idleConn.id, idleConn);
      idleConn.lastUsedAt = Date.now();
      this.stats.totalAcquired++;
      waiter.resolve(idleConn);
    }
  }

  /**
   * Execute a function with a pooled connection
   */
  async withConnection<R>(fn: (resource: T) => Promise<R>): Promise<R> {
    const conn = await this.acquire();
    try {
      const result = await fn(conn.resource);
      conn.useCount++;
      return result;
    } finally {
      await this.release(conn.id);
    }
  }

  /**
   * Get an idle connection, evicting unhealthy ones
   */
  private getIdleConnection(): PooledConnection<T> | null {
    while (this.idle.length > 0) {
      const conn = this.idle.pop()!;

      // Evict if idle too long
      if (Date.now() - conn.lastUsedAt > this.config.idleTimeout) {
        void this.evict(conn);
        continue;
      }

      if (!conn.healthy) {
        void this.evict(conn);
        continue;
      }

      return conn;
    }
    return null;
  }

  /**
   * Wait for a connection to become available
   */
  private waitForConnection(): Promise<PooledConnection<T>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.timeout === timeout);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error(`Connection pool timeout after ${this.config.acquireTimeout}ms`));
      }, this.config.acquireTimeout);

      this.waitQueue.push({ resolve, reject, timeout });
    });
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<PooledConnection<T>> {
    const resource = await this.factory();
    return {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      resource,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
      healthy: true,
    };
  }

  /**
   * Evict a connection
   */
  private async evict(conn: PooledConnection<T>): Promise<void> {
    try {
      await this.destroyer(conn.resource);
    } catch {
      // Ignore destroy errors
    }
    this.stats.totalEvicted++;
  }

  /**
   * Replenish pool to minimum size
   */
  private async replenish(): Promise<void> {
    const totalSize = this.idle.length + this.active.size;
    if (totalSize < this.config.minSize) {
      try {
        const conn = await this.createConnection();
        this.idle.push(conn);
      } catch {
        // Ignore replenish errors
      }
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      const toCheck = [...this.idle];
      for (const conn of toCheck) {
        try {
          const healthy = await this.healthCheck!(conn.resource);
          conn.healthy = healthy;
          if (!healthy) {
            const idx = this.idle.indexOf(conn);
            if (idx !== -1) this.idle.splice(idx, 1);
            await this.evict(conn);
            await this.replenish();
          }
        } catch {
          conn.healthy = false;
        }
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      total: this.idle.length + this.active.size,
      idle: this.idle.length,
      active: this.active.size,
      waiting: this.waitQueue.length,
      ...this.stats,
    };
  }

  /**
   * Drain and close all connections
   */
  async drain(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Reject all waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("Pool is draining"));
    }
    this.waitQueue = [];

    // Destroy all idle connections
    await Promise.allSettled(this.idle.map((conn) => this.evict(conn)));
    this.idle = [];

    // Active connections will be destroyed when released
  }
}
