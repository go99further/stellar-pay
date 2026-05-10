/**
 * Pipeline Pattern — composable async processing stages
 *
 * Inspired by Aider's staged execution and SWE-agent's tool pipeline:
 * - Type-safe stage chaining
 * - Per-stage error handling
 * - Tap (side-effect) stages
 * - Conditional branching
 * - Parallel fan-out / fan-in
 */

export type PipelineStage<I, O> = (input: I) => Promise<O> | O;

export class Pipeline<T> {
  private stages: Array<PipelineStage<unknown, unknown>> = [];

  static of<T>(value: T): Pipeline<T> {
    const p = new Pipeline<T>();
    return p;
  }

  pipe<O>(stage: PipelineStage<T, O>): Pipeline<O> {
    const next = new Pipeline<O>();
    next.stages = [...this.stages, stage as PipelineStage<unknown, unknown>];
    return next;
  }

  tap(fn: (value: T) => void | Promise<void>): Pipeline<T> {
    return this.pipe(async (v) => { await fn(v as T); return v as T; }) as unknown as Pipeline<T>;
  }

  filter(predicate: (value: T) => boolean, fallback?: T): Pipeline<T> {
    return this.pipe((v) => {
      if (predicate(v as T)) return v as T;
      if (fallback !== undefined) return fallback;
      throw new Error("Pipeline filter rejected value");
    }) as unknown as Pipeline<T>;
  }

  map<O>(fn: (value: T) => O | Promise<O>): Pipeline<O> {
    return this.pipe(fn);
  }

  async run(input: T): Promise<T> {
    let value: unknown = input;
    for (const stage of this.stages) {
      value = await stage(value);
    }
    return value as T;
  }

  async runSafe(input: T): Promise<{ ok: true; value: T } | { ok: false; error: Error; stage: number }> {
    let value: unknown = input;
    for (let i = 0; i < this.stages.length; i++) {
      try {
        value = await this.stages[i](value);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)), stage: i };
      }
    }
    return { ok: true, value: value as T };
  }
}

export function parallel<T, O>(
  fns: Array<(input: T) => Promise<O> | O>
): (input: T) => Promise<O[]> {
  return (input: T) => Promise.all(fns.map((fn) => fn(input)));
}

export function sequential<T>(
  fns: Array<(input: T) => Promise<T> | T>
): (input: T) => Promise<T> {
  return async (input: T) => {
    let value = input;
    for (const fn of fns) value = await fn(value);
    return value;
  };
}
