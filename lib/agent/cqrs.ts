/**
 * CQRS — Command Query Responsibility Segregation
 *
 * Inspired by DDD patterns from Aider/SWE-agent:
 * - Commands mutate state (write side)
 * - Queries read state (read side)
 * - Command/Query bus with middleware
 * - Result type for error handling
 */

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T> { return { ok: true, value }; }
export function Err<E = Error>(error: E): Result<never, E> { return { ok: false, error }; }

export interface Command<T = unknown> { type: string; payload: T }
export interface Query<T = unknown> { type: string; payload: T }

export type CommandHandler<C extends Command, R = void> = (cmd: C) => Promise<Result<R>> | Result<R>;
export type QueryHandler<Q extends Query, R = unknown> = (query: Q) => Promise<R> | R;
export type CQRSMiddleware<T> = (msg: T, next: () => Promise<unknown>) => Promise<unknown>;

export class CommandBus {
  private handlers = new Map<string, CommandHandler<Command, unknown>>();
  private middlewares: CQRSMiddleware<Command>[] = [];

  register<C extends Command, R>(type: string, handler: CommandHandler<C, R>): void {
    this.handlers.set(type, handler as CommandHandler<Command, unknown>);
  }

  use(middleware: CQRSMiddleware<Command>): void {
    this.middlewares.push(middleware);
  }

  async dispatch<R = void>(cmd: Command): Promise<Result<R>> {
    const handler = this.handlers.get(cmd.type);
    if (!handler) return Err(new Error(`No handler for command: ${cmd.type}`));

    let idx = 0;
    const next = async (): Promise<unknown> => {
      if (idx < this.middlewares.length) {
        return this.middlewares[idx++](cmd, next);
      }
      return handler(cmd);
    };

    try {
      return (await next()) as Result<R>;
    } catch (err) {
      return Err(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export class QueryBus {
  private handlers = new Map<string, QueryHandler<Query, unknown>>();
  private middlewares: CQRSMiddleware<Query>[] = [];

  register<Q extends Query, R>(type: string, handler: QueryHandler<Q, R>): void {
    this.handlers.set(type, handler as QueryHandler<Query, unknown>);
  }

  use(middleware: CQRSMiddleware<Query>): void {
    this.middlewares.push(middleware);
  }

  async query<R>(q: Query): Promise<R> {
    const handler = this.handlers.get(q.type);
    if (!handler) throw new Error(`No handler for query: ${q.type}`);

    let idx = 0;
    const next = async (): Promise<unknown> => {
      if (idx < this.middlewares.length) {
        return this.middlewares[idx++](q, next);
      }
      return handler(q);
    };

    return (await next()) as R;
  }
}
