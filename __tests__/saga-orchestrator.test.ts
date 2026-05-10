import { describe, it, expect } from "vitest";
import { SagaOrchestrator, createSaga } from "../lib/agent/recovery/saga-orchestrator";

describe("SagaOrchestrator", () => {
  describe("happy path", () => {
    it("should execute all steps and return completed status", async () => {
      const saga = createSaga<{ value: number }>("test-saga")
        .step({
          name: "step1",
          execute: async (ctx) => ({ value: ctx.value + 1 }),
          compensate: async (ctx) => ({ value: ctx.value - 1 }),
        })
        .step({
          name: "step2",
          execute: async (ctx) => ({ value: ctx.value * 2 }),
          compensate: async (ctx) => ({ value: ctx.value / 2 }),
        });

      const result = await saga.execute({ value: 5 });

      expect(result.success).toBe(true);
      expect(result.context.value).toBe(12); // (5+1)*2
      expect(result.record.status).toBe("completed");
      expect(result.record.steps.every((s) => s.status === "completed")).toBe(true);
    });

    it("should pass context between steps", async () => {
      const log: number[] = [];
      const saga = createSaga<{ n: number }>("ctx-pass")
        .step({
          name: "double",
          execute: async (ctx) => { log.push(ctx.n); return { n: ctx.n * 2 }; },
          compensate: async (ctx) => ctx,
        })
        .step({
          name: "add10",
          execute: async (ctx) => { log.push(ctx.n); return { n: ctx.n + 10 }; },
          compensate: async (ctx) => ctx,
        });

      const result = await saga.execute({ n: 3 });
      expect(log).toEqual([3, 6]);
      expect(result.context.n).toBe(16);
    });
  });

  describe("compensation on failure", () => {
    it("should compensate completed steps in reverse order when a step fails", async () => {
      const log: string[] = [];

      const saga = createSaga<{ steps: string[] }>("compensate-saga")
        .step({
          name: "step1",
          execute: async (ctx) => { log.push("exec1"); return { steps: [...ctx.steps, "1"] }; },
          compensate: async (ctx) => { log.push("undo1"); return { steps: ctx.steps.filter((s) => s !== "1") }; },
        })
        .step({
          name: "step2",
          execute: async (ctx) => { log.push("exec2"); return { steps: [...ctx.steps, "2"] }; },
          compensate: async (ctx) => { log.push("undo2"); return { steps: ctx.steps.filter((s) => s !== "2") }; },
        })
        .step({
          name: "step3-fails",
          execute: async () => { log.push("exec3"); throw new Error("step3 error"); },
          compensate: async (ctx) => ctx,
        });

      const result = await saga.execute({ steps: [] });

      expect(result.success).toBe(false);
      expect(result.record.status).toBe("compensated");
      expect(log).toContain("exec1");
      expect(log).toContain("exec2");
      expect(log).toContain("exec3");
      // Compensation should be in reverse: undo2 before undo1
      expect(log.indexOf("undo2")).toBeLessThan(log.indexOf("undo1"));
    });

    it("should set error message from failing step", async () => {
      const saga = createSaga<object>("error-saga")
        .step({
          name: "bad-step",
          execute: async () => { throw new Error("something went wrong"); },
          compensate: async (ctx) => ctx,
        });

      const result = await saga.execute({});
      expect(result.success).toBe(false);
      expect(result.record.error).toMatch(/something went wrong/);
      expect(result.record.steps[0].status).toBe("failed");
    });

    it("should not compensate steps that never ran", async () => {
      const compensated: string[] = [];

      const saga = createSaga<object>("partial-saga")
        .step({
          name: "step1",
          execute: async (ctx) => ctx,
          compensate: async (ctx) => { compensated.push("step1"); return ctx; },
        })
        .step({
          name: "step2-fails",
          execute: async () => { throw new Error("fail"); },
          compensate: async (ctx) => { compensated.push("step2"); return ctx; },
        })
        .step({
          name: "step3-never-runs",
          execute: async (ctx) => ctx,
          compensate: async (ctx) => { compensated.push("step3"); return ctx; },
        });

      await saga.execute({});
      expect(compensated).toContain("step1");
      expect(compensated).not.toContain("step3");
    });
  });

  describe("retry on failure", () => {
    it("should retry a step up to maxRetries times", async () => {
      let attempts = 0;

      const saga = createSaga<object>("retry-saga")
        .step({
          name: "flaky",
          execute: async (ctx) => {
            attempts++;
            if (attempts < 3) throw new Error("not yet");
            return ctx;
          },
          compensate: async (ctx) => ctx,
          maxRetries: 3,
          retryDelay: 10,
        });

      const result = await saga.execute({});
      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      const saga = createSaga<object>("exhaust-saga")
        .step({
          name: "always-fails",
          execute: async () => { throw new Error("permanent"); },
          compensate: async (ctx) => ctx,
          maxRetries: 2,
          retryDelay: 10,
        });

      const result = await saga.execute({});
      expect(result.success).toBe(false);
      expect(result.record.steps[0].attempts).toBe(3); // 1 initial + 2 retries
    });
  });

  describe("record tracking", () => {
    it("should record timing for each step", async () => {
      const saga = createSaga<object>("timing-saga")
        .step({
          name: "timed-step",
          execute: async (ctx) => { await new Promise((r) => setTimeout(r, 10)); return ctx; },
          compensate: async (ctx) => ctx,
        });

      const result = await saga.execute({});
      const step = result.record.steps[0];
      expect(step.startedAt).toBeDefined();
      expect(step.completedAt).toBeDefined();
      expect(step.completedAt!).toBeGreaterThanOrEqual(step.startedAt!);
    });

    it("should have unique saga id", async () => {
      const saga = createSaga<object>("id-saga")
        .step({ name: "s", execute: async (ctx) => ctx, compensate: async (ctx) => ctx });

      const r1 = await saga.execute({});
      const r2 = await saga.execute({});
      expect(r1.record.id).not.toBe(r2.record.id);
    });
  });
});
