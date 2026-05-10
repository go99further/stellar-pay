/**
 * Circuit Breaker (enhanced)
 *
 * Inspired by Hystrix/Resilience4j patterns:
 * - Three states: CLOSED → OPEN → HALF_OPEN
 * - Failure threshold with sliding window
 * - Success threshold to close from HALF_OPEN
 * - Timeout-based auto-reset
 * - Fallback support
 * - Event emission on state transitions
 *
 * Pattern: Execute → Track → Trip → Wait → Probe → Recover
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;    // failures before opening
  successThreshold: number;    // successes in HALF_OPEN to close
  timeout: number;             // ms before OPEN → HALF_OPEN
  windowSize: number;          // sliding window for failure rate
  volumeThreshold: number;     // min calls before tripping
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  rejected: number;
  lastFailureTime?: number;
  consecutiveSuccesses: number;
}

export type CircuitEvent =
  | { type: "open"; reason: string }
  | { type: "half_open" }
  | { type: "close" }
  | { type: "rejected" }
  | { type: "success" }
  | { type: "failure"; error: unknown };

export class CircuitBreaker<T> {
  private state: CircuitState = "CLOSED";
  private window: boolean[] = []; // true=success, false=failure
  private consecutiveSuccesses = 0;
  private rejected = 0;
  private lastFailureTime?: number;
  private listeners: Array<(event: CircuitEvent) => void> = [];
  private opts: CircuitBreakerOptions;

  constructor(
    private readonly fn: (...args: unknown[]) => Promise<T>,
    options: Partial<CircuitBreakerOptions> = {}
  ) {
    this.opts = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30_000,
      windowSize: 10,
      volumeThreshold: 5,
      ...options,
    };
  }

  async execute(...args: unknown[]): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "OPEN") {
      this.rejected++;
      this.emit({ type: "rejected" });
      throw new Error("Circuit breaker is OPEN");
    }

    try {
      const result = await this.fn(...args);
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure(err);
      throw err;
    }
  }

  async executeWithFallback(fallback: () => T | Promise<T>, ...args: unknown[]): Promise<T> {
    try {
      return await this.execute(...args);
    } catch {
      return fallback();
    }
  }

  on(listener: (event: CircuitEvent) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  getState(): CircuitState { return this.state; }

  getStats(): CircuitBreakerStats {
    const failures = this.window.filter((v) => !v).length;
    const successes = this.window.filter((v) => v).length;
    return {
      state: this.state,
      failures,
      successes,
      rejected: this.rejected,
      lastFailureTime: this.lastFailureTime,
      consecutiveSuccesses: this.consecutiveSuccesses,
    };
  }

  reset(): void {
    this.state = "CLOSED";
    this.window = [];
    this.consecutiveSuccesses = 0;
    this.rejected = 0;
    this.lastFailureTime = undefined;
  }

  private recordSuccess(): void {
    this.addToWindow(true);
    this.consecutiveSuccesses++;
    this.emit({ type: "success" });

    if (this.state === "HALF_OPEN" && this.consecutiveSuccesses >= this.opts.successThreshold) {
      this.transition("CLOSED");
    }
  }

  private recordFailure(error: unknown): void {
    this.addToWindow(false);
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = Date.now();
    this.emit({ type: "failure", error });

    if (this.state === "HALF_OPEN") {
      this.transition("OPEN");
      return;
    }

    if (this.state === "CLOSED" && this.shouldTrip()) {
      this.transition("OPEN");
    }
  }

  private shouldTrip(): boolean {
    if (this.window.length < this.opts.volumeThreshold) return false;
    const failures = this.window.filter((v) => !v).length;
    return failures >= this.opts.failureThreshold;
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === "OPEN" &&
      this.lastFailureTime !== undefined &&
      Date.now() - this.lastFailureTime >= this.opts.timeout
    ) {
      this.transition("HALF_OPEN");
    }
  }

  private transition(next: CircuitState): void {
    this.state = next;
    if (next === "OPEN") {
      this.emit({ type: "open", reason: "failure threshold exceeded" });
    } else if (next === "HALF_OPEN") {
      this.consecutiveSuccesses = 0;
      this.emit({ type: "half_open" });
    } else {
      this.window = [];
      this.emit({ type: "close" });
    }
  }

  private addToWindow(success: boolean): void {
    this.window.push(success);
    if (this.window.length > this.opts.windowSize) this.window.shift();
  }

  private emit(event: CircuitEvent): void {
    for (const l of this.listeners) l(event);
  }
}
