/**
 * Health Check System
 *
 * Inspired by Spring Boot Actuator / Kubernetes probe patterns:
 * - Liveness, readiness, startup probes
 * - Composite health aggregation
 * - Periodic background checks
 * - Health history with degradation tracking
 * - Dependency health (DB, cache, external APIs)
 *
 * Pattern: Register → Check → Aggregate → Report → Alert
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  duration: number; // ms
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: number;
  uptime: number; // ms since start
}

export type HealthCheckFn = () => Promise<Omit<HealthCheckResult, "name" | "duration" | "timestamp">>;

export interface HealthCheckConfig {
  name: string;
  check: HealthCheckFn;
  timeout?: number;       // ms, default 5000
  critical?: boolean;     // if true, failure makes overall status unhealthy
  tags?: string[];
}

function aggregateStatus(results: HealthCheckResult[], configs: Map<string, HealthCheckConfig>): HealthStatus {
  if (results.length === 0) return "unknown";
  const statuses = results.map((r) => r.status);
  if (statuses.some((s) => s === "unhealthy")) {
    // Check if any critical check is unhealthy
    const criticalUnhealthy = results.some(
      (r) => r.status === "unhealthy" && configs.get(r.name)?.critical !== false
    );
    return criticalUnhealthy ? "unhealthy" : "degraded";
  }
  if (statuses.some((s) => s === "degraded")) return "degraded";
  if (statuses.every((s) => s === "healthy")) return "healthy";
  return "unknown";
}

export class HealthCheckSystem {
  private configs: Map<string, HealthCheckConfig> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private history: HealthCheckResult[] = [];
  private maxHistory = 100;
  private startTime = Date.now();
  private intervalId?: ReturnType<typeof setInterval>;
  private listeners: Array<(report: HealthReport) => void> = [];

  register(config: HealthCheckConfig): this {
    this.configs.set(config.name, config);
    return this;
  }

  unregister(name: string): this {
    this.configs.delete(name);
    this.lastResults.delete(name);
    return this;
  }

  async check(name: string): Promise<HealthCheckResult> {
    const config = this.configs.get(name);
    if (!config) throw new Error(`Health check not registered: ${name}`);

    const start = Date.now();
    const timeout = config.timeout ?? 5000;

    try {
      const partial = await Promise.race([
        config.check(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Health check timed out")), timeout)
        ),
      ]);

      const result: HealthCheckResult = {
        name,
        duration: Date.now() - start,
        timestamp: Date.now(),
        ...partial,
      };

      this.lastResults.set(name, result);
      this.addToHistory(result);
      return result;
    } catch (err) {
      const result: HealthCheckResult = {
        name,
        status: "unhealthy",
        message: String(err),
        duration: Date.now() - start,
        timestamp: Date.now(),
      };
      this.lastResults.set(name, result);
      this.addToHistory(result);
      return result;
    }
  }

  async checkAll(): Promise<HealthReport> {
    const results = await Promise.all(
      [...this.configs.keys()].map((name) => this.check(name))
    );

    const report: HealthReport = {
      status: aggregateStatus(results, this.configs),
      checks: results,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };

    for (const listener of this.listeners) listener(report);
    return report;
  }

  getLastResult(name: string): HealthCheckResult | undefined {
    return this.lastResults.get(name);
  }

  getLastReport(): HealthReport | null {
    if (this.lastResults.size === 0) return null;
    const checks = [...this.lastResults.values()];
    return {
      status: aggregateStatus(checks, this.configs),
      checks,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  getHistory(name?: string): HealthCheckResult[] {
    if (name) return this.history.filter((r) => r.name === name);
    return [...this.history];
  }

  startPeriodicChecks(intervalMs: number): this {
    this.stopPeriodicChecks();
    this.intervalId = setInterval(() => this.checkAll(), intervalMs);
    return this;
  }

  stopPeriodicChecks(): this {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    return this;
  }

  onReport(listener: (report: HealthReport) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  getStats(): { registered: number; healthy: number; degraded: number; unhealthy: number } {
    const results = [...this.lastResults.values()];
    return {
      registered: this.configs.size,
      healthy: results.filter((r) => r.status === "healthy").length,
      degraded: results.filter((r) => r.status === "degraded").length,
      unhealthy: results.filter((r) => r.status === "unhealthy").length,
    };
  }

  private addToHistory(result: HealthCheckResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) this.history.shift();
  }
}
