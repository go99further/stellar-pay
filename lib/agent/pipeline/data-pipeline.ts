/**
 * Data Pipeline
 *
 * Inspired by production ETL/stream processing patterns (Kafka Streams/Flink):
 * - Source → Transform → Sink pipeline
 * - Backpressure handling
 * - Windowed aggregations
 * - Dead letter handling for bad records
 * - Pipeline metrics
 *
 * Pattern: Extract → Transform → Load → Monitor
 */

export interface PipelineRecord<T = unknown> {
  id: string;
  data: T;
  timestamp: number;
  metadata: Record<string, unknown>;
  error?: string;
}

export type SourceFn<T> = () => AsyncIterable<T> | Promise<T[]>;
export type TransformFn<TIn, TOut> = (record: PipelineRecord<TIn>) => Promise<PipelineRecord<TOut>> | PipelineRecord<TOut>;
export type FilterFn<T> = (record: PipelineRecord<T>) => boolean;
export type SinkFn<T> = (records: PipelineRecord<T>[]) => Promise<void>;

export interface DataPipelineConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  deadLetterEnabled: boolean;
}

export interface PipelineStats {
  processed: number;
  filtered: number;
  failed: number;
  deadLettered: number;
  batches: number;
}

/**
 * Data Pipeline
 * ETL pipeline with transforms, filters, batching, and dead-letter
 */
export class DataPipeline<TIn = unknown, TOut = unknown> {
  private transforms: TransformFn<unknown, unknown>[] = [];
  private filters: FilterFn<unknown>[] = [];
  private sinks: SinkFn<TOut>[] = [];
  private deadLetterSink?: SinkFn<TIn>;
  private config: DataPipelineConfig;
  private stats: PipelineStats = {
    processed: 0,
    filtered: 0,
    failed: 0,
    deadLettered: 0,
    batches: 0,
  };

  constructor(config: Partial<DataPipelineConfig> = {}) {
    this.config = {
      batchSize: 100,
      flushIntervalMs: 1000,
      maxRetries: 3,
      deadLetterEnabled: true,
      ...config,
    };
  }

  /**
   * Add a transform stage
   */
  transform<TNext>(fn: TransformFn<TOut, TNext>): DataPipeline<TIn, TNext> {
    this.transforms.push(fn as TransformFn<unknown, unknown>);
    return this as unknown as DataPipeline<TIn, TNext>;
  }

  /**
   * Add a filter stage
   */
  filter(fn: FilterFn<TOut>): this {
    this.filters.push(fn as FilterFn<unknown>);
    return this;
  }

  /**
   * Add a sink
   */
  sink(fn: SinkFn<TOut>): this {
    this.sinks.push(fn);
    return this;
  }

  /**
   * Set dead letter sink
   */
  deadLetter(fn: SinkFn<TIn>): this {
    this.deadLetterSink = fn;
    return this;
  }

  /**
   * Process an array of input records
   */
  async process(inputs: TIn[]): Promise<PipelineStats> {
    const batches: PipelineRecord<TOut>[][] = [];
    let currentBatch: PipelineRecord<TOut>[] = [];
    const deadLetters: PipelineRecord<TIn>[] = [];

    for (const input of inputs) {
      const inputRecord: PipelineRecord<TIn> = {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        data: input,
        timestamp: Date.now(),
        metadata: {},
      };

      let current: PipelineRecord<unknown> = inputRecord as PipelineRecord<unknown>;
      let failed = false;

      // Apply transforms
      for (const transform of this.transforms) {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
          try {
            current = await transform(current);
            lastError = null;
            break;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
          }
        }
        if (lastError) {
          this.stats.failed++;
          if (this.config.deadLetterEnabled) {
            deadLetters.push(inputRecord);
            this.stats.deadLettered++;
          }
          failed = true;
          break;
        }
      }

      if (failed) continue;

      // Apply filters
      let passes = true;
      for (const filter of this.filters) {
        if (!filter(current as PipelineRecord<TOut>)) {
          passes = false;
          this.stats.filtered++;
          break;
        }
      }

      if (!passes) continue;

      this.stats.processed++;
      currentBatch.push(current as PipelineRecord<TOut>);

      if (currentBatch.length >= this.config.batchSize) {
        batches.push(currentBatch);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    // Flush to sinks
    for (const batch of batches) {
      this.stats.batches++;
      for (const sink of this.sinks) {
        await sink(batch);
      }
    }

    // Send dead letters
    if (deadLetters.length > 0 && this.deadLetterSink) {
      await this.deadLetterSink(deadLetters);
    }

    return { ...this.stats };
  }

  /**
   * Get current stats
   */
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = { processed: 0, filtered: 0, failed: 0, deadLettered: 0, batches: 0 };
  }
}

/**
 * Window aggregator for time-based grouping
 */
export class WindowAggregator<T, TAgg> {
  private windows: Map<number, T[]> = new Map();
  private windowSizeMs: number;
  private aggregateFn: (items: T[]) => TAgg;

  constructor(windowSizeMs: number, aggregateFn: (items: T[]) => TAgg) {
    this.windowSizeMs = windowSizeMs;
    this.aggregateFn = aggregateFn;
  }

  add(item: T, timestamp = Date.now()): void {
    const windowKey = Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs;
    const window = this.windows.get(windowKey) ?? [];
    window.push(item);
    this.windows.set(windowKey, window);
  }

  getWindows(): Array<{ windowStart: number; windowEnd: number; result: TAgg; count: number }> {
    return Array.from(this.windows.entries())
      .sort(([a], [b]) => a - b)
      .map(([start, items]) => ({
        windowStart: start,
        windowEnd: start + this.windowSizeMs,
        result: this.aggregateFn(items),
        count: items.length,
      }));
  }

  flush(): void {
    this.windows.clear();
  }
}
