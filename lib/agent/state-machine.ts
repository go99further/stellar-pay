/**
 * Finite State Machine (FSM)
 *
 * Patterns from SWE-agent / Aider state management:
 * - Typed states and events
 * - Guard conditions on transitions
 * - Entry/exit actions
 * - Transition actions
 * - History (last N states)
 * - Hierarchical state support via nested machines
 */

export type StateHandler<S extends string, E extends string, C = unknown> = (
  context: C,
  event: E,
  from: S,
  to: S
) => void | Promise<void>;

export interface Transition<S extends string, E extends string, C = unknown> {
  from: S | S[];
  event: E;
  to: S;
  guard?: (context: C, event: E) => boolean;
  action?: StateHandler<S, E, C>;
}

export interface StateConfig<S extends string, E extends string, C = unknown> {
  onEnter?: (context: C, from: S) => void | Promise<void>;
  onExit?: (context: C, to: S) => void | Promise<void>;
}

export interface StateMachineConfig<S extends string, E extends string, C = unknown> {
  initial: S;
  context?: C;
  transitions: Transition<S, E, C>[];
  states?: Partial<Record<S, StateConfig<S, E, C>>>;
  maxHistory?: number;
}

export interface HistoryEntry<S extends string, E extends string> {
  from: S;
  to: S;
  event: E;
  timestamp: number;
}

export class StateMachine<S extends string, E extends string, C = unknown> {
  private current: S;
  private context: C;
  private transitions: Transition<S, E, C>[];
  private states: Partial<Record<S, StateConfig<S, E, C>>>;
  private history: HistoryEntry<S, E>[] = [];
  private maxHistory: number;
  private listeners: Array<(entry: HistoryEntry<S, E>, context: C) => void> = [];

  constructor(config: StateMachineConfig<S, E, C>) {
    this.current = config.initial;
    this.context = config.context ?? ({} as C);
    this.transitions = config.transitions;
    this.states = config.states ?? {};
    this.maxHistory = config.maxHistory ?? 50;
  }

  get state(): S { return this.current; }
  get ctx(): C { return this.context; }

  can(event: E): boolean {
    return this.findTransition(event) !== null;
  }

  async send(event: E): Promise<boolean> {
    const transition = this.findTransition(event);
    if (!transition) return false;

    const from = this.current;
    const to = transition.to;

    // Exit action
    await this.states[from]?.onExit?.(this.context, to);

    // Transition action
    await transition.action?.(this.context, event, from, to);

    this.current = to;

    // Entry action
    await this.states[to]?.onEnter?.(this.context, from);

    const entry: HistoryEntry<S, E> = { from, to, event, timestamp: Date.now() };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();

    for (const listener of this.listeners) listener(entry, this.context);

    return true;
  }

  sendSync(event: E): boolean {
    const transition = this.findTransition(event);
    if (!transition) return false;

    const from = this.current;
    const to = transition.to;

    (this.states[from]?.onExit as ((c: C, t: S) => void) | undefined)?.(this.context, to);
    (transition.action as StateHandler<S, E, C> | undefined)?.(this.context, event, from, to);

    this.current = to;

    (this.states[to]?.onEnter as ((c: C, f: S) => void) | undefined)?.(this.context, from);

    const entry: HistoryEntry<S, E> = { from, to, event, timestamp: Date.now() };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();

    for (const listener of this.listeners) listener(entry, this.context);

    return true;
  }

  updateContext(updater: (ctx: C) => C | void): void {
    const result = updater(this.context);
    if (result !== undefined) this.context = result;
  }

  onTransition(listener: (entry: HistoryEntry<S, E>, context: C) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getHistory(): HistoryEntry<S, E>[] {
    return [...this.history];
  }

  matches(state: S): boolean {
    return this.current === state;
  }

  private findTransition(event: E): Transition<S, E, C> | null {
    for (const t of this.transitions) {
      const froms = Array.isArray(t.from) ? t.from : [t.from];
      if (!froms.includes(this.current)) continue;
      if (t.event !== event) continue;
      if (t.guard && !t.guard(this.context, event)) continue;
      return t;
    }
    return null;
  }
}
