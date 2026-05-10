/**
 * Cache-Aside Pattern — read-through / write-through / write-behind
 *
 * Inspired by production caching patterns from Aider/SWE-agent:
 * - Read-through: load from source on miss, populate cache
 * - Write-through: write to cache and source simultaneously
 * - Write-behind: write to cache immediately, flush to source async
 * - TTL per entry
 * - Stampede protection (single-flight)
 * - Invalidation by key or tag
 */

export interface CacheEntry<V> {
  value: V;
  expiresAt?: number;
  tags?: string[];
}

export interface CacheAsideOptions<K, V> {
  loader: (key: K) => Promise<V>;
  writer?: (key: K, value: V) => Promise<void>;
  ttlMs?: number;
  maxSize?: number;
}

export class CacheAside<K, V> {
  private store = new Map<K, CacheEntry<V>>();
  private inflight = new Map<K, Promise<V>>();
  private tagIndex = new Map<string, Set<K>>();
  private loader: (key: K) => Promise<V>;
  private writer?: (key: K, value: V) => Promise<void>;
  private ttlMs?: number;
  private maxSize?: number;
  private _hits = 0;
  private _misses = 0;

  constructor(options: CacheAsideOptions<K, V>) {
    this.loader = options.loader;
    this.writer = options.writer;
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize;
  }

  async get(key: K): Promise<V> {
    const entry = this.store.get(key);
    if (entry && !this.isExpired(entry)) {
      this._hits++;
      return entry.value;
    }

    // Single-flight: deduplicate concurrent loads for same key
    if (this.inflight.has(key)) {
      this._hits++;
      return this.inflight.get(key)!;
    }

    this._misses++;
    const promise = this.loader(key).then((value) => {
      this.set(key, value);
      this.inflight.delete(key);
      return value;
    }).catch((err) => {
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  set(key: K, value: V, options: { ttlMs?: number; tags?: string[] } = {}): void {
    if (this.maxSize && this.store.size >= this.maxSize && !this.store.has(key)) {
      // Evict oldest entry
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.evict(firstKey);
    }

    const ttl = options.ttlMs ?? this.ttlMs;
    const entry: CacheEntry<V> = {
      value,
      expiresAt: ttl ? Date.now() + ttl : undefined,
      tags: options.tags,
    };
    this.store.set(key, entry);

    if (options.tags) {
      for (const tag of options.tags) {
        if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
        this.tagIndex.get(tag)!.add(key);
      }
    }
  }

  async write(key: K, value: V, options: { ttlMs?: number; tags?: string[] } = {}): Promise<void> {
    this.set(key, value, options);
    await this.writer?.(key, value);
  }

  invalidate(key: K): boolean {
    return this.evict(key);
  }

  invalidateByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;
    let count = 0;
    for (const key of [...keys]) {
      if (this.evict(key)) count++;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    return !!entry && !this.isExpired(entry);
  }

  get size(): number { return this.store.size; }

  get stats() {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  clear(): void {
    this.store.clear();
    this.tagIndex.clear();
    this.inflight.clear();
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private evict(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    this.store.delete(key);
    if (entry.tags) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
    }
    return true;
  }
}
