import { describe, it, expect, beforeEach } from "vitest";
import { Tracer } from "../lib/agent/monitoring/tracer";

describe("Tracer", () => {
  let tracer: Tracer;

  beforeEach(() => {
    tracer = new Tracer({ serviceName: "test-service", sampleRate: 1.0, maxSpans: 100 });
  });

  describe("startSpan / endSpan", () => {
    it("should create a span with correct fields", () => {
      const span = tracer.startSpan("test-op");
      expect(span.name).toBe("test-op");
      expect(span.traceId).toBeTruthy();
      expect(span.spanId).toBeTruthy();
      expect(span.startTime).toBeGreaterThan(0);
      expect(span.status).toBe("unset");
      expect(span.attributes["service.name"]).toBe("test-service");
    });

    it("should end a span with ok status", () => {
      const span = tracer.startSpan("op");
      tracer.endSpan(span, "ok");
      expect(span.status).toBe("ok");
      expect(span.endTime).toBeDefined();
      expect(span.duration).toBeGreaterThanOrEqual(0);
    });

    it("should end a span with error status", () => {
      const span = tracer.startSpan("failing-op");
      tracer.endSpan(span, "error", "something broke");
      expect(span.status).toBe("error");
      expect(span.statusMessage).toBe("something broke");
      expect(tracer.getStats().errors).toBe(1);
    });

    it("should track active spans", () => {
      const s1 = tracer.startSpan("s1");
      const s2 = tracer.startSpan("s2");
      expect(tracer.getActiveSpans().length).toBe(2);

      tracer.endSpan(s1);
      expect(tracer.getActiveSpans().length).toBe(1);
      tracer.endSpan(s2);
    });
  });

  describe("parent-child relationships", () => {
    it("should link child span to parent via traceId", () => {
      const parent = tracer.startSpan("parent");
      const ctx = tracer.getContext(parent);

      const child = tracer.startSpan("child", { parentContext: ctx });
      expect(child.traceId).toBe(parent.traceId);
      expect(child.parentSpanId).toBe(parent.spanId);

      tracer.endSpan(parent);
      tracer.endSpan(child);
    });

    it("should propagate baggage to child spans", () => {
      const parent = tracer.startSpan("parent", { baggage: { userId: "u123" } });
      const ctx = tracer.getContext(parent);

      const child = tracer.startSpan("child", { parentContext: ctx });
      expect(child.baggage.userId).toBe("u123");

      tracer.endSpan(parent);
      tracer.endSpan(child);
    });
  });

  describe("setAttribute / addEvent", () => {
    it("should add attributes to a span", () => {
      const span = tracer.startSpan("op");
      tracer.setAttribute(span, "http.method", "GET");
      tracer.setAttribute(span, "http.status_code", 200);

      expect(span.attributes["http.method"]).toBe("GET");
      expect(span.attributes["http.status_code"]).toBe(200);
      tracer.endSpan(span);
    });

    it("should record events on a span", () => {
      const span = tracer.startSpan("op");
      tracer.addEvent(span, "cache.hit", { key: "user:123" });
      tracer.addEvent(span, "db.query", { table: "swaps" });

      expect(span.events.length).toBe(2);
      expect(span.events[0].name).toBe("cache.hit");
      expect(span.events[1].name).toBe("db.query");
      tracer.endSpan(span);
    });
  });

  describe("trace helper", () => {
    it("should auto-end span on success", async () => {
      const result = await tracer.trace("auto-op", async (span) => {
        tracer.setAttribute(span, "result", "ok");
        return 42;
      });

      expect(result).toBe(42);
      const recent = tracer.getRecentSpans(1);
      expect(recent[0].status).toBe("ok");
      expect(recent[0].name).toBe("auto-op");
    });

    it("should auto-end span with error on exception", async () => {
      await expect(
        tracer.trace("failing-op", async () => {
          throw new Error("trace error");
        })
      ).rejects.toThrow("trace error");

      const recent = tracer.getRecentSpans(1);
      expect(recent[0].status).toBe("error");
      expect(recent[0].attributes["error.message"]).toBe("trace error");
    });
  });

  describe("getTrace", () => {
    it("should return all spans for a trace", async () => {
      const parent = tracer.startSpan("root");
      const ctx = tracer.getContext(parent);
      const child1 = tracer.startSpan("child1", { parentContext: ctx });
      const child2 = tracer.startSpan("child2", { parentContext: ctx });

      tracer.endSpan(child1);
      tracer.endSpan(child2);
      tracer.endSpan(parent);

      const trace = tracer.getTrace(parent.traceId);
      expect(trace.length).toBe(3);
      expect(trace.map((s) => s.name)).toContain("root");
      expect(trace.map((s) => s.name)).toContain("child1");
      expect(trace.map((s) => s.name)).toContain("child2");
    });
  });

  describe("sampling", () => {
    it("should drop spans when sampleRate=0", () => {
      const sampledTracer = new Tracer({ sampleRate: 0.0 });
      const span = sampledTracer.startSpan("dropped");
      expect(span.spanId).toBe("noop");
      expect(sampledTracer.getStats().dropped).toBe(1);
    });

    it("should keep all spans when sampleRate=1", () => {
      const fullTracer = new Tracer({ sampleRate: 1.0 });
      fullTracer.startSpan("kept");
      expect(fullTracer.getStats().sampled).toBe(1);
      expect(fullTracer.getStats().dropped).toBe(0);
    });
  });

  describe("exporters", () => {
    it("should call exporter when span ends", async () => {
      const exported: string[] = [];
      tracer.addExporter({
        name: "test-exporter",
        export: async (spans) => { exported.push(...spans.map((s) => s.name)); },
      });

      const span = tracer.startSpan("exported-op");
      tracer.endSpan(span);

      // Give async export a tick to run
      await new Promise((r) => setTimeout(r, 10));
      expect(exported).toContain("exported-op");
    });
  });

  describe("getStats", () => {
    it("should track started, completed, errors", () => {
      const s1 = tracer.startSpan("s1");
      const s2 = tracer.startSpan("s2");
      tracer.endSpan(s1, "ok");
      tracer.endSpan(s2, "error");

      const stats = tracer.getStats();
      expect(stats.started).toBe(2);
      expect(stats.completed).toBe(2);
      expect(stats.errors).toBe(1);
    });
  });
});
