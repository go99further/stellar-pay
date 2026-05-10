/**
 * Time Series Store
 *
 * Inspired by InfluxDB/Prometheus patterns:
 * - Append-only time series data
 * - Range queries (from/to)
 * - Downsampling (avg/min/max/sum per bucket)
 * - Retention policy (auto-evict old data)
 * - Multiple series with tags
 *
 * Pattern: Write → Store → Query → Aggregate → Retain
 */

export interface DataPoint {
  timestamp: number; // epoch ms
  value: number;
  tags?: Record<string, string>;
}

export interface AggregatedPoint {
  timestamp: number; // bucket start
  avg: number;
  min: number;
  max: number;
  sum: number;
  count: number;
}

export interface QueryOptions {
  from?: number;
  to?: number;
  tags?: Record<string, string>;
  limit?: number;
}

export interface DownsampleOptions {
  from: number;
  to: number;
  bucketMs: number;
  tags?: Record<string, string>;
}

export class TimeSeries {
  private points: DataPoint[] = [];
  private retentionMs?: number;

  constructor(options: { retentionMs?: number } = {}) {
    this.retentionMs = options.retentionMs;
  }

  write(value: number, timestamp = Date.now(), tags?: Record<string, string>): void {
    this.points.push({ timestamp, value, tags });
    if (this.retentionMs) this.evictOld();
  }

  writeMany(points: DataPoint[]): void {
    this.points.push(...points);
    this.points.sort((a, b) => a.timestamp - b.timestamp);
    if (this.retentionMs) this.evictOld();
  }

  query(options: QueryOptions = {}): DataPoint[] {
    let result = this.points;

    if (options.from !== undefined) result = result.filter((p) => p.timestamp >= options.from!);
    if (options.to !== undefined) result = result.filter((p) => p.timestamp <= options.to!);
    if (options.tags) {
      const tags = options.tags;
      result = result.filter((p) =>
        Object.entries(tags).every(([k, v]) => p.tags?.[k] === v)
      );
    }
    if (options.limit !== undefined) result = result.slice(-options.limit);

    return result;
  }

  downsample(options: DownsampleOptions): AggregatedPoint[] {
    const points = this.query({ from: options.from, to: options.to, tags: options.tags });
    const buckets = new Map<number, number[]>();

    for (const p of points) {
      const bucket = Math.floor((p.timestamp - options.from) / options.bucketMs) * options.bucketMs + options.from;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket)!.push(p.value);
    }

    const result: AggregatedPoint[] = [];
    for (const [ts, values] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const sum = values.reduce((a, b) => a + b, 0);
      result.push({
        timestamp: ts,
        avg: sum / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        sum,
        count: values.length,
      });
    }
    return result;
  }

  latest(n = 1): DataPoint[] {
    return this.points.slice(-n);
  }

  count(options: QueryOptions = {}): number {
    return this.query(options).length;
  }

  stats(options: QueryOptions = {}): { avg: number; min: number; max: number; sum: number; count: number } | null {
    const points = this.query(options);
    if (points.length === 0) return null;
    const values = points.map((p) => p.value);
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      sum,
      count: values.length,
    };
  }

  clear(): void {
    this.points = [];
  }

  get size(): number { return this.points.length; }

  private evictOld(): void {
    const cutoff = Date.now() - this.retentionMs!;
    this.points = this.points.filter((p) => p.timestamp >= cutoff);
  }
}

/**
 * TimeSeriesRegistry — named series management
 */
export class TimeSeriesRegistry {
  private series: Map<string, TimeSeries> = new Map();

  getOrCreate(name: string, options?: { retentionMs?: number }): TimeSeries {
    if (!this.series.has(name)) {
      this.series.set(name, new TimeSeries(options));
    }
    return this.series.get(name)!;
  }

  get(name: string): TimeSeries | undefined {
    return this.series.get(name);
  }

  write(name: string, value: number, timestamp?: number, tags?: Record<string, string>): void {
    this.getOrCreate(name).write(value, timestamp, tags);
  }

  names(): string[] {
    return [...this.series.keys()];
  }

  delete(name: string): boolean {
    return this.series.delete(name);
  }

  getStats(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [name, ts] of this.series) result[name] = ts.size;
    return result;
  }
}
