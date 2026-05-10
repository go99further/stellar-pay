/**
 * Saga Orchestrator
 *
 * Inspired by microservices saga pattern (Choreography + Orchestration):
 * - Coordinate multi-step distributed transactions
 * - Automatic compensation on failure
 * - Step-level retry with backoff
 * - Saga history and observability
 *
 * Pattern: Start → Step1 → Step2 → ... → Commit | Compensate
 */

export type SagaStatus = "pending" | "running" | "completed" | "compensating" | "compensated" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "compensated";

export interface SagaStep<TContext = unknown> {
  name: string;
  execute: (context: TContext) => Promise<TContext>;
  compensate: (context: TContext) => Promise<TContext>;
  maxRetries?: number;
  retryDelay?: number;
}

export interface SagaStepRecord<TContext = unknown> {
  name: string;
  status: StepStatus;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  contextSnapshot?: TContext;
}

export interface SagaRecord<TContext = unknown> {
  id: string;
  name: string;
  status: SagaStatus;
  context: TContext;
  steps: SagaStepRecord<TContext>[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface SagaResult<TContext = unknown> {
  success: boolean;
  context: TContext;
  record: SagaRecord<TContext>;
}

/**
 * Saga Orchestrator
 * Executes a sequence of steps with automatic compensation on failure
 */
export class SagaOrchestrator<TContext = unknown> {
  private steps: SagaStep<TContext>[] = [];
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Add a step to the saga
   */
  step(step: SagaStep<TContext>): this {
    this.steps.push(step);
    return this;
  }

  /**
   * Execute the saga
   */
  async execute(initialContext: TContext): Promise<SagaResult<TContext>> {
    const record: SagaRecord<TContext> = {
      id: `saga_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      name: this.name,
      status: "running",
      context: { ...initialContext as object } as TContext,
      steps: this.steps.map((s) => ({
        name: s.name,
        status: "pending",
        attempts: 0,
      })),
      startedAt: Date.now(),
    };

    let context = record.context;
    const completedSteps: number[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const stepRecord = record.steps[i];

      stepRecord.status = "running";
      stepRecord.startedAt = Date.now();

      const maxRetries = step.maxRetries ?? 0;
      const retryDelay = step.retryDelay ?? 500;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        stepRecord.attempts++;
        try {
          context = await step.execute(context);
          stepRecord.status = "completed";
          stepRecord.completedAt = Date.now();
          stepRecord.contextSnapshot = { ...context as object } as TContext;
          completedSteps.push(i);
          lastError = null;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, retryDelay * Math.pow(2, attempt)));
          }
        }
      }

      if (lastError) {
        stepRecord.status = "failed";
        stepRecord.error = lastError.message;
        record.error = `Step "${step.name}" failed: ${lastError.message}`;
        record.status = "compensating";

        // Compensate completed steps in reverse order
        context = await this.compensate(record, context, completedSteps);
        record.completedAt = Date.now();

        return { success: false, context, record };
      }
    }

    record.status = "completed";
    record.context = context;
    record.completedAt = Date.now();

    return { success: true, context, record };
  }

  private async compensate(
    record: SagaRecord<TContext>,
    context: TContext,
    completedStepIndices: number[]
  ): Promise<TContext> {
    for (const i of [...completedStepIndices].reverse()) {
      const step = this.steps[i];
      const stepRecord = record.steps[i];

      try {
        context = await step.compensate(context);
        stepRecord.status = "compensated";
      } catch {
        // Log but continue compensating other steps
      }
    }

    record.status = "compensated";
    return context;
  }
}

/**
 * Builder helper
 */
export function createSaga<TContext>(name: string): SagaOrchestrator<TContext> {
  return new SagaOrchestrator<TContext>(name);
}
