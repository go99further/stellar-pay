/**
 * Observable / RxJS-lite
 *
 * Inspired by RxJS patterns:
 * - Observable creation (of, from, interval, fromEvent)
 * - Operators (map, filter, take, skip, debounce, throttle, merge, combineLatest)
 * - Subject (hot observable, multicast)
 * - BehaviorSubject (current value + replay)
 * - Error handling (catchError, retry)
 *
 * Pattern: Create → Subscribe → Operate → Complete
 */

export type Observer<T> = {
  next: (value: T) => void;
  error?: (err: unknown) => void;
  complete?: () => void;
};

export type Unsubscribe = () => void;
export type OperatorFn<T, R> = (source: Observable<T>) => Observable<R>;

export class Observable<T> {
  constructor(private _subscribe: (observer: Observer<T>) => Unsubscribe | void) {}

  subscribe(observer: Partial<Observer<T>>): Unsubscribe {
    let active = true;
    const wrapped: Observer<T> = {
      next: (v) => { if (active) observer.next?.(v); },
      error: (e) => { if (active) { active = false; observer.error?.(e); } },
      complete: () => { if (active) { active = false; observer.complete?.(); } },
    };
    const cleanup = this._subscribe(wrapped);
    return () => {
      active = false;
      cleanup?.();
    };
  }

  pipe<R>(op: OperatorFn<T, R>): Observable<R> {
    return op(this);
  }

  // --- operators ---

  map<R>(fn: (value: T) => R): Observable<R> {
    return new Observable<R>((obs) =>
      this.subscribe({
        next: (v) => obs.next(fn(v)),
        error: obs.error,
        complete: obs.complete,
      })
    );
  }

  filter(predicate: (value: T) => boolean): Observable<T> {
    return new Observable<T>((obs) =>
      this.subscribe({
        next: (v) => { if (predicate(v)) obs.next(v); },
        error: obs.error,
        complete: obs.complete,
      })
    );
  }

  take(count: number): Observable<T> {
    return new Observable<T>((obs) => {
      let taken = 0;
      return this.subscribe({
        next: (v) => {
          if (taken < count) {
            taken++;
            obs.next(v);
            if (taken === count) obs.complete?.();
          }
        },
        error: obs.error,
        complete: obs.complete,
      });
    });
  }

  skip(count: number): Observable<T> {
    return new Observable<T>((obs) => {
      let skipped = 0;
      return this.subscribe({
        next: (v) => { if (skipped++ >= count) obs.next(v); },
        error: obs.error,
        complete: obs.complete,
      });
    });
  }

  debounce(ms: number): Observable<T> {
    return new Observable<T>((obs) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const unsub = this.subscribe({
        next: (v) => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => obs.next(v), ms);
        },
        error: obs.error,
        complete: () => { if (timer) clearTimeout(timer); obs.complete?.(); },
      });
      return () => { if (timer) clearTimeout(timer); unsub(); };
    });
  }

  throttle(ms: number): Observable<T> {
    return new Observable<T>((obs) => {
      let lastEmit = 0;
      return this.subscribe({
        next: (v) => {
          const now = Date.now();
          if (now - lastEmit >= ms) { lastEmit = now; obs.next(v); }
        },
        error: obs.error,
        complete: obs.complete,
      });
    });
  }

  distinctUntilChanged(eq: (a: T, b: T) => boolean = (a, b) => a === b): Observable<T> {
    return new Observable<T>((obs) => {
      let last: T | typeof NONE = NONE;
      return this.subscribe({
        next: (v) => {
          if (last === NONE || !eq(last as T, v)) { last = v; obs.next(v); }
        },
        error: obs.error,
        complete: obs.complete,
      });
    });
  }

  reduce<R>(fn: (acc: R, val: T) => R, seed: R): Observable<R> {
    return new Observable<R>((obs) => {
      let acc = seed;
      return this.subscribe({
        next: (v) => { acc = fn(acc, v); },
        error: obs.error,
        complete: () => { obs.next(acc); obs.complete?.(); },
      });
    });
  }

  catchError(handler: (err: unknown) => Observable<T>): Observable<T> {
    return new Observable<T>((obs) =>
      this.subscribe({
        next: obs.next,
        error: (e) => handler(e).subscribe(obs),
        complete: obs.complete,
      })
    );
  }

  retry(times: number): Observable<T> {
    return new Observable<T>((obs) => {
      let attempts = 0;
      let unsub: Unsubscribe;
      const attempt = () => {
        unsub = this.subscribe({
          next: obs.next,
          error: (e) => {
            if (attempts++ < times) attempt();
            else obs.error?.(e);
          },
          complete: obs.complete,
        });
      };
      attempt();
      return () => unsub?.();
    });
  }

  toArray(): Observable<T[]> {
    return this.reduce<T[]>((acc, v) => [...acc, v], []);
  }
}

