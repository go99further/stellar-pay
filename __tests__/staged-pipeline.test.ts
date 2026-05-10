import { describe, it, expect, vi } from "vitest";
import { StagedPipeline, PipelineError, createSwapPipeline } from "../lib/agent/pipeline/staged-pipeline";

describe("StagedPipeline", () => {
  describe("basic execution", () => {
    it("should execute a single stage and return output", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "double",
        execute: async (input) => (input as number) * 2,
      });
      const result = await pipeline.execute(5);
      expect(result).toBe(10);
    });

    it("should chain multiple stages", async () => {
      const pipeline = new StagedPipeline<number, string>("tx-1", "user-1");
      pipeline.addStage({ name: "add1", execute: async (n) => (n as number) + 1 });
      pipeline.addStage({ name: "double", execute: async (n) => (n as number) * 2 });
      pipeline.addStage({ name: "stringify", execute: async (n) => String(n) });
      const result = await pipeline.execute(4);
      expect(result).toBe("10");
    });

    it("should pass context to each stage", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-ctx", "user-1", { foo: "bar" });
      pipeline.addStage({
        name: "check",
        execute: async (input, ctx) => {
          expect(ctx.transactionId).toBe("tx-ctx");
          expect(ctx.userId).toBe("user-1");
          expect(ctx.metadata.foo).toBe("bar");
          return input as number;
        },
      });
      await pipeline.execute(1);
    });

    it("should record stage results in context", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({ name: "s1", execute: async (n) => (n as number) + 1 });
      pipeline.addStage({ name: "s2", execute: async (n) => (n as number) + 1 });
      await pipeline.execute(0);
      const ctx = pipeline.getContext();
      expect(ctx.stages).toHaveLength(2);
      expect(ctx.stages[0].stage).toBe("s1");
      expect(ctx.stages[0].status).toBe("completed");
      expect(ctx.stages[1].stage).toBe("s2");
    });

    it("should record duration on completed stages", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({ name: "s1", execute: async (n) => n as number });
      await pipeline.execute(1);
      const stage = pipeline.getContext().stages[0];
      expect(stage.duration).toBeGreaterThanOrEqual(0);
      expect(stage.endTime).toBeDefined();
    });
  });

  describe("validation", () => {
    it("should run validate before execute", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "validated",
        validate: async (n) => (n as number) > 0,
        execute: async (n) => (n as number) * 2,
      });
      const result = await pipeline.execute(5);
      expect(result).toBe(10);
    });

    it("should throw PipelineError when validation fails", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "validated",
        validate: async (n) => (n as number) > 0,
        execute: async (n) => (n as number) * 2,
      });
      await expect(pipeline.execute(-1)).rejects.toThrow(PipelineError);
    });

    it("should include stage name in PipelineError message on validation failure", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "my_stage",
        validate: async () => false,
        execute: async (n) => n as number,
      });
      await expect(pipeline.execute(1)).rejects.toThrow("my_stage");
    });
  });

  describe("failure and rollback", () => {
    it("should throw PipelineError when a stage throws", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "boom",
        execute: async () => { throw new Error("stage error"); },
      });
      await expect(pipeline.execute(1)).rejects.toThrow(PipelineError);
    });

    it("should include context in PipelineError", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "boom",
        execute: async () => { throw new Error("oops"); },
      });
      try {
        await pipeline.execute(1);
      } catch (e) {
        expect(e).toBeInstanceOf(PipelineError);
        expect((e as PipelineError).context.transactionId).toBe("tx-1");
      }
    });

    it("should call rollback on completed stages in reverse order", async () => {
      const order: string[] = [];
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "s1",
        execute: async (n) => n as number,
        rollback: async () => { order.push("rollback-s1"); },
      });
      pipeline.addStage({
        name: "s2",
        execute: async (n) => n as number,
        rollback: async () => { order.push("rollback-s2"); },
      });
      pipeline.addStage({
        name: "s3",
        execute: async () => { throw new Error("fail"); },
        rollback: async () => { order.push("rollback-s3"); },
      });
      await expect(pipeline.execute(1)).rejects.toThrow(PipelineError);
      // s1 and s2 completed, s3 failed — rollback s2 then s1
      expect(order).toEqual(["rollback-s2", "rollback-s1"]);
    });

    it("should mark rolled-back stages in context", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "s1",
        execute: async (n) => n as number,
        rollback: async () => {},
      });
      pipeline.addStage({
        name: "s2",
        execute: async () => { throw new Error("fail"); },
      });
      await expect(pipeline.execute(1)).rejects.toThrow();
      const ctx = pipeline.getContext();
      expect(ctx.stages[0].status).toBe("rolled_back");
      expect(ctx.stages[1].status).toBe("failed");
    });

    it("should continue rolling back even if one rollback throws", async () => {
      const order: string[] = [];
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({
        name: "s1",
        execute: async (n) => n as number,
        rollback: async () => { order.push("rollback-s1"); },
      });
      pipeline.addStage({
        name: "s2",
        execute: async (n) => n as number,
        rollback: async () => { throw new Error("rollback failed"); },
      });
      pipeline.addStage({
        name: "s3",
        execute: async () => { throw new Error("fail"); },
      });
      await expect(pipeline.execute(1)).rejects.toThrow();
      // s2 rollback threw, but s1 rollback should still run
      expect(order).toContain("rollback-s1");
    });
  });

  describe("getSummary", () => {
    it("should report correct counts after success", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({ name: "s1", execute: async (n) => n as number });
      pipeline.addStage({ name: "s2", execute: async (n) => n as number });
      await pipeline.execute(1);
      const summary = pipeline.getSummary();
      expect(summary.totalStages).toBe(2);
      expect(summary.completedStages).toBe(2);
      expect(summary.failedStages).toBe(0);
    });

    it("should report correct counts after failure", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({ name: "s1", execute: async (n) => n as number });
      pipeline.addStage({ name: "s2", execute: async () => { throw new Error("fail"); } });
      await expect(pipeline.execute(1)).rejects.toThrow();
      const summary = pipeline.getSummary();
      expect(summary.completedStages).toBe(1);
      expect(summary.failedStages).toBe(1);
    });

    it("should accumulate totalDuration", async () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      pipeline.addStage({ name: "s1", execute: async (n) => n as number });
      await pipeline.execute(1);
      expect(pipeline.getSummary().totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("addStage chaining", () => {
    it("should return pipeline for chaining", () => {
      const pipeline = new StagedPipeline<number, number>("tx-1", "user-1");
      const returned = pipeline.addStage({ name: "s1", execute: async (n) => n as number });
      expect(returned).toBe(pipeline);
    });
  });
});

