/**
 * Request Pipeline
 *
 * Inspired by Express/Koa middleware patterns and SWE-agent's staged execution:
 * - Composable middleware chain
 * - Request/response context
 * - Error handling middleware
 * - Timeout and cancellation
 * - Pipeline metrics
 *
 * Pattern: Request → Middleware1 → Middleware2 → Handler → Response
 */

export interface PipelineContext<TReq = unknown, TRes = unknown> {
  request: TReq;
  response?: TRes;
  metadata: Record<string, unknown>;
  startTime: number;
  aborted: boolean;
  error?: Error;
}

export type MiddlewareFn<TReq = unknown, TRes = unknown> = (
  ctx: PipelineContext<TReq, TRes>,
  next: () => Promise<void>
) => Promise<void>;

export type HandlerFn<TReq = unknown, TRes = unknown> = (
  ctx: PipelineContext<TReq, TRes>
) => Promise<TRes>;

export interface PipelineOptions {
  timeout: number; // ms, 0 = no timeout
  name: string;
}

export interface PipelineStats {
  executed: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  averageLatency: number;
}

/**
 * Request Pipeline
 * Composable middleware chain with typed request/response
 */
export class RequestPipeline<TReq = unknown, TRes = unknown> {
  private middlewares: MiddlewareFn<TReq, TRes>[] = [];
  private options: PipelineOptions;
  private stats: PipelineStats = {
    executed: 0,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    averageLatency: 0,
  };
  private latencyHistory: number[] = [];

  constructor(options: Partial<PipelineOptions> = {}) {
    this.options = {
      timeout: 0,
      name: "pipeline",
      ...options,
    };
  }

  /**
   * Add middleware to the pipeline
   */
  use(middleware: MiddlewareFn<TReq, TRes>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the pipeline with a handler
   */
  async execute(request: TReq, handler: HandlerFn<TReq, TRes>): Promise<TRes> {
    const ctx: PipelineContext<TReq, TRes> = {
      request,
      metadata: {},
      startTime: Date.now(),
      aborted: false,
    };

    this.stats.executed++;

    const run = async (): Promise<TRes> => {
      // Build middleware chain
      const chain = [...this.middlewares];
      let index = 0;

      const next = async (): Promise<void> => {
        if (ctx.aborted) return;
        if (index < chain.length) {
          const mw = chain[index++];
          await mw(ctx, next);
        } else {
          // End of middleware chain — call handler
          ctx.response = await handler(ctx);
        }
      };

      await next();

      if (ctx.error) throw ctx.error;
      return ctx.response as TRes;
    };

    try {
      let result: TRes;

      if (this.options.timeout > 0) {
        result = await Promise.race([
          run(),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              ctx.aborted = true;
              this.stats.timedOut++;
              reject(new Error(`Pipeline "${this.options.name}" timed out after ${this.options.timeout}ms`));
            }, this.options.timeout)
          ),
        ]);
      } else {
        result = await run();
      }

      const latency = Date.now() - ctx.startTime;
      this.recordLatency(latency);
      this.stats.succeeded++;
      return result;
    } catch (err) {
      if (!ctx.aborted) {
        const latency = Date.now() - ctx.startTime;
        this.recordLatency(latency);
        this.stats.failed++;
      }
      throw err;
    }
  }

  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /**
   * Create a logging middleware
   */
  static logging<TReq, TRes>(
    log: (msg: string) => void = console.log
  ): MiddlewareFn<TReq, TRes> {
    return async (ctx, next) => {
      log(`[pipeline] start`);
      await next();
      const duration = Date.now() - ctx.startTime;
      log(`[pipeline] end ${duration}ms`);
    };
  }

  /**
   * Create a retry middleware
   */
  static retry<TReq, TRes>(
    maxRetries: number,
    delayMs = 100
  ): MiddlewareFn<TReq, TRes> {
    return async (ctx, next) => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          ctx.error = undefined;
          await next();
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          ctx.error = lastError;
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt)));
          }
        }
      }
      throw lastError;
    };
  }

  /**
   * Create a caching middleware
   */
  static cache<TReq, TRes>(
    keyFn: (req: TReq) => string,
    ttlMs = 60000
  ): MiddlewareFn<TReq, TRes> {
    const store = new Map<string, { value: TRes; expiresAt: number }>();

    return async (ctx, next) => {
      const key = keyFn(ctx.request);
      const cached = store.get(key);

      if (cached && Date.now() < cached.expiresAt) {
        ctx.response = cached.value;
        ctx.metadata["cache"] = "hit";
        return;
      }

      ctx.metadata["cache"] = "miss";
      await next();

      if (ctx.response !== undefined) {
        store.set(key, { value: ctx.response, expiresAt: Date.now() + ttlMs });
      }
    };
  }

  /**
   * Create a rate-limit middleware
   */
  static rateLimit<TReq, TRes>(
    maxPerWindow: number,
    windowMs: number,
    keyFn: (req: TReq) => string = () => "global"
  ): MiddlewareFn<TReq, TRes> {
    const windows = new Map<string, number[]>();

    return async (ctx, next) => {
      const key = keyFn(ctx.request);
      const now = Date.now();
      const windowStart = now - windowMs;

      let timestamps = windows.get(key) ?? [];
      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= maxPerWindow) {
        throw new Error(`Rate limit exceeded for key "${key}"`);
      }

      timestamps.push(now);
      windows.set(key, timestamps);
      await next();
    };
  }

  private recordLatency(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > 100) this.latencyHistory.shift();
    this.stats.averageLatency =
      this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
  }
}
