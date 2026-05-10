/**
 * Metrics Collector
 *
 * Inspired by production observability patterns:
 * - Collect performance metrics
 * - Track operation counts
 * - Calculate percentiles
 * - Time-series data
 * - Metric aggregation
 *
 * Pattern: Record → Aggregate → Analyze → Report
 */

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags: Record<string, string>;
  type: MetricType;
}

export type MetricType = "counter" | "gauge" | "histogram" | "timer";

export interface MetricSummary {
  name: string;
  type: MetricType;
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  lastValue: number;
  lastUpdated: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface MetricQuery {
  name?: string;
  type?: MetricType;
  tags?: Record<string, string>;
  startTime?: number;
  endTime?: number;
}

/**
 * Metrics Collector
 * Collects and analyzes performance metrics
 */
export class MetricsCollector {
  private metrics: Map<string, Metric[]> = new Map();
  private maxMetricsPerName = 1000;
  private retentionPeriod = 3600000; // 1 hour

  /**
   * Record a counter metric
   */
  counter(name: string, value: number = 1, tags: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      tags,
      type: "counter",
    });
  }

  /**
   * Record a gauge metric
   */
  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      tags,
      type: "gauge",
    });
  }

  /**
   * Record a histogram metric
   */
  histogram(name: string, value: number, tags: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      tags,
      type: "histogram",
    });
  }

  /**
   * Time an operation
   */
  timer<T>(name: string, fn: () => T, tags: Record<string, string> = {}): T {
    const start = Date.now();
    try {
      const result = fn();
      const duration = Date.now() - start;
      this.record({
        name,
        value: duration,
        timestamp: Date.now(),
        tags,
        type: "timer",
      });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.record({
        name,
        value: duration,
        timestamp: Date.now(),
        tags: { ...tags, error: "true" },
        type: "timer",
      });
      throw error;
    }
  }

  /**
   * Time an async operation
   */
  async timerAsync<T>(
    name: string,
    fn: () => Promise<T>,
    tags: Record<string, string> = {}
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.record({
        name,
        value: duration,
        timestamp: Date.now(),
        tags,
        type: "timer",
      });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.record({
        name,
        value: duration,
        timestamp: Date.now(),
        tags: { ...tags, error: "true" },
        type: "timer",
      });
      throw error;
    }
  }

  /**
   * Record a metric
   */
  private record(metric: Metric): void {
    const key = this.getMetricKey(metric.name, metric.tags);
    let metricList = this.metrics.get(key);

    if (!metricList) {
      metricList = [];
      this.metrics.set(key, metricList);
    }

    metricList.push(metric);

    // Trim old metrics
    if (metricList.length > this.maxMetricsPerName) {
      metricList.shift();
    }

    // Clean up old metrics
    this.cleanupOldMetrics();
  }

  /**
   * Get metric summary
   */
  getSummary(name: string, tags: Record<string, string> = {}): MetricSummary | null {
    const key = this.getMetricKey(name, tags);
    const metricList = this.metrics.get(key);

    if (!metricList || metricList.length === 0) return null;

    const values = metricList.map((m) => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;

    return {
      name,
      type: metricList[0].type,
      count,
      sum,
      min: values[0],
      max: values[values.length - 1],
      mean: sum / count,
      median: this.percentile(values, 50),
      p95: this.percentile(values, 95),
      p99: this.percentile(values, 99),
      lastValue: metricList[metricList.length - 1].value,
      lastUpdated: metricList[metricList.length - 1].timestamp,
    };
  }

  /**
   * Get time series data
   */
  getTimeSeries(
    name: string,
    tags: Record<string, string> = {},
    bucketSize: number = 60000 // 1 minute buckets
  ): TimeSeriesPoint[] {
    const key = this.getMetricKey(name, tags);
    const metricList = this.metrics.get(key);

    if (!metricList || metricList.length === 0) return [];

    // Group by time buckets
    const buckets = new Map<number, number[]>();

    for (const metric of metricList) {
      const bucket = Math.floor(metric.timestamp / bucketSize) * bucketSize;
      let values = buckets.get(bucket);
      if (!values) {
        values = [];
        buckets.set(bucket, values);
      }
      values.push(metric.value);
    }

    // Calculate average for each bucket
    return Array.from(buckets.entries())
      .map(([timestamp, values]) => ({
        timestamp,
        value: values.reduce((a, b) => a + b, 0) / values.length,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Query metrics
   */
  query(query: MetricQuery): Metric[] {
    let results: Metric[] = [];

    for (const metricList of this.metrics.values()) {
      for (const metric of metricList) {
        // Filter by name
        if (query.name && metric.name !== query.name) continue;

        // Filter by type
        if (query.type && metric.type !== query.type) continue;

        // Filter by tags
        if (query.tags) {
          let tagMatch = true;
          for (const [key, value] of Object.entries(query.tags)) {
            if (metric.tags[key] !== value) {
              tagMatch = false;
              break;
            }
          }
          if (!tagMatch) continue;
        }

        // Filter by time range
        if (query.startTime && metric.timestamp < query.startTime) continue;
        if (query.endTime && metric.timestamp > query.endTime) continue;

        results.push(metric);
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    const names = new Set<string>();
    for (const metricList of this.metrics.values()) {
      if (metricList.length > 0) {
        names.add(metricList[0].name);
      }
    }
    return Array.from(names).sort();
  }

  /**
   * Get all summaries
   */
  getAllSummaries(): MetricSummary[] {
    const summaries: MetricSummary[] = [];
    const processed = new Set<string>();

    for (const metricList of this.metrics.values()) {
      if (metricList.length === 0) continue;

      const metric = metricList[0];
      const key = metric.name;

      if (processed.has(key)) continue;
      processed.add(key);

      const summary = this.getSummary(metric.name, metric.tags);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const index = Math.ceil((p / 100) * values.length) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  /**
   * Get metric key
   */
  private getMetricKey(name: string, tags: Record<string, string>): string {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    return tagStr ? `${name}{${tagStr}}` : name;
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - this.retentionPeriod;

    for (const [key, metricList] of this.metrics.entries()) {
      const filtered = metricList.filter((m) => m.timestamp >= cutoff);
      if (filtered.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filtered);
      }
    }
  }

  /**
   * Export metrics as JSON
   */
  export(): string {
    const data = {
      metrics: Array.from(this.metrics.entries()).map(([key, metrics]) => ({
        key,
        metrics,
      })),
      summaries: this.getAllSummaries(),
      timestamp: Date.now(),
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalMetrics: number;
    uniqueMetricNames: number;
    oldestMetric: number;
    newestMetric: number;
  } {
    let totalMetrics = 0;
    let oldestMetric = Date.now();
    let newestMetric = 0;

    for (const metricList of this.metrics.values()) {
      totalMetrics += metricList.length;
      if (metricList.length > 0) {
        oldestMetric = Math.min(oldestMetric, metricList[0].timestamp);
        newestMetric = Math.max(newestMetric, metricList[metricList.length - 1].timestamp);
      }
    }

    return {
      totalMetrics,
      uniqueMetricNames: this.getMetricNames().length,
      oldestMetric,
      newestMetric,
    };
  }
}

/**
 * Global metrics collector
 */
export const metrics = new MetricsCollector();

/**
 * Decorator for timing methods
 */
export function timed(metricName?: string) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = metricName || `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      return metrics.timerAsync(name, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Usage example:
 *
 * // Counter
 * metrics.counter("api.requests", 1, { endpoint: "/swap" });
 *
 * // Gauge
 * metrics.gauge("queue.size", 42);
 *
 * // Histogram
 * metrics.histogram("response.size", 1024);
 *
 * // Timer
 * const result = await metrics.timerAsync("db.query", async () => {
 *   return await database.query("SELECT * FROM users");
 * });
 *
 * // Decorator
 * class ApiClient {
 *   @timed("api.fetchData")
 *   async fetchData() {
 *     return await fetch("/api/data");
 *   }
 * }
 *
 * // Get summary
 * const summary = metrics.getSummary("api.requests");
 * console.log("P95 latency:", summary?.p95);
 *
 * // Get time series
 * const series = metrics.getTimeSeries("api.requests", {}, 60000);
 * console.log("Requests per minute:", series);
 *
 * // Query metrics
 * const errorMetrics = metrics.query({
 *   name: "api.requests",
 *   tags: { error: "true" },
 *   startTime: Date.now() - 3600000,
 * });
 */
