/**
 * State Machine
 *
 * Inspired by XState and production workflow patterns:
 * - Finite state machine with typed states and events
 * - Guard conditions on transitions
 * - Entry/exit actions
 * - History tracking
 * - Hierarchical states (nested)
 *
 * Pattern: State → Event → Guard → Transition → Action → New State
 */

export type StateValue = string;
export type EventType = string;

export interface Transition<TContext = unknown> {
  target: StateValue;
  guard?: (context: TContext, event: MachineEvent) => boolean;
  action?: (context: TContext, event: MachineEvent) => TContext | void;
}

export interface StateConfig<TContext = unknown> {
  entry?: (context: TContext, event: MachineEvent) => TContext | void;
  exit?: (context: TContext, event: MachineEvent) => TContext | void;
  on?: Record<EventType, Transition<TContext> | Transition<TContext>[]>;
  type?: "final";
}

export interface MachineConfig<TContext = unknown> {
  id: string;
  initial: StateValue;
  context: TContext;
  states: Record<StateValue, StateConfig<TContext>>;
}

export interface MachineEvent<TData = unknown> {
  type: EventType;
  data?: TData;
}

export interface HistoryEntry<TContext = unknown> {
  from: StateValue;
  to: StateValue;
  event: MachineEvent;
  context: TContext;
  timestamp: number;
}

export interface MachineSnapshot<TContext = unknown> {
  state: StateValue;
  context: TContext;
  done: boolean;
}

/**
 * Finite State Machine
 */
export class StateMachine<TContext = unknown> {
  private config: MachineConfig<TContext>;
  private currentState: StateValue;
  private context: TContext;
  private history: HistoryEntry<TContext>[] = [];
  private listeners: Set<(snapshot: MachineSnapshot<TContext>) => void> = new Set();

  constructor(config: MachineConfig<TContext>) {
    this.config = config;
    this.currentState = config.initial;
    this.context = { ...config.context };

    // Run entry action for initial state
    const initialStateConfig = config.states[config.initial];
    if (initialStateConfig?.entry) {
      const result = initialStateConfig.entry(this.context, { type: "$$init" });
      if (result !== undefined) this.context = result as TContext;
    }
  }

  /**
   * Send an event to the machine
   */
  send(event: MachineEvent | EventType): MachineSnapshot<TContext> {
    const evt: MachineEvent = typeof event === "string" ? { type: event } : event;
    const stateConfig = this.config.states[this.currentState];

    if (!stateConfig) {
      throw new Error(`Unknown state: ${this.currentState}`);
    }

    if (stateConfig.type === "final") {
      return this.snapshot();
    }

    const transitions = stateConfig.on?.[evt.type];
    if (!transitions) {
      return this.snapshot(); // No transition defined — stay in current state
    }

    const transitionList = Array.isArray(transitions) ? transitions : [transitions];

    for (const transition of transitionList) {
      // Check guard
      if (transition.guard && !transition.guard(this.context, evt)) {
        continue;
      }

      const fromState = this.currentState;
      let newContext = this.context;

      // Run exit action
      if (stateConfig.exit) {
        const result = stateConfig.exit(newContext, evt);
        if (result !== undefined) newContext = result as TContext;
      }

      // Run transition action
      if (transition.action) {
        const result = transition.action(newContext, evt);
        if (result !== undefined) newContext = result as TContext;
      }

      // Transition to new state
      this.currentState = transition.target;
      this.context = newContext;

      // Run entry action for new state
      const newStateConfig = this.config.states[this.currentState];
      if (newStateConfig?.entry) {
        const result = newStateConfig.entry(this.context, evt);
        if (result !== undefined) this.context = result as TContext;
      }

      // Record history
      this.history.push({
        from: fromState,
        to: this.currentState,
        event: evt,
        context: { ...this.context },
        timestamp: Date.now(),
      });

      const snap = this.snapshot();
      this.notify(snap);
      return snap;
    }

    return this.snapshot(); // All guards failed
  }

  /**
   * Get current snapshot
   */
  snapshot(): MachineSnapshot<TContext> {
    return {
      state: this.currentState,
      context: { ...this.context },
      done: this.config.states[this.currentState]?.type === "final",
    };
  }

  /**
   * Check if machine is in a given state
   */
  matches(state: StateValue): boolean {
    return this.currentState === state;
  }

  /**
   * Get transition history
   */
  getHistory(): HistoryEntry<TContext>[] {
    return [...this.history];
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (snapshot: MachineSnapshot<TContext>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get available transitions from current state
   */
  getAvailableEvents(): EventType[] {
    const stateConfig = this.config.states[this.currentState];
    return Object.keys(stateConfig?.on ?? {});
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentState = this.config.initial;
    this.context = { ...this.config.context };
    this.history = [];
  }

  private notify(snapshot: MachineSnapshot<TContext>): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

/**
 * Factory helper for common Stellar-Pay state machines
 */
export function createSwapStateMachine(initialContext: {
  txHash?: string;
  error?: string;
  retries: number;
}) {
  return new StateMachine({
    id: "swap",
    initial: "idle",
    context: initialContext,
    states: {
      idle: {
        on: {
          SUBMIT: { target: "validating" },
        },
      },
      validating: {
        on: {
          VALID: { target: "signing" },
          INVALID: { target: "failed" },
        },
      },
      signing: {
        on: {
          SIGNED: { target: "submitting" },
          REJECTED: { target: "failed" },
        },
      },
      submitting: {
        on: {
          SUCCESS: {
            target: "completed",
            action: (ctx, evt) => ({ ...ctx, txHash: evt.data as string }),
          },
          FAILURE: {
            target: "retrying",
            guard: (ctx) => ctx.retries < 3,
            action: (ctx, evt) => ({ ...ctx, error: evt.data as string, retries: ctx.retries + 1 }),
          },
          FAILURE_FINAL: { target: "failed" },
        },
      },
      retrying: {
        on: {
          RETRY: { target: "submitting" },
          ABORT: { target: "failed" },
        },
      },
      completed: { type: "final" },
      failed: { type: "final" },
    },
  });
}
