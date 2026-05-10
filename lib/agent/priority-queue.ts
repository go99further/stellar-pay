/**
 * Priority Queue
 *
 * Inspired by production scheduling patterns:
 * - Min/max heap implementation
 * - Configurable comparator
 * - Peek without dequeue
 * - Bulk insert (heapify)
 * - Iterator support
 *
 * Pattern: Insert → Heapify → Peek → Dequeue → Iterate
 */

export class PriorityQueue<T> {
  private heap: T[] = [];

  constructor(
    private comparator: (a: T, b: T) => number,
    items?: T[]
  ) {
    if (items && items.length > 0) {
      this.heap = [...items];
      this.heapify();
    }
  }

  get size(): number { return this.heap.length; }
  get isEmpty(): boolean { return this.heap.length === 0; }

  enqueue(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  dequeue(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  toArray(): T[] {
    return [...this.heap].sort(this.comparator);
  }

  clear(): void {
    this.heap = [];
  }

  has(predicate: (item: T) => boolean): boolean {
    return this.heap.some(predicate);
  }

  remove(predicate: (item: T) => boolean): boolean {
    const idx = this.heap.findIndex(predicate);
    if (idx === -1) return false;
    const last = this.heap.pop()!;
    if (idx < this.heap.length) {
      this.heap[idx] = last;
      this.bubbleUp(idx);
      this.sinkDown(idx);
    }
    return true;
  }

  [Symbol.iterator](): Iterator<T> {
    const copy = new PriorityQueue<T>(this.comparator, [...this.heap]);
    return {
      next(): IteratorResult<T> {
        if (copy.isEmpty) return { value: undefined as unknown as T, done: true };
        return { value: copy.dequeue()!, done: false };
      },
    };
  }

  private heapify(): void {
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
      this.sinkDown(i);
    }
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.comparator(this.heap[i], this.heap[parent]) < 0) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.comparator(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < n && this.comparator(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

export function minQueue<T extends number | string>(): PriorityQueue<T> {
  return new PriorityQueue<T>((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function maxQueue<T extends number | string>(): PriorityQueue<T> {
  return new PriorityQueue<T>((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

export function priorityQueueBy<T>(key: (item: T) => number, order: "asc" | "desc" = "asc"): PriorityQueue<T> {
  return new PriorityQueue<T>((a, b) => {
    const diff = key(a) - key(b);
    return order === "asc" ? diff : -diff;
  });
}
