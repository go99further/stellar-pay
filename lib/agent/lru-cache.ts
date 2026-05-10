/**
 * LRU Cache (Doubly Linked List + HashMap)
 *
 * Inspired by production caching patterns:
 * - O(1) get and put
 * - Eviction on capacity
 * - TTL support per entry
 * - Access frequency tracking
 * - onEvict callback
 *
 * Pattern: Get → Move to Head → Put → Evict Tail
 */

interface LRUNode<K, V> {
  key: K;
  value: V;
  expiresAt?: number;
  hits: number;
  prev: LRUNode<K, V> | null;
  next: LRUNode<K, V> | null;
}

export interface LRUOptions<K, V> {
  capacity: number;
  defaultTtlMs?: number;
  onEvict?: (key: K, value: V) => void;
}

export interface LRUStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export class LRUCache<K, V> {
  private map: Map<K, LRUNode<K, V>> = new Map();
  private head: LRUNode<K, V>; // most recently used sentinel
  private tail: LRUNode<K, V>; // least recently used sentinel
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private opts: Required<Omit<LRUOptions<K, V>, "onEvict">> & { onEvict?: (k: K, v: V) => void };

  constructor(options: LRUOptions<K, V>) {
    this.opts = { defaultTtlMs: 0, ...options };
    this.head = { key: null as unknown as K, value: null as unknown as V, hits: 0, prev: null, next: null };
    this.tail = { key: null as unknown as K, value: null as unknown as V, hits: 0, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) { this.stats.misses++; return undefined; }
    if (this.isExpired(node)) {
      this.evict(node);
      this.stats.misses++;
      return undefined;
    }
    this.moveToHead(node);
    node.hits++;
    this.stats.hits++;
    return node.value;
  }

  put(key: K, value: V, ttlMs?: number): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = this.computeExpiry(ttlMs);
      this.moveToHead(existing);
      return;
    }

    const node: LRUNode<K, V> = {
      key, value, hits: 0,
      expiresAt: this.computeExpiry(ttlMs),
      prev: null, next: null,
    };
    this.map.set(key, node);
    this.addToHead(node);

    if (this.map.size > this.opts.capacity) {
      const lru = this.removeTail();
      if (lru) {
        this.map.delete(lru.key);
        this.opts.onEvict?.(lru.key, lru.value);
        this.stats.evictions++;
      }
    }
  }

  has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    if (this.isExpired(node)) { this.evict(node); return false; }
    return true;
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.evict(node);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size(): number { return this.map.size; }

  keys(): K[] {
    const result: K[] = [];
    let node = this.head.next;
    while (node && node !== this.tail) {
      if (!this.isExpired(node)) result.push(node.key);
      node = node.next;
    }
    return result;
  }

  getStats(): LRUStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.map.size,
      capacity: this.opts.capacity,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: total === 0 ? 0 : this.stats.hits / total,
    };
  }

  evictExpired(): number {
    let count = 0;
    for (const node of this.map.values()) {
      if (this.isExpired(node)) { this.evict(node); count++; }
    }
    return count;
  }

  private isExpired(node: LRUNode<K, V>): boolean {
    return node.expiresAt !== undefined && node.expiresAt > 0 && Date.now() > node.expiresAt;
  }

  private computeExpiry(ttlMs?: number): number | undefined {
    const ttl = ttlMs ?? this.opts.defaultTtlMs;
    return ttl && ttl > 0 ? Date.now() + ttl : undefined;
  }

  private evict(node: LRUNode<K, V>): void {
    this.removeNode(node);
    this.map.delete(node.key);
  }

  private addToHead(node: LRUNode<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private removeNode(node: LRUNode<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: LRUNode<K, V>): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): LRUNode<K, V> | null {
    const lru = this.tail.prev;
    if (!lru || lru === this.head) return null;
    this.removeNode(lru);
    return lru;
  }
}
