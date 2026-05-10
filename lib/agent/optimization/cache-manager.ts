/**
 * Cache Manager
 *
 * Inspired by production caching patterns (Redis/Memcached style):
 * - TTL-based expiration
 * - LRU eviction when capacity exceeded
 * - Cache-aside pattern helpers
 * - Hit/miss statistics
 * - Namespace isolation
 *
 * Pattern: Get → Miss → Load → Set → Serve
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number | null; // null = no expiry
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  size: number; // estimated bytes
}

export interface CacheConfig {
  maxSize: number;       // max number of entries
  defaultTtl: number;    // ms, 0 = no expiry
  evictionPolicy: "lru" | "lfu" | "fifo";
  namespace: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  hitRate: number;
}

export type LoaderFn<T> = (key: string) => Promise<T>;

/**
 * Generic Cache Manager with TTL and LRU eviction
 */
export class CacheManager<T = unknown> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private stats: Omit<CacheStats, "size" | "hitRate"> = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000,
      defaultTtl: 0,
      evictionPolicy: "lru",
      namespace: "default",
      ...config,
    };
  }

  /**
   * Get a value from cache
   */
  get(key: string): T | null {
    const entry = this.store.get(this.namespaced(key));
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.store.delete(this.namespaced(key));
      this.stats.expirations++;
      this.stats.misses++;
      return null;
    }

    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const effectiveTtl = ttl ?? this.config.defaultTtl;
    const nsKey = this.namespaced(key);

    if (this.store.size >= this.config.maxSize && !this.store.has(nsKey)) {
      this.evict();
    }

    this.store.set(nsKey, {
      key: nsKey,
      value,
      expiresAt: effectiveTtl > 0 ? Date.now() + effectiveTtl : null,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      size: this.estimateSize(value),
    });
  }

  /**
   * Delete a key
   */
  delete(key: string): boolean {
    return this.store.delete(this.namespaced(key));
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Cache-aside: get from cache or load and cache
   */
  async getOrLoad(key: string, loader: LoaderFn<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = await loader(key);
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate all keys matching a prefix
   */
  invalidatePrefix(prefix: string): number {
    const nsPrefix = this.namespaced(prefix);
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(nsPrefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.store.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Get all non-expired keys
   */
  keys(): string[] {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (!this.isExpired(entry)) {
        result.push(key.replace(`${this.config.namespace}:`, ""));
      }
    }
    return result;
  }

  /**
   * Purge all expired entries
   */
  purgeExpired(): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
        this.stats.expirations++;
        removed++;
      }
    }
    return removed;
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private namespaced(key: string): string {
    return `${this.config.namespace}:${key}`;
  }

  private estimateSize(value: T): number {
    try {
      return JSON.stringify(value).length * 2; // rough bytes estimate
    } catch {
      return 64;
    }
  }

  private evict(): void {
    if (this.store.size === 0) return;

    let targetKey: string | null = null;

    switch (this.config.evictionPolicy) {
      case "lru": {
        let oldest = Infinity;
        for (const [key, entry] of this.store.entries()) {
          if (entry.lastAccessedAt < oldest) {
            oldest = entry.lastAccessedAt;
            targetKey = key;
          }
        }
        break;
      }
      case "lfu": {
        let leastUsed = Infinity;
        for (const [key, entry] of this.store.entries()) {
          if (entry.accessCount < leastUsed) {
            leastUsed = entry.accessCount;
            targetKey = key;
          }
        }
        break;
      }
      case "fifo": {
        let earliest = Infinity;
        for (const [key, entry] of this.store.entries()) {
          if (entry.createdAt < earliest) {
            earliest = entry.createdAt;
            targetKey = key;
          }
        }
        break;
      }
    }

    if (targetKey) {
      this.store.delete(targetKey);
      this.stats.evictions++;
    }
  }
}

/**
 * Multi-namespace cache registry
 */
export class CacheRegistry {
  private caches: Map<string, CacheManager> = new Map();

  getOrCreate<T>(namespace: string, config: Partial<CacheConfig> = {}): CacheManager<T> {
    if (!this.caches.has(namespace)) {
      this.caches.set(namespace, new CacheManager<T>({ ...config, namespace }));
    }
    return this.caches.get(namespace) as CacheManager<T>;
  }

  clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  getAggregateStats(): Record<string, CacheStats> {
    const result: Record<string, CacheStats> = {};
    for (const [ns, cache] of this.caches.entries()) {
      result[ns] = cache.getStats();
    }
    return result;
  }
}

export const cacheRegistry = new CacheRegistry();
