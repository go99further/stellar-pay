/**
 * Staged Transaction Pipeline
 *
 * Inspired by Aider's staged execution pattern:
 * - Each stage is independent and reversible
 * - Clear stage boundaries with validation
 * - Rollback on failure at any stage
 * - Immutable stage results
 *
 * Pattern: Stage 1 → Stage 2 → Stage 3 → Commit
 *          ↓ fail    ↓ fail    ↓ fail    ↓ fail
 *        Rollback  Rollback  Rollback  Rollback
 */

export type StageStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";

export interface StageResult<T = unknown> {
  stage: string;
  status: StageStatus;
  data?: T;
  error?: Error;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface PipelineContext {
  transactionId: string;
  userId: string;
  metadata: Record<string, unknown>;
  stages: StageResult[];
}

export interface Stage<TInput, TOutput> {
  name: string;
  execute: (input: TInput, context: PipelineContext) => Promise<TOutput>;
  rollback?: (context: PipelineContext) => Promise<void>;
  validate?: (input: TInput) => Promise<boolean>;
}

/**
 * Staged Pipeline Executor
 * Executes stages sequentially with automatic rollback on failure
 */
export class StagedPipeline<TInput, TOutput> {
  private stages: Stage<unknown, unknown>[] = [];
  private context: PipelineContext;

  constructor(transactionId: string, userId: string, metadata: Record<string, unknown> = {}) {
    this.context = {
      transactionId,
      userId,
      metadata,
      stages: [],
    };
  }

  /**
   * Add a stage to the pipeline
   */
  addStage<TStageInput, TStageOutput>(
    stage: Stage<TStageInput, TStageOutput>
  ): StagedPipeline<TInput, TOutput> {
    this.stages.push(stage as Stage<unknown, unknown>);
    return this;
  }

  /**
   * Execute all stages in sequence
   * Automatically rolls back on failure
   */
  async execute(input: TInput): Promise<TOutput> {
    let currentInput: unknown = input;
    const completedStages: number[] = [];

    try {
      for (let i = 0; i < this.stages.length; i++) {
        const stage = this.stages[i];
        const stageResult: StageResult = {
          stage: stage.name,
          status: "pending",
          startTime: Date.now(),
        };

        this.context.stages.push(stageResult);

        try {
          // Validate input if validator exists
          if (stage.validate) {
            const isValid = await stage.validate(currentInput);
            if (!isValid) {
              throw new Error(`Stage ${stage.name} validation failed`);
            }
          }

          // Execute stage
          stageResult.status = "running";
          const output = await stage.execute(currentInput, this.context);
          stageResult.status = "completed";
          stageResult.data = output;
          stageResult.endTime = Date.now();
          stageResult.duration = stageResult.endTime - stageResult.startTime;

          completedStages.push(i);
          currentInput = output;
        } catch (error) {
          stageResult.status = "failed";
          stageResult.error = error instanceof Error ? error : new Error(String(error));
          stageResult.endTime = Date.now();
          stageResult.duration = stageResult.endTime - stageResult.startTime;

          // Rollback all completed stages in reverse order
          await this.rollback(completedStages);

          throw new PipelineError(
            `Pipeline failed at stage ${stage.name}: ${stageResult.error.message}`,
            this.context
          );
        }
      }

      return currentInput as TOutput;
    } catch (error) {
      if (error instanceof PipelineError) {
        throw error;
      }
      throw new PipelineError(
        `Pipeline execution failed: ${error instanceof Error ? error.message : String(error)}`,
        this.context
      );
    }
  }

  /**
   * Rollback completed stages in reverse order
   */
  private async rollback(completedStages: number[]): Promise<void> {
    for (let i = completedStages.length - 1; i >= 0; i--) {
      const stageIndex = completedStages[i];
      const stage = this.stages[stageIndex];
      const stageResult = this.context.stages[stageIndex];

      if (stage.rollback) {
        try {
          await stage.rollback(this.context);
          stageResult.status = "rolled_back";
        } catch (rollbackError) {
          console.error(
            `Failed to rollback stage ${stage.name}:`,
            rollbackError
          );
          // Continue rolling back other stages even if one fails
        }
      }
    }
  }

  /**
   * Get pipeline execution context
   */
  getContext(): PipelineContext {
    return this.context;
  }

