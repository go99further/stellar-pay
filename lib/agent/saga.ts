/**
 * Saga Pattern — distributed transaction coordinator
 *
 * Inspired by microservice saga patterns from SWE-agent/Plandex:
 * - Sequential step execution with compensations
 * - Automatic rollback on failure
 * - Step-level retry policy
 * - Execution log for observability
 */

export interface SagaStep<C = unknown> {
  name: string;
  execute: (context: C) => Promise<void> | void;
  compensate?: (context: C) => Promise<void> | void;
  retries?: number;
}

export type SagaStatus = "pending" | "running" | "completed" | "compensating" | "failed";

export interface SagaLog {
  step: string;
  status: "executed" | "compensated" | "failed";
  error?: string;
  timestamp: number;
}

export interface SagaResult<C> {
  status: SagaStatus;
  context: C;
  log: SagaLog[];
  error?: Error;
}

export class Saga<C = unknown> {
  private steps: SagaStep<C>[] = [];

  step(s: SagaStep<C>): this {
    this.steps.push(s);
    return this;
  }

  async execute(context: C): Promise<SagaResult<C>> {
    const log: SagaLog[] = [];
    const executed: SagaStep<C>[] = [];
    let status: SagaStatus = "running";

    for (const step of this.steps) {
      const retries = step.retries ?? 0;
      let lastError: Error | undefined;
      let succeeded = false;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          await step.execute(context);
          log.push({ step: step.name, status: "executed", timestamp: Date.now() });
          executed.push(step);
          succeeded = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      if (!succeeded) {
        log.push({ step: step.name, status: "failed", error: lastError!.message, timestamp: Date.now() });
        status = "compensating";

        // Compensate in reverse order
        for (let i = executed.length - 1; i >= 0; i--) {
          const prev = executed[i];
          if (prev.compensate) {
            try {
              await prev.compensate(context);
              log.push({ step: prev.name, status: "compensated", timestamp: Date.now() });
            } catch {
              // Best-effort compensation
            }
          }
        }

        return { status: "failed", context, log, error: lastError };
      }
    }

    return { status: "completed", context, log };
  }
}