const NONE = Symbol("NONE");

// --- static creators ---

export function of<T>(...values: T[]): Observable<T> {
  return new Observable<T>((obs) => {
    for (const v of values) obs.next(v);
    obs.complete?.();
  });
}

export function from<T>(iterable: Iterable<T>): Observable<T> {
  return new Observable<T>((obs) => {
    for (const v of iterable) obs.next(v);
    obs.complete?.();
  });
}

export function interval(ms: number): Observable<number> {
  return new Observable<number>((obs) => {
    let i = 0;
    const id = setInterval(() => obs.next(i++), ms);
    return () => clearInterval(id);
  });
}

export function timer(delayMs: number): Observable<0> {
  return new Observable<0>((obs) => {
    const id = setTimeout(() => { obs.next(0); obs.complete?.(); }, delayMs);
    return () => clearTimeout(id);
  });
}

export function merge<T>(...sources: Observable<T>[]): Observable<T> {
  return new Observable<T>((obs) => {
    let completed = 0;
    const unsubs = sources.map((s) =>
      s.subscribe({
        next: obs.next,
        error: obs.error,
        complete: () => { if (++completed === sources.length) obs.complete?.(); },
      })
    );
    return () => unsubs.forEach((u) => u());
  });
}

export function combineLatest<T extends unknown[]>(
  sources: { [K in keyof T]: Observable<T[K]> }
): Observable<T> {
  return new Observable<T>((obs) => {
    const values: (T[number] | typeof NONE)[] = sources.map(() => NONE);
    let completed = 0;
    const unsubs = sources.map((s, i) =>
      s.subscribe({
        next: (v) => {
          values[i] = v;
          if (values.every((x) => x !== NONE)) obs.next([...values] as T);
        },
        error: obs.error,
        complete: () => { if (++completed === sources.length) obs.complete?.(); },
      })
    );
    return () => unsubs.forEach((u) => u());
  });
}

/**
 * Subject — hot observable, multicast
 */
export class Subject<T> extends Observable<T> {
  private observers: Set<Observer<T>> = new Set();
  private _completed = false;

  constructor() {
    super((obs) => {
      this.observers.add(obs);
      return () => this.observers.delete(obs);
    });
  }

  next(value: T): void {
    if (this._completed) return;
    for (const obs of this.observers) obs.next(value);
  }

  error(err: unknown): void {
    if (this._completed) return;
    this._completed = true;
    for (const obs of this.observers) obs.error?.(err);
  }

  complete(): void {
    if (this._completed) return;
    this._completed = true;
    for (const obs of this.observers) obs.complete?.();
  }

  get closed(): boolean { return this._completed; }
  get observerCount(): number { return this.observers.size; }
}

/**
 * BehaviorSubject — replays current value to new subscribers
 */
export class BehaviorSubject<T> extends Subject<T> {
  private _value: T;

  constructor(initialValue: T) {
    super();
    this._value = initialValue;
  }

  get value(): T { return this._value; }

  override next(value: T): void {
    this._value = value;
    super.next(value);
  }

  override subscribe(observer: Partial<Observer<T>>): Unsubscribe {
    const unsub = super.subscribe(observer);
    observer.next?.(this._value);
    return unsub;
  }
}

/**
 * ReplaySubject — buffers last N values for new subscribers
 */
export class ReplaySubject<T> extends Subject<T> {
  private buffer: T[] = [];

  constructor(private bufferSize: number = Infinity) {
    super();
  }

  override next(value: T): void {
    this.buffer.push(value);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    super.next(value);
  }

  override subscribe(observer: Partial<Observer<T>>): Unsubscribe {
    const unsub = super.subscribe(observer);
    for (const v of this.buffer) observer.next?.(v);
    return unsub;
  }
}