  /**
   * Get execution summary
   */
  getSummary(): {
    totalStages: number;
    completedStages: number;
    failedStages: number;
    totalDuration: number;
  } {
    const completed = this.context.stages.filter((s) => s.status === "completed").length;
    const failed = this.context.stages.filter((s) => s.status === "failed").length;
    const totalDuration = this.context.stages.reduce((sum, s) => sum + (s.duration || 0), 0);

    return {
      totalStages: this.stages.length,
      completedStages: completed,
      failedStages: failed,
      totalDuration,
    };
  }
}

/**
 * Custom error class for pipeline failures
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public context: PipelineContext
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * Example: Swap Transaction Pipeline
 */

interface SwapInput {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: number;
  userAddress: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface SimulationResult {
  expectedOutput: bigint;
  priceImpact: number;
  gasFee: string;
}

interface XDRResult {
  xdr: string;
  hash: string;
}

interface ExecutionResult {
  txHash: string;
  status: "success" | "failed";
}

/**
 * Create a swap transaction pipeline
 */
export function createSwapPipeline(
  transactionId: string,
  userId: string
): StagedPipeline<SwapInput, ExecutionResult> {
  const pipeline = new StagedPipeline<SwapInput, ExecutionResult>(
    transactionId,
    userId,
    { type: "swap" }
  );

  // Stage 1: Validation
  pipeline.addStage<SwapInput, ValidationResult>({
    name: "validation",
    validate: async (input) => {
      return input.amountIn > 0n && input.minAmountOut > 0n;
    },
    execute: async (input) => {
      // Call SwapValidator
      const errors: string[] = [];

      if (input.tokenIn === input.tokenOut) {
        errors.push("Cannot swap token to itself");
      }

      if (input.deadline < Date.now() / 1000) {
        errors.push("Deadline has passed");
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    },
  });

  // Stage 2: Simulation
  pipeline.addStage<SwapInput, SimulationResult>({
    name: "simulation",
    execute: async (input) => {
      // Call contract simulate_swap
      const expectedOutput = input.amountIn * 99n / 100n; // Stub: 1% fee
      const priceImpact = 1.0; // Stub

      return {
        expectedOutput,
        priceImpact,
        gasFee: "0.0001 XLM",
      };
    },
  });

  // Stage 3: Build XDR
  pipeline.addStage<SwapInput, XDRResult>({
    name: "build_xdr",
    execute: async (input, context) => {
      // Call contract build_swap_xdr
      const xdr = "AAAA..."; // Stub
      const hash = "hash123"; // Stub

      // Store XDR in context for potential rollback
      context.metadata.xdr = xdr;

      return { xdr, hash };
    },
    rollback: async (context) => {
      // Clean up any temporary XDR storage
      delete context.metadata.xdr;
    },
  });

  // Stage 4: User Confirmation (HITL)
  pipeline.addStage<XDRResult, XDRResult>({
    name: "user_confirmation",
    execute: async (input, context) => {
      // In real implementation, this would wait for user to sign
      // For now, just pass through
      context.metadata.userConfirmed = true;
      return input;
    },
    rollback: async (context) => {
      context.metadata.userConfirmed = false;
    },
  });

  // Stage 5: Execute Transaction
  pipeline.addStage<XDRResult, ExecutionResult>({
    name: "execution",
    execute: async (input) => {
      // Submit signed XDR to network
      const txHash = "tx123"; // Stub

      return {
        txHash,
        status: "success",
      };
    },
    rollback: async () => {
      // Cannot rollback on-chain transaction
      // But can mark it as failed in local state
      console.warn("Cannot rollback on-chain transaction");
    },
  });

  return pipeline;
}

/**
 * Usage example:
 *
 * const pipeline = createSwapPipeline("tx-001", "user-123");
 *
 * try {
 *   const result = await pipeline.execute({
 *     tokenIn: "CBWYMSLBEJDFVH4QIYV7VX2W26JWVEPMC7FU4PZPS5H62SUJKJ7V4TV2",
 *     tokenOut: "CCOTCYJNSVFPNLCH3CASXSDM7IGFG23HB4PDSNZNKUUCUBLVQY3V5XTR",
 *     amountIn: 100n * 10n ** 7n,
 *     minAmountOut: 95n * 10n ** 7n,
 *     deadline: Math.floor(Date.now() / 1000) + 300,
 *     userAddress: "GXXXXXX...",
 *   });
 *
 *   console.log("Transaction successful:", result.txHash);
 * } catch (error) {
 *   if (error instanceof PipelineError) {
 *     console.error("Pipeline failed:", error.message);
 *     console.error("Context:", error.context);
 *   }
 * }
 *
 * // Get execution summary
 * const summary = pipeline.getSummary();
 * console.log("Summary:", summary);
 */