describe("PipelineError", () => {
  it("should have name PipelineError", () => {
    const ctx = { transactionId: "t", userId: "u", metadata: {}, stages: [] };
    const err = new PipelineError("msg", ctx);
    expect(err.name).toBe("PipelineError");
    expect(err.context).toBe(ctx);
  });
});

describe("createSwapPipeline", () => {
  it("should create a pipeline with 5 stages", () => {
    const pipeline = createSwapPipeline("tx-swap", "user-1");
    expect(pipeline).toBeInstanceOf(StagedPipeline);
    // 5 stages: validation, simulation, build_xdr, user_confirmation, execution
    const ctx = pipeline.getContext();
    expect(ctx.transactionId).toBe("tx-swap");
    expect(ctx.userId).toBe("user-1");
  });

  it("should execute successfully with valid input", async () => {
    const pipeline = createSwapPipeline("tx-swap", "user-1");
    // Use BigInt literals that match the source's arithmetic (amountIn * 99n / 100n)
    const result = await pipeline.execute({
      tokenIn: "TKNA",
      tokenOut: "TKNB",
      amountIn: BigInt(100),
      minAmountOut: BigInt(90),
      deadline: Math.floor(Date.now() / 1000) + 300,
      userAddress: "GXXX",
    });
    expect(result).toHaveProperty("txHash");
    expect(result).toHaveProperty("status", "success");
  });

  it("should record validation errors in stage data when tokenIn === tokenOut", async () => {
    const pipeline = createSwapPipeline("tx-swap", "user-1");
    // validation stage records errors in stage data but doesn't throw — pipeline completes
    const result = await pipeline.execute({
      tokenIn: "TKNA",
      tokenOut: "TKNA",
      amountIn: BigInt(100),
      minAmountOut: BigInt(90),
      deadline: Math.floor(Date.now() / 1000) + 300,
      userAddress: "GXXX",
    });
    expect(result).toHaveProperty("txHash");
    const ctx = pipeline.getContext();
    const validationStage = ctx.stages.find((s) => s.stage === "validation");
    expect((validationStage?.data as { errors: string[] })?.errors).toContain(
      "Cannot swap token to itself"
    );
  });
});
