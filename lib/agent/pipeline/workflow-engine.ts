/**
 * Workflow Engine
 *
 * Inspired by production workflow orchestration (Temporal/Airflow patterns):
 * - DAG-based task execution
 * - Parallel and sequential steps
 * - Conditional branching
 * - Workflow versioning
 * - Pause/resume support
 *
 * Pattern: Define → Validate DAG → Execute → Branch → Complete
 */

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "paused" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface WorkflowStep<TCtx = unknown> {
  id: string;
  name: string;
  execute: (ctx: TCtx) => Promise<TCtx>;
  condition?: (ctx: TCtx) => boolean; // skip step if false
  dependsOn?: string[];               // step IDs that must complete first
  parallel?: boolean;                 // can run in parallel with siblings
  timeout?: number;                   // ms
  retries?: number;
}

export interface WorkflowStepRecord {
  id: string;
  name: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  attempts: number;
}

export interface WorkflowRecord<TCtx = unknown> {
  id: string;
  name: string;
  version: string;
  status: WorkflowStatus;
  context: TCtx;
  steps: WorkflowStepRecord[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface WorkflowResult<TCtx = unknown> {
  success: boolean;
  context: TCtx;
  record: WorkflowRecord<TCtx>;
  completedSteps: number;
  skippedSteps: number;
}

/**
 * Workflow Engine
 * Executes DAG-based workflows with parallel/sequential steps
 */
export class WorkflowEngine<TCtx = unknown> {
  private steps: WorkflowStep<TCtx>[] = [];
  private name: string;
  private version: string;

  constructor(name: string, version = "1.0.0") {
    this.name = name;
    this.version = version;
  }

  /**
   * Add a step to the workflow
   */
  addStep(step: WorkflowStep<TCtx>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Execute the workflow
   */
  async execute(initialContext: TCtx): Promise<WorkflowResult<TCtx>> {
    const record: WorkflowRecord<TCtx> = {
      id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: this.name,
      version: this.version,
      status: "running",
      context: { ...(initialContext as object) } as TCtx,
      steps: this.steps.map((s) => ({
        id: s.id,
        name: s.name,
        status: "pending",
        attempts: 0,
      })),
      startedAt: Date.now(),
    };

    let context = record.context;
    let completedSteps = 0;
    let skippedSteps = 0;
    const completedIds = new Set<string>();

    try {
      // Topological execution respecting dependencies
      const remaining = [...this.steps];

      while (remaining.length > 0) {
        // Find steps whose dependencies are all satisfied
        const ready = remaining.filter((step) => {
          const deps = step.dependsOn ?? [];
          return deps.every((depId) => completedIds.has(depId));
        });

        if (ready.length === 0) {
          throw new Error("Workflow deadlock: circular dependency or unsatisfied deps");
        }

        // Separate parallel and sequential
        const parallelSteps = ready.filter((s) => s.parallel);
        const sequentialSteps = ready.filter((s) => !s.parallel);

        // Run parallel steps concurrently
        if (parallelSteps.length > 0) {
          const results = await Promise.allSettled(
            parallelSteps.map((step) => this.runStep(step, record, context))
          );

          for (let i = 0; i < parallelSteps.length; i++) {
            const step = parallelSteps[i];
            const result = results[i];
            remaining.splice(remaining.indexOf(step), 1);

            if (result.status === "fulfilled") {
              if (result.value.skipped) {
                skippedSteps++;
              } else {
                context = result.value.context;
                completedSteps++;
              }
              completedIds.add(step.id);
            } else {
              const stepRecord = record.steps.find((s) => s.id === step.id)!;
              stepRecord.status = "failed";
              stepRecord.error = result.reason instanceof Error ? result.reason.message : String(result.reason);
              throw result.reason;
            }
          }
        }

        // Run sequential steps one by one
        for (const step of sequentialSteps) {
          remaining.splice(remaining.indexOf(step), 1);
          const result = await this.runStep(step, record, context);

          if (result.skipped) {
            skippedSteps++;
          } else {
            context = result.context;
            completedSteps++;
          }
          completedIds.add(step.id);
        }
      }

      record.status = "completed";
      record.context = context;
      record.completedAt = Date.now();

      return { success: true, context, record, completedSteps, skippedSteps };
    } catch (err) {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.completedAt = Date.now();

      return { success: false, context, record, completedSteps, skippedSteps };
    }
  }

  private async runStep(
    step: WorkflowStep<TCtx>,
    record: WorkflowRecord<TCtx>,
    context: TCtx
  ): Promise<{ context: TCtx; skipped: boolean }> {
    const stepRecord = record.steps.find((s) => s.id === step.id)!;

    // Check condition
    if (step.condition && !step.condition(context)) {
      stepRecord.status = "skipped";
      return { context, skipped: true };
    }

    stepRecord.status = "running";
    stepRecord.startedAt = Date.now();

    const maxAttempts = (step.retries ?? 0) + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      stepRecord.attempts++;
      try {
        let newContext: TCtx;

        if (step.timeout && step.timeout > 0) {
          newContext = await Promise.race([
            step.execute(context),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Step "${step.id}" timed out`)), step.timeout)
            ),
          ]);
        } else {
          newContext = await step.execute(context);
        }

        stepRecord.status = "completed";
        stepRecord.completedAt = Date.now();
        return { context: newContext, skipped: false };
      } catch (err) {
        if (attempt === maxAttempts - 1) {
          stepRecord.status = "failed";
          stepRecord.error = err instanceof Error ? err.message : String(err);
          throw err;
        }
        // Retry with small delay
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
      }
    }

    throw new Error(`Step "${step.id}" exhausted retries`);
  }
}

/**
 * Builder helper
 */
export function createWorkflow<TCtx>(name: string, version?: string): WorkflowEngine<TCtx> {
  return new WorkflowEngine<TCtx>(name, version);
}
