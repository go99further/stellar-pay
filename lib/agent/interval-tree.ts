/**
 * Interval Tree
 *
 * Inspired by production scheduling/range-query patterns:
 * - Store intervals [start, end]
 * - Query all intervals overlapping a point or range
 * - Insert / delete intervals
 * - Find minimum/maximum coverage
 *
 * Pattern: Insert → Augment → Query → Overlap
 */

export interface Interval<T = unknown> {
  start: number;
  end: number;
  data?: T;
}

interface IntervalNode<T> {
  interval: Interval<T>;
  maxEnd: number;
  left: IntervalNode<T> | null;
  right: IntervalNode<T> | null;
}

export class IntervalTree<T = unknown> {
  private root: IntervalNode<T> | null = null;
  private _size = 0;

  get size(): number { return this._size; }

  insert(interval: Interval<T>): void {
    this.root = this.insertNode(this.root, interval);
    this._size++;
  }

  delete(interval: Interval<T>): boolean {
    const before = this._size;
    this.root = this.deleteNode(this.root, interval);
    return this._size < before;
  }

  queryPoint(point: number): Interval<T>[] {
    const result: Interval<T>[] = [];
    this.searchPoint(this.root, point, result);
    return result;
  }

  queryRange(start: number, end: number): Interval<T>[] {
    const result: Interval<T>[] = [];
    this.searchRange(this.root, start, end, result);
    return result;
  }

  overlaps(a: Interval<T>, b: Interval<T>): boolean {
    return a.start <= b.end && b.start <= a.end;
  }

  allIntervals(): Interval<T>[] {
    const result: Interval<T>[] = [];
    this.inorder(this.root, result);
    return result;
  }

  clear(): void {
    this.root = null;
    this._size = 0;
  }

  private insertNode(node: IntervalNode<T> | null, interval: Interval<T>): IntervalNode<T> {
    if (!node) {
      return { interval, maxEnd: interval.end, left: null, right: null };
    }
    if (interval.start < node.interval.start) {
      node.left = this.insertNode(node.left, interval);
    } else {
      node.right = this.insertNode(node.right, interval);
    }
    node.maxEnd = Math.max(node.interval.end, this.maxEnd(node.left), this.maxEnd(node.right));
    return node;
  }

  private deleteNode(node: IntervalNode<T> | null, interval: Interval<T>): IntervalNode<T> | null {
    if (!node) return null;
    if (interval.start === node.interval.start && interval.end === node.interval.end) {
      this._size--;
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      // Find in-order successor
      let successor = node.right;
      while (successor.left) successor = successor.left;
      node.interval = successor.interval;
      node.right = this.deleteNode(node.right, successor.interval);
    } else if (interval.start < node.interval.start) {
      node.left = this.deleteNode(node.left, interval);
    } else {
      node.right = this.deleteNode(node.right, interval);
    }
    node.maxEnd = Math.max(node.interval.end, this.maxEnd(node.left), this.maxEnd(node.right));
    return node;
  }

  private searchPoint(node: IntervalNode<T> | null, point: number, result: Interval<T>[]): void {
    if (!node || node.maxEnd < point) return;
    if (node.interval.start <= point && point <= node.interval.end) {
      result.push(node.interval);
    }
    this.searchPoint(node.left, point, result);
    this.searchPoint(node.right, point, result);
  }

  private searchRange(node: IntervalNode<T> | null, start: number, end: number, result: Interval<T>[]): void {
    if (!node || node.maxEnd < start) return;
    if (node.interval.start <= end && start <= node.interval.end) {
      result.push(node.interval);
    }
    this.searchRange(node.left, start, end, result);
    this.searchRange(node.right, start, end, result);
  }

  private inorder(node: IntervalNode<T> | null, result: Interval<T>[]): void {
    if (!node) return;
    this.inorder(node.left, result);
    result.push(node.interval);
    this.inorder(node.right, result);
  }

  private maxEnd(node: IntervalNode<T> | null): number {
    return node?.maxEnd ?? -Infinity;
  }
}
