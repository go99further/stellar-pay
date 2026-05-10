/**
 * Event Sourcing — append-only event log with projections
 *
 * Inspired by Aider git-style persistence + SWE-agent trajectory:
 * - Immutable event log (append-only)
 * - Aggregate reconstruction from events
 * - Snapshots for fast replay
 * - Projections (read models)
 * - Event versioning
 */

export interface DomainEvent<T = unknown> {
  id: string;
  aggregateId: string;
  type: string;
  payload: T;
  version: number;
  timestamp: number;
}

export interface Snapshot<S> {
  aggregateId: string;
  state: S;
  version: number;
  timestamp: number;
}

let _evtCounter = 0;
function newEventId(): string { return `evt-${++_evtCounter}`; }

export class EventStore {
  private events: DomainEvent[] = [];
  private snapshots = new Map<string, Snapshot<unknown>>();

  append<T>(aggregateId: string, type: string, payload: T): DomainEvent<T> {
    const lastVersion = this.getLastVersion(aggregateId);
    const event: DomainEvent<T> = {
      id: newEventId(),
      aggregateId,
      type,
      payload,
      version: lastVersion + 1,
      timestamp: Date.now(),
    };
    this.events.push(event as DomainEvent);
    return event;
  }

  getEvents(aggregateId: string, fromVersion = 0): DomainEvent[] {
    return this.events.filter(
      (e) => e.aggregateId === aggregateId && e.version > fromVersion
    );
  }

  getAllEvents(): DomainEvent[] { return [...this.events]; }

  saveSnapshot<S>(aggregateId: string, state: S, version: number): void {
    this.snapshots.set(aggregateId, { aggregateId, state, version, timestamp: Date.now() });
  }

  getSnapshot<S>(aggregateId: string): Snapshot<S> | undefined {
    return this.snapshots.get(aggregateId) as Snapshot<S> | undefined;
  }

  getLastVersion(aggregateId: string): number {
    const events = this.events.filter((e) => e.aggregateId === aggregateId);
    return events.length === 0 ? 0 : events[events.length - 1].version;
  }

  eventCount(aggregateId?: string): number {
    if (!aggregateId) return this.events.length;
    return this.events.filter((e) => e.aggregateId === aggregateId).length;
  }

  clear(): void {
    this.events = [];
    this.snapshots.clear();
  }
}

export class Aggregate<S> {
  protected state: S;
  private version = 0;

  constructor(
    readonly id: string,
    initialState: S,
    private readonly apply: (state: S, event: DomainEvent) => S
  ) {
    this.state = initialState;
  }

  rehydrate(events: DomainEvent[], snapshot?: Snapshot<S>): void {
    if (snapshot) {
      this.state = snapshot.state;
      this.version = snapshot.version;
    }
    for (const event of events) {
      this.state = this.apply(this.state, event);
      this.version = event.version;
    }
  }

  applyEvent(event: DomainEvent): void {
    this.state = this.apply(this.state, event);
    this.version = event.version;
  }

  getState(): S { return this.state; }
  getVersion(): number { return this.version; }
}

export class Projection<S> {
  private state: S;

  constructor(
    initialState: S,
    private readonly handlers: Partial<Record<string, (state: S, event: DomainEvent) => S>>
  ) {
    this.state = initialState;
  }

  project(events: DomainEvent[]): S {
    let state = this.state;
    for (const event of events) {
      const handler = this.handlers[event.type];
      if (handler) state = handler(state, event);
    }
    this.state = state;
    return state;
  }

  getState(): S { return this.state; }

  reset(initialState: S): void { this.state = initialState; }
}
