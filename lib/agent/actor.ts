/**
 * Actor Model — message-passing concurrency
 *
 * Inspired by SWE-agent multi-agent coordination:
 * - Actors process messages sequentially (no shared state)
 * - Typed message dispatch
 * - Ask pattern (request/response)
 * - Supervision (restart on failure)
 * - Actor registry
 */

export type ActorMessage<T = unknown> = { type: string; payload: T };
export type ActorHandler<S, M extends ActorMessage> = (state: S, msg: M) => S | Promise<S>;

export interface ActorOptions<S> {
  initialState: S;
  onError?: (err: unknown, msg: ActorMessage) => void;
}

export class Actor<S, M extends ActorMessage = ActorMessage> {
  private state: S;
  private mailbox: Array<{ msg: M; resolve?: (s: S) => void; reject?: (e: Error) => void }> = [];
  private processing = false;
  private handlers = new Map<string, ActorHandler<S, ActorMessage>>();
  private onError: (err: unknown, msg: ActorMessage) => void;

  constructor(options: ActorOptions<S>) {
    this.state = options.initialState;
    this.onError = options.onError ?? ((err) => console.error("Actor error:", err));
  }

  on<T>(type: string, handler: ActorHandler<S, ActorMessage<T>>): this {
    this.handlers.set(type, handler as ActorHandler<S, ActorMessage>);
    return this;
  }

  send(msg: M): void {
    this.mailbox.push({ msg });
    this.schedule();
  }

  ask(msg: M): Promise<S> {
    return new Promise<S>((resolve, reject) => {
      this.mailbox.push({ msg, resolve, reject });
      this.schedule();
    });
  }

  getState(): S { return this.state; }

  get mailboxSize(): number { return this.mailbox.length; }

  private schedule(): void {
    if (this.processing) return;
    this.processing = true;
    Promise.resolve().then(() => this.drain());
  }

  private async drain(): Promise<void> {
    while (this.mailbox.length > 0) {
      const item = this.mailbox.shift()!;
      const handler = this.handlers.get(item.msg.type);
      if (!handler) {
        item.reject?.(new Error(`No handler for message type: ${item.msg.type}`));
        continue;
      }
      try {
        this.state = await handler(this.state, item.msg);
        item.resolve?.(this.state);
      } catch (err) {
        this.onError(err, item.msg);
        item.reject?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
    this.processing = false;
  }
}

export class ActorRegistry {
  private actors = new Map<string, Actor<unknown>>();

  register<S, M extends ActorMessage>(name: string, actor: Actor<S, M>): void {
    this.actors.set(name, actor as Actor<unknown>);
  }

  get<S, M extends ActorMessage>(name: string): Actor<S, M> | undefined {
    return this.actors.get(name) as Actor<S, M> | undefined;
  }

  send(name: string, msg: ActorMessage): boolean {
    const actor = this.actors.get(name);
    if (!actor) return false;
    actor.send(msg as ActorMessage);
    return true;
  }

  names(): string[] { return [...this.actors.keys()]; }

  remove(name: string): boolean { return this.actors.delete(name); }
}
