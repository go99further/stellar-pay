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

export class Pipeline<TIn, TOut = TIn> {
  private stages: Array<PipelineStage<unknown, unknown>> = [];

  static of<T>(value: T): Pipeline<T, T> {
    const p = new Pipeline<T, T>();
    return p;
  }

  pipe<O>(stage: PipelineStage<TOut, O>): Pipeline<TIn, O> {
    const next = new Pipeline<TIn, O>();
    next.stages = [...this.stages, stage as PipelineStage<unknown, unknown>];
    return next;
  }

  tap(fn: (value: TOut) => void | Promise<void>): Pipeline<TIn, TOut> {
    return this.pipe(async (v) => { await fn(v as TOut); return v as TOut; }) as unknown as Pipeline<TIn, TOut>;
  }

  filter(predicate: (value: TOut) => boolean, fallback?: TOut): Pipeline<TIn, TOut> {
    return this.pipe((v) => {
      if (predicate(v as TOut)) return v as TOut;
      if (fallback !== undefined) return fallback;
      throw new Error("Pipeline filter rejected value");
    }) as unknown as Pipeline<TIn, TOut>;
  }

  map<O>(fn: (value: TOut) => O | Promise<O>): Pipeline<TIn, O> {
    return this.pipe(fn);
  }

  async run(input: TIn): Promise<TOut> {
    let value: unknown = input;
    for (const stage of this.stages) {
      value = await stage(value);
    }
    return value as TOut;
  }

  async runSafe(input: TIn): Promise<{ ok: true; value: TOut } | { ok: false; error: Error; stage: number }> {
    let value: unknown = input;
    for (let i = 0; i < this.stages.length; i++) {
      try {
        value = await this.stages[i](value);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)), stage: i };
      }
    }
    return { ok: true, value: value as TOut };
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
