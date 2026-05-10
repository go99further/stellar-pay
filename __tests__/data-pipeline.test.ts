import { describe, it, expect, beforeEach } from "vitest";
import { DataPipeline, WindowAggregator } from "../lib/agent/pipeline/data-pipeline";

describe("DataPipeline", () => {
  describe("basic processing", () => {
    it("should process records through transforms", async () => {
      const pipeline = new DataPipeline<number, number>()
        .transform(async (r) => ({ ...r, data: r.data * 2 }))
        .transform(async (r) => ({ ...r, data: r.data + 1 }));

      const output: number[] = [];
      pipeline.sink(async (records) => { output.push(...records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3]);
      expect(output).toEqual([3, 5, 7]); // (1*2+1), (2*2+1), (3*2+1)
    });

    it("should track processed count", async () => {
      const pipeline = new DataPipeline<number, number>();
      pipeline.sink(async () => {});

      await pipeline.process([1, 2, 3, 4, 5]);
      expect(pipeline.getStats().processed).toBe(5);
    });

    it("should deliver records to multiple sinks", async () => {
      const sink1: number[] = [];
      const sink2: number[] = [];

      const pipeline = new DataPipeline<number, number>()
        .sink(async (records) => { sink1.push(...records.map((r) => r.data)); })
        .sink(async (records) => { sink2.push(...records.map((r) => r.data)); });

      await pipeline.process([10, 20]);
      expect(sink1).toEqual([10, 20]);
      expect(sink2).toEqual([10, 20]);
    });
  });

  describe("filter", () => {
    it("should exclude records that fail filter", async () => {
      const output: number[] = [];
      const pipeline = new DataPipeline<number, number>()
        .filter((r) => r.data > 3)
        .sink(async (records) => { output.push(...records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3, 4, 5]);
      expect(output).toEqual([4, 5]);
      expect(pipeline.getStats().filtered).toBe(3);
    });

    it("should chain multiple filters", async () => {
      const output: number[] = [];
      const pipeline = new DataPipeline<number, number>()
        .filter((r) => r.data > 2)
        .filter((r) => r.data < 5)
        .sink(async (records) => { output.push(...records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3, 4, 5]);
      expect(output).toEqual([3, 4]);
    });
  });

  describe("batching", () => {
    it("should batch records according to batchSize", async () => {
      const batches: number[][] = [];
      const pipeline = new DataPipeline<number, number>({ batchSize: 3 })
        .sink(async (records) => { batches.push(records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3, 4, 5, 6, 7]);
      expect(batches.length).toBe(3); // [1,2,3], [4,5,6], [7]
      expect(batches[0].length).toBe(3);
      expect(batches[1].length).toBe(3);
      expect(batches[2].length).toBe(1);
    });
  });

  describe("error handling and dead letter", () => {
    it("should send failed records to dead letter sink", async () => {
      const deadLetters: number[] = [];
      const pipeline = new DataPipeline<number, number>({ maxRetries: 0 })
        .transform(async (r) => {
          if (r.data === 2) throw new Error("bad record");
          return r;
        })
        .sink(async () => {})
        .deadLetter(async (records) => { deadLetters.push(...records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3]);
      expect(deadLetters).toContain(2);
      expect(pipeline.getStats().deadLettered).toBe(1);
      expect(pipeline.getStats().failed).toBe(1);
    });

    it("should continue processing after a failed record", async () => {
      const output: number[] = [];
      const pipeline = new DataPipeline<number, number>({ maxRetries: 0 })
        .transform(async (r) => {
          if (r.data === 2) throw new Error("skip");
          return r;
        })
        .sink(async (records) => { output.push(...records.map((r) => r.data)); });

      await pipeline.process([1, 2, 3]);
      expect(output).toContain(1);
      expect(output).toContain(3);
      expect(output).not.toContain(2);
    });
  });

  describe("resetStats", () => {
    it("should reset all counters", async () => {
      const pipeline = new DataPipeline<number, number>()
        .sink(async () => {});

      await pipeline.process([1, 2, 3]);
      pipeline.resetStats();

      const stats = pipeline.getStats();
      expect(stats.processed).toBe(0);
      expect(stats.batches).toBe(0);
    });
  });
});

describe("WindowAggregator", () => {
  it("should group items into time windows", () => {
    const agg = new WindowAggregator<number, number>(
      1000,
      (items) => items.reduce((a, b) => a + b, 0)
    );

    const t0 = 1000000;
    agg.add(10, t0 + 100);
    agg.add(20, t0 + 200);
    agg.add(30, t0 + 1100); // different window

    const windows = agg.getWindows();
    expect(windows.length).toBe(2);
    expect(windows[0].result).toBe(30); // 10+20
    expect(windows[1].result).toBe(30); // just 30
  });

  it("should return windows sorted by start time", () => {
    const agg = new WindowAggregator<number, number>(500, (items) => items.length);
    const t0 = 2000000;
    agg.add(1, t0 + 600);
    agg.add(2, t0 + 100);
    agg.add(3, t0 + 1200);

    const windows = agg.getWindows();
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].windowStart).toBeGreaterThan(windows[i - 1].windowStart);
    }
  });

  it("should flush all windows", () => {
    const agg = new WindowAggregator<number, number>(1000, (items) => items.length);
    agg.add(1, 1000);
    agg.add(2, 2000);
    agg.flush();
    expect(agg.getWindows().length).toBe(0);
  });

  it("should count items per window", () => {
    const agg = new WindowAggregator<string, number>(1000, (items) => items.length);
    const t0 = 5000000;
    agg.add("a", t0 + 100);
    agg.add("b", t0 + 200);
    agg.add("c", t0 + 300);

    const windows = agg.getWindows();
    expect(windows[0].count).toBe(3);
  });
});

describe("DataPipeline — additional coverage", () => {
  it("should return stats with correct processed count", async () => {
    const pipeline = new DataPipeline<{ data: number }, { data: number }>()
      .transform(async (r) => r);
    const stats = await pipeline.process([{ data: 1 }, { data: 2 }, { data: 3 }]);
    expect(stats.processed).toBe(3);
  });

  it("should chain transform and filter together", async () => {
    const results: number[] = [];
    const pipeline = new DataPipeline<{ v: number }, { v: number }>()
      .transform(async (r) => ({ ...r, data: { v: r.data.v * 2 } }))
      .filter((r) => r.data.v > 4)
      .sink(async (batch) => { results.push(...batch.map((r) => r.data.v)); });
    await pipeline.process([{ v: 1 }, { v: 2 }, { v: 3 }]);
    expect(results).toEqual([6]);
  });

  it("getStats should reflect cumulative stats across multiple process calls", async () => {
    const pipeline = new DataPipeline<{ n: number }, { n: number }>()
      .transform(async (r) => r);
    await pipeline.process([{ n: 1 }]);
    await pipeline.process([{ n: 2 }, { n: 3 }]);
    expect(pipeline.getStats().processed).toBe(3);
  });
});
