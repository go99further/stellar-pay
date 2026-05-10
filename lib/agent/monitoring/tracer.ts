/**
 * Observability Tracer
 *
 * Inspired by OpenTelemetry distributed tracing patterns:
 * - Span-based request tracing
 * - Parent-child span relationships
 * - Baggage propagation
 * - Sampling strategies
 * - Export to multiple backends
 *
 * Pattern: Start Span → Add Attributes → Record Events → End Span → Export
 */

export type SpanStatus = "unset" | "ok" | "error";
export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";

export interface SpanAttribute {
  key: string;
  value: string | number | boolean;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  baggage: Record<string, string>;
}

export interface TracerConfig {
  serviceName: string;
  sampleRate: number; // 0.0 - 1.0
  maxSpans: number;
  exporters: SpanExporter[];
}

export interface SpanExporter {
  name: string;
  export: (spans: Span[]) => Promise<void>;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  baggage: Record<string, string>;
}

/**
 * Observability Tracer
 * Distributed tracing with OpenTelemetry-compatible spans
 */
export class Tracer {
  private config: TracerConfig;
  private spans: Map<string, Span> = new Map();
  private activeSpans: Map<string, string> = new Map(); // context key → spanId
  private completedSpans: Span[] = [];
  private stats = { started: 0, completed: 0, errors: 0, sampled: 0, dropped: 0 };

  constructor(config: Partial<TracerConfig> = {}) {
    this.config = {
      serviceName: "stellar-pay",
      sampleRate: 1.0,
      maxSpans: 10000,
      exporters: [],
      ...config,
    };
  }

  /**
   * Start a new span
   */
  startSpan(
    name: string,
    options: {
      kind?: SpanKind;
      parentContext?: TraceContext;
      attributes?: Record<string, string | number | boolean>;
      baggage?: Record<string, string>;
    } = {}
  ): Span {
    // Sampling decision
    if (Math.random() > this.config.sampleRate) {
      this.stats.dropped++;
      // Return a no-op span
      return this.createNoopSpan(name);
    }

    const traceId = options.parentContext?.traceId ?? this.generateId(32);
    const spanId = this.generateId(16);

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: options.parentContext?.spanId,
      name,
      kind: options.kind ?? "internal",
      startTime: Date.now(),
      status: "unset",
      attributes: {
        "service.name": this.config.serviceName,
        ...options.attributes,
      },
      events: [],
      baggage: { ...options.parentContext?.baggage, ...options.baggage },
    };

    this.spans.set(spanId, span);
    this.stats.started++;
    this.stats.sampled++;

    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: SpanStatus = "ok", message?: string): void {
    if (span.spanId === "noop") return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (message) span.statusMessage = message;

    if (status === "error") this.stats.errors++;
    this.stats.completed++;

    this.spans.delete(span.spanId);
    this.completedSpans.push(span);

    // Trim if over limit
    if (this.completedSpans.length > this.config.maxSpans) {
      this.completedSpans.shift();
    }

    // Export
    void this.exportSpan(span);
  }

  /**
   * Add attribute to span
   */
  setAttribute(span: Span, key: string, value: string | number | boolean): void {
    if (span.spanId === "noop") return;
    span.attributes[key] = value;
  }

  /**
   * Record an event on a span
   */
  addEvent(
    span: Span,
    name: string,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    if (span.spanId === "noop") return;
    span.events.push({ name, timestamp: Date.now(), attributes });
  }

  /**
   * Execute a function within a span
   */
  async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options: Parameters<Tracer["startSpan"]>[1] = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      this.endSpan(span, "ok");
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setAttribute(span, "error.message", msg);
      this.endSpan(span, "error", msg);
      throw err;
    }
  }

  /**
   * Get trace context for propagation
   */
  getContext(span: Span): TraceContext {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      baggage: { ...span.baggage },
    };
  }

  /**
   * Get all spans for a trace
   */
  getTrace(traceId: string): Span[] {
    return this.completedSpans.filter((s) => s.traceId === traceId);
  }

  /**
   * Get recent completed spans
   */
  getRecentSpans(limit = 50): Span[] {
    return this.completedSpans.slice(-limit);
  }

  /**
   * Get active (in-flight) spans
   */
  getActiveSpans(): Span[] {
    return Array.from(this.spans.values());
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats, active: this.spans.size };
  }

  /**
   * Add an exporter
   */
  addExporter(exporter: SpanExporter): void {
    this.config.exporters.push(exporter);
  }

  private async exportSpan(span: Span): Promise<void> {
    for (const exporter of this.config.exporters) {
      try {
        await exporter.export([span]);
      } catch {
        // Ignore export errors
      }
    }
  }

  private createNoopSpan(name: string): Span {
    return {
      traceId: "noop",
      spanId: "noop",
      name,
      kind: "internal",
      startTime: Date.now(),
      status: "unset",
      attributes: {},
      events: [],
      baggage: {},
    };
  }

  private generateId(length: number): string {
    const chars = "0123456789abcdef";
    return Array.from({ length }, () => chars[Math.floor(Math.random() * 16)]).join("");
  }
}

export const tracer = new Tracer();
