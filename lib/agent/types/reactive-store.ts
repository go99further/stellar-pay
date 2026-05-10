/**
 * Reactive Store
 *
 * Inspired by Redux/MobX/Zustand patterns:
 * - Immutable state updates via reducers
 * - Selector memoization
 * - Middleware (logging, persistence, devtools)
 * - Time-travel debugging (undo/redo)
 * - Derived state with automatic recomputation
 *
 * Pattern: Action → Reducer → State → Selector → View
 */

export type Action<T = unknown> = { type: string; payload?: T };
export type Reducer<TState, TAction extends Action = Action> = (
  state: TState,
  action: TAction
) => TState;
export type Selector<TState, TResult> = (state: TState) => TResult;
export type StoreMiddleware<TState> = (
  store: ReactiveStore<TState>,
  action: Action,
  next: (action: Action) => void
) => void;
export type Subscriber<TState> = (state: TState, prevState: TState) => void;

export interface StoreConfig<TState> {
  maxHistory: number; // for undo/redo
}

export interface StoreStats {
  dispatched: number;
  subscriptions: number;
  historySize: number;
}

/**
 * Reactive Store
 * Predictable state container with undo/redo and middleware
 */
export class ReactiveStore<TState> {
  private state: TState;
  private reducer: Reducer<TState>;
  private subscribers: Set<Subscriber<TState>> = new Set();
  private middlewares: StoreMiddleware<TState>[] = [];
  private history: TState[] = [];
  private future: TState[] = [];
  private config: StoreConfig<TState>;
  private selectorCache: Map<Selector<TState, unknown>, { input: TState; result: unknown }> = new Map();
  private stats = { dispatched: 0 };

  constructor(
    initialState: TState,
    reducer: Reducer<TState>,
    config: Partial<StoreConfig<TState>> = {}
  ) {
    this.state = initialState;
    this.reducer = reducer;
    this.config = { maxHistory: 50, ...config };
  }

  /**
   * Get current state
   */
  getState(): TState {
    return this.state;
  }

  /**
   * Dispatch an action
   */
  dispatch(action: Action): void {
    if (this.middlewares.length > 0) {
      this.runMiddleware(action, 0);
    } else {
      this.applyAction(action);
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe(subscriber: Subscriber<TState>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /**
   * Select derived state with memoization
   */
  select<TResult>(selector: Selector<TState, TResult>): TResult {
    const cached = this.selectorCache.get(selector as Selector<TState, unknown>);
    if (cached && cached.input === this.state) {
      return cached.result as TResult;
    }
    const result = selector(this.state);
    this.selectorCache.set(selector as Selector<TState, unknown>, {
      input: this.state,
      result,
    });
    return result;
  }

  /**
   * Add middleware
   */
  use(middleware: StoreMiddleware<TState>): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Undo last action
   */
  undo(): boolean {
    if (this.history.length === 0) return false;
    this.future.push(this.state);
    this.state = this.history.pop()!;
    this.notify(this.future[this.future.length - 1]);
    return true;
  }

  /**
   * Redo last undone action
   */
  redo(): boolean {
    if (this.future.length === 0) return false;
    this.history.push(this.state);
    this.state = this.future.pop()!;
    this.notify(this.history[this.history.length - 1]);
    return true;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * Get store statistics
   */
  getStats(): StoreStats {
    return {
      dispatched: this.stats.dispatched,
      subscriptions: this.subscribers.size,
      historySize: this.history.length,
    };
  }

  /**
   * Reset to initial state
   */
  reset(initialState: TState): void {
    const prev = this.state;
    this.state = initialState;
    this.history = [];
    this.future = [];
    this.selectorCache.clear();
    this.notify(prev);
  }

  private applyAction(action: Action): void {
    const prevState = this.state;
    const nextState = this.reducer(this.state, action);

    if (nextState !== prevState) {
      // Save to history
      this.history.push(prevState);
      if (this.history.length > this.config.maxHistory) {
        this.history.shift();
      }
      // Clear redo stack on new action
      this.future = [];
      this.selectorCache.clear();
      this.state = nextState;
      this.notify(prevState);
    }

    this.stats.dispatched++;
  }

  private runMiddleware(action: Action, index: number): void {
    if (index >= this.middlewares.length) {
      this.applyAction(action);
      return;
    }
    this.middlewares[index](this, action, (nextAction) => {
      this.runMiddleware(nextAction, index + 1);
    });
  }

  private notify(prevState: TState): void {
    for (const subscriber of this.subscribers) {
      subscriber(this.state, prevState);
    }
  }
}

/**
 * Create a store with typed actions
 */
export function createStore<TState>(
  initialState: TState,
  reducer: Reducer<TState>,
  config?: Partial<StoreConfig<TState>>
): ReactiveStore<TState> {
  return new ReactiveStore(initialState, reducer, config);
}
