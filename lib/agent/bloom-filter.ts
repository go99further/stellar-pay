/**
 * Bloom Filter
 *
 * Inspired by production probabilistic data structure patterns:
 * - Space-efficient membership testing
 * - Configurable false positive rate
 * - Multiple hash functions
 * - Merge two filters
 * - Serialization/deserialization
 *
 * Pattern: Hash → Set Bits → Test Bits → Probabilistic Answer
 */

export interface BloomFilterOptions {
  expectedItems: number;
  falsePositiveRate: number; // e.g. 0.01 = 1%
}

export interface BloomFilterStats {
  bitArraySize: number;
  hashFunctions: number;
  itemsAdded: number;
  estimatedFalsePositiveRate: number;
  fillRatio: number;
}

function optimalBitSize(n: number, p: number): number {
  return Math.ceil(-n * Math.log(p) / (Math.log(2) ** 2));
}

function optimalHashCount(m: number, n: number): number {
  return Math.max(1, Math.round((m / n) * Math.log(2)));
}

// FNV-1a inspired hash with seed
function hash(str: string, seed: number): number {
  let h = seed ^ 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

export class BloomFilter {
  private bits: Uint8Array;
  private m: number; // bit array size
  private k: number; // hash function count
  private count = 0;

  constructor(options: BloomFilterOptions) {
    this.m = optimalBitSize(options.expectedItems, options.falsePositiveRate);
    this.k = optimalHashCount(this.m, options.expectedItems);
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }

  static fromParams(m: number, k: number): BloomFilter {
    const bf = new BloomFilter({ expectedItems: 100, falsePositiveRate: 0.01 });
    bf.m = m;
    bf.k = k;
    bf.bits = new Uint8Array(Math.ceil(m / 8));
    return bf;
  }

  add(item: string): void {
    for (let i = 0; i < this.k; i++) {
      const pos = hash(item, i * 0xdeadbeef) % this.m;
      this.bits[Math.floor(pos / 8)] |= 1 << (pos % 8);
    }
    this.count++;
  }

  has(item: string): boolean {
    for (let i = 0; i < this.k; i++) {
      const pos = hash(item, i * 0xdeadbeef) % this.m;
      if (!(this.bits[Math.floor(pos / 8)] & (1 << (pos % 8)))) return false;
    }
    return true;
  }

  merge(other: BloomFilter): BloomFilter {
    if (other.m !== this.m || other.k !== this.k) {
      throw new Error("Cannot merge filters with different parameters");
    }
    const merged = BloomFilter.fromParams(this.m, this.k);
    for (let i = 0; i < this.bits.length; i++) {
      merged.bits[i] = this.bits[i] | other.bits[i];
    }
    merged.count = this.count + other.count;
    return merged;
  }

  serialize(): string {
    return JSON.stringify({
      m: this.m,
      k: this.k,
      count: this.count,
      bits: Array.from(this.bits),
    });
  }

  static deserialize(data: string): BloomFilter {
    const obj = JSON.parse(data);
    const bf = BloomFilter.fromParams(obj.m, obj.k);
    bf.bits = new Uint8Array(obj.bits);
    bf.count = obj.count;
    return bf;
  }

  getStats(): BloomFilterStats {
    const setBits = this.bits.reduce((acc, byte) => {
      let b = byte;
      while (b) { acc += b & 1; b >>= 1; }
      return acc;
    }, 0);
    const fillRatio = setBits / this.m;
    const estimatedFPR = Math.pow(fillRatio, this.k);

    return {
      bitArraySize: this.m,
      hashFunctions: this.k,
      itemsAdded: this.count,
      estimatedFalsePositiveRate: estimatedFPR,
      fillRatio,
    };
  }

  get size(): number { return this.count; }
}
