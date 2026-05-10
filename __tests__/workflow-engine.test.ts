import { describe, it, expect } from "vitest";
import { WorkflowEngine, createWorkflow } from "../lib/agent/pipeline/workflow-engine";

describe("WorkflowEngine", () => {
  describe("basic execution", () => {
    it("should execute steps in order and return final context", async () => {
      const wf = createWorkflow<{ value: number }>("test-wf")
        .addStep({ id: "s1", name: "add1", execute: async (ctx) => ({ value: ctx.value + 1 }) })
        .addStep({ id: "s2", name: "double", execute: async (ctx) => ({ value: ctx.value * 2 }) });

      const result = await wf.execute({ value: 5 });
      expect(result.success).toBe(true);
      expect(result.context.value).toBe(12); // (5+1)*2
      expect(result.completedSteps).toBe(2);
    });

    it("should mark workflow as completed on success", async () => {
      const wf = createWorkflow<object>("simple")
        .addStep({ id: "s1", name: "noop", execute: async (ctx) => ctx });

      const result = await wf.execute({});
      expect(result.record.status).toBe("completed");
    });

    it("should mark workflow as failed on step error", async () => {
      const wf = createWorkflow<object>("failing")
        .addStep({ id: "s1", name: "ok", execute: async (ctx) => ctx })
        .addStep({ id: "s2", name: "bad", execute: async () => { throw new Error("step error"); } });

      const result = await wf.execute({});
      expect(result.success).toBe(false);
      expect(result.record.status).toBe("failed");
      expect(result.record.error).toMatch(/step error/);
    });
  });

  describe("conditional steps", () => {
    it("should skip step when condition returns false", async () => {
      const executed: string[] = [];
      const wf = createWorkflow<{ skip: boolean }>("conditional")
        .addStep({
          id: "s1",
          name: "always",
          execute: async (ctx) => { executed.push("s1"); return ctx; },
        })
        .addStep({
          id: "s2",
          name: "conditional",
          condition: (ctx) => !ctx.skip,
          execute: async (ctx) => { executed.push("s2"); return ctx; },
        });

      const result = await wf.execute({ skip: true });
      expect(executed).toContain("s1");
      expect(executed).not.toContain("s2");
      expect(result.skippedSteps).toBe(1);
      expect(result.completedSteps).toBe(1);
    });

    it("should run step when condition returns true", async () => {
      const executed: string[] = [];
      const wf = createWorkflow<{ run: boolean }>("cond-true")
        .addStep({
          id: "s1",
          name: "conditional",
          condition: (ctx) => ctx.run,
          execute: async (ctx) => { executed.push("s1"); return ctx; },
        });

      await wf.execute({ run: true });
      expect(executed).toContain("s1");
    });
  });

  describe("dependencies", () => {
    it("should run dependent step only after dependency completes", async () => {
      const order: string[] = [];
      const wf = createWorkflow<object>("deps")
        .addStep({ id: "a", name: "a", execute: async (ctx) => { order.push("a"); return ctx; } })
        .addStep({ id: "b", name: "b", dependsOn: ["a"], execute: async (ctx) => { order.push("b"); return ctx; } })
        .addStep({ id: "c", name: "c", dependsOn: ["b"], execute: async (ctx) => { order.push("c"); return ctx; } });

      await wf.execute({});
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    });

    it("should run independent steps (no deps) before dependent ones", async () => {
      const order: string[] = [];
      const wf = createWorkflow<object>("indep")
        .addStep({ id: "x", name: "x", execute: async (ctx) => { order.push("x"); return ctx; } })
        .addStep({ id: "y", name: "y", execute: async (ctx) => { order.push("y"); return ctx; } })
        .addStep({ id: "z", name: "z", dependsOn: ["x", "y"], execute: async (ctx) => { order.push("z"); return ctx; } });

      await wf.execute({});
      expect(order.indexOf("z")).toBeGreaterThan(order.indexOf("x"));
      expect(order.indexOf("z")).toBeGreaterThan(order.indexOf("y"));
    });
  });

  describe("parallel steps", () => {
    it("should run parallel steps concurrently", async () => {
      const starts: number[] = [];
      const wf = createWorkflow<object>("parallel")
        .addStep({
          id: "p1",
          name: "p1",
          parallel: true,
          execute: async (ctx) => {
            starts.push(Date.now());
            await new Promise((r) => setTimeout(r, 50));
            return ctx;
          },
        })
        .addStep({
          id: "p2",
          name: "p2",
          parallel: true,
          execute: async (ctx) => {
            starts.push(Date.now());
            await new Promise((r) => setTimeout(r, 50));
            return ctx;
          },
        });

      const t0 = Date.now();
      await wf.execute({});
      const elapsed = Date.now() - t0;

      // If truly parallel, total time should be ~50ms not ~100ms
      expect(elapsed).toBeLessThan(90);
    });
  });

  describe("retry on failure", () => {
    it("should retry a step and succeed", async () => {
      let attempts = 0;
      const wf = createWorkflow<object>("retry-wf")
        .addStep({
          id: "flaky",
          name: "flaky",
          retries: 2,
          execute: async (ctx) => {
            attempts++;
            if (attempts < 3) throw new Error("not yet");
            return ctx;
          },
        });

      const result = await wf.execute({});
      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      const wf = createWorkflow<object>("exhaust-wf")
        .addStep({
          id: "bad",
          name: "bad",
          retries: 1,
          execute: async () => { throw new Error("always fails"); },
        });

      const result = await wf.execute({});
      expect(result.success).toBe(false);
      const stepRecord = result.record.steps.find((s) => s.id === "bad")!;
      expect(stepRecord.attempts).toBe(2); // 1 initial + 1 retry
    });
  });

  describe("timeout", () => {
    it("should fail step that exceeds timeout", async () => {
      const wf = createWorkflow<object>("timeout-wf")
        .addStep({
          id: "slow",
          name: "slow",
          timeout: 50,
          execute: async (ctx) => {
            await new Promise((r) => setTimeout(r, 500));
            return ctx;
          },
        });

      const result = await wf.execute({});
      expect(result.success).toBe(false);
      expect(result.record.steps[0].error).toMatch(/timed out/i);
    });
  });

  describe("step records", () => {
    it("should record timing for each step", async () => {
      const wf = createWorkflow<object>("timing")
        .addStep({ id: "s1", name: "s1", execute: async (ctx) => ctx });

      const result = await wf.execute({});
      const step = result.record.steps[0];
      expect(step.startedAt).toBeDefined();
      expect(step.completedAt).toBeDefined();
      expect(step.status).toBe("completed");
    });

    it("should have unique workflow id per execution", async () => {
      const wf = createWorkflow<object>("id-test")
        .addStep({ id: "s", name: "s", execute: async (ctx) => ctx });

      const r1 = await wf.execute({});
      const r2 = await wf.execute({});
      expect(r1.record.id).not.toBe(r2.record.id);
    });
  });
});
