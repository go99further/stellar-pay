/**
 * Task Scheduler
 *
 * Inspired by production job scheduling patterns (cron/Bull/Celery):
 * - Cron-like recurring tasks
 * - One-shot delayed tasks
 * - Priority queues
 * - Task dependencies (run B after A)
 * - Retry with backoff
 * - Task history and observability
 *
 * Pattern: Schedule → Queue → Execute → Retry → Report
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";
export type TaskPriority = "low" | "normal" | "high" | "critical";

export interface TaskDefinition<T = unknown> {
  id: string;
  name: string;
  handler: () => Promise<T>;
  priority: TaskPriority;
  runAt?: number;          // epoch ms, undefined = run immediately
  cronExpression?: string; // simplified: "*/5m", "*/1h", "*/1d"
  maxRetries: number;
  retryDelay: number;      // ms base delay (exponential backoff)
  timeout: number;         // ms, 0 = no timeout
  dependencies?: string[]; // task IDs that must complete first
  tags: string[];
}

export interface TaskRecord<T = unknown> {
  definition: TaskDefinition<T>;
  status: TaskStatus;
  attempts: number;
  result?: T;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  nextRunAt?: number;      // for recurring tasks
}

export interface SchedulerStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Task Scheduler
 * Manages scheduled, recurring, and dependency-ordered tasks
 */
export class TaskScheduler {
  private tasks: Map<string, TaskRecord> = new Map();
  private running: Set<string> = new Set();
  private maxConcurrent: number;
  private tickInterval: NodeJS.Timeout | null = null;
  private tickMs: number;

  constructor(options: { maxConcurrent?: number; tickMs?: number } = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 5;
    this.tickMs = options.tickMs ?? 1000;
  }

  /**
   * Start the scheduler tick loop
   */
  start(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => void this.tick(), this.tickMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Schedule a task
   */
  schedule<T>(definition: Omit<TaskDefinition<T>, "id"> & { id?: string }): string {
    const id = definition.id ?? `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fullDef: TaskDefinition<T> = {
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 30000,
      priority: "normal",
      tags: [],
      ...definition,
      id,
    };

    this.tasks.set(id, {
      definition: fullDef as TaskDefinition,
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
      nextRunAt: fullDef.runAt ?? Date.now(),
    });

    return id;
  }

  /**
   * Schedule a one-shot delayed task
   */
  delay<T>(name: string, handler: () => Promise<T>, delayMs: number, priority: TaskPriority = "normal"): string {
    return this.schedule({ name, handler, runAt: Date.now() + delayMs, priority });
  }

  /**
   * Cancel a pending task
   */
  cancel(id: string): boolean {
    const record = this.tasks.get(id);
    if (!record || record.status !== "pending") return false;
    record.status = "cancelled";
    return true;
  }

  /**
   * Get a task record
   */
  getTask(id: string): TaskRecord | null {
    return this.tasks.get(id) ?? null;
  }

  /**
   * Wait for a task to complete
   */
  async waitFor(id: string, timeoutMs = 10000): Promise<TaskRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const record = this.tasks.get(id);
      if (!record) throw new Error(`Task ${id} not found`);
      if (record.status === "completed" || record.status === "failed" || record.status === "cancelled") {
        return record;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Task ${id} timed out after ${timeoutMs}ms`);
  }

  /**
   * Run a task immediately (bypasses scheduler tick)
   */
  async runNow(id: string): Promise<TaskRecord> {
    const record = this.tasks.get(id);
    if (!record) throw new Error(`Task ${id} not found`);
    await this.executeTask(record);
    return record;
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    const counts: SchedulerStats = { total: 0, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const record of this.tasks.values()) {
      counts.total++;
      if (record.status in counts) {
        (counts as Record<string, number>)[record.status]++;
      }
    }
    return counts;
  }

  /**
   * Get tasks by status
   */
  getByStatus(status: TaskStatus): TaskRecord[] {
    return Array.from(this.tasks.values()).filter((r) => r.status === status);
  }

  /**
   * Get tasks by tag
   */
  getByTag(tag: string): TaskRecord[] {
    return Array.from(this.tasks.values()).filter((r) => r.definition.tags.includes(tag));
  }

  /**
   * Scheduler tick — finds and executes ready tasks
   */
  async tick(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) return;

    const ready = this.getReadyTasks();
    const slots = this.maxConcurrent - this.running.size;
    const toRun = ready.slice(0, slots);

    await Promise.all(toRun.map((r) => this.executeTask(r)));
  }

  private getReadyTasks(): TaskRecord[] {
    const now = Date.now();
    return Array.from(this.tasks.values())
      .filter((r) => {
        if (r.status !== "pending") return false;
        if (this.running.has(r.definition.id)) return false;
        if ((r.nextRunAt ?? 0) > now) return false;
        if (r.definition.dependencies?.some((depId) => {
          const dep = this.tasks.get(depId);
          return !dep || dep.status !== "completed";
        })) return false;
        return true;
      })
      .sort((a, b) =>
        PRIORITY_ORDER[b.definition.priority] - PRIORITY_ORDER[a.definition.priority]
      );
  }

  private async executeTask(record: TaskRecord): Promise<void> {
    const { definition } = record;
    this.running.add(definition.id);
    record.status = "running";
    record.startedAt = Date.now();
    record.attempts++;

    try {
      let result: unknown;

      if (definition.timeout > 0) {
        result = await Promise.race([
          definition.handler(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Task timeout after ${definition.timeout}ms`)), definition.timeout)
          ),
        ]);
      } else {
        result = await definition.handler();
      }

      record.result = result;
      record.status = "completed";
      record.completedAt = Date.now();

      // Schedule next run for recurring tasks
      if (definition.cronExpression) {
        record.status = "pending";
        record.nextRunAt = this.nextCronRun(definition.cronExpression);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      record.error = errorMsg;

      if (record.attempts <= definition.maxRetries) {
        // Exponential backoff retry
        const delay = definition.retryDelay * Math.pow(2, record.attempts - 1);
        record.status = "pending";
        record.nextRunAt = Date.now() + delay;
      } else {
        record.status = "failed";
        record.completedAt = Date.now();
      }
    } finally {
      this.running.delete(definition.id);
    }
  }

  private nextCronRun(expression: string): number {
    const match = expression.match(/^\*\/(\d+)(m|h|d)$/);
    if (!match) return Date.now() + 60000;
    const value = parseInt(match[1]);
    const unit = match[2];
    const ms = unit === "m" ? value * 60000 : unit === "h" ? value * 3600000 : value * 86400000;
    return Date.now() + ms;
  }
}
