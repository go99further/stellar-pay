/**
 * Task Scheduler — cron-like periodic task execution
 *
 * Inspired by Plandex scheduled operations:
 * - Cron expression parsing (minute/hour/day/month/weekday)
 * - One-shot and recurring tasks
 * - Task lifecycle: scheduled → running → done/failed
 * - Missed-run detection
 * - Graceful shutdown
 */

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpr: string;
  fn: () => Promise<void> | void;
  lastRun?: number;
  nextRun: number;
  runCount: number;
  errorCount: number;
  enabled: boolean;
  once: boolean;
}

export interface SchedulerOptions {
  tickMs?: number;
  onError?: (err: unknown, task: ScheduledTask) => void;
}

function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  if (field === "*") {
    for (let i = min; i <= max; i++) result.add(i);
    return result;
  }
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const s = parseInt(step, 10);
      const start = range === "*" ? min : parseInt(range, 10);
      for (let i = start; i <= max; i += s) result.add(i);
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo; i <= hi; i++) result.add(i);
    } else {
      result.add(parseInt(part, 10));
    }
  }
  return result;
}

export function nextCronTime(cronExpr: string, after = Date.now()): number {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpr}`);
  const [minF, hourF, domF, monF, dowF] = parts;

  const minutes = parseCronField(minF, 0, 59);
  const hours = parseCronField(hourF, 0, 23);
  const doms = parseCronField(domF, 1, 31);
  const months = parseCronField(monF, 1, 12);
  const dows = parseCronField(dowF, 0, 6);

  // Start from next minute
  const d = new Date(after + 60000);
  d.setSeconds(0, 0);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    const mo = d.getMonth() + 1;
    const dom = d.getDate();
    const dow = d.getDay();
    const h = d.getHours();
    const m = d.getMinutes();

    if (months.has(mo) && doms.has(dom) && dows.has(dow) && hours.has(h) && minutes.has(m)) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new Error(`Could not find next run time for: ${cronExpr}`);
}

let _taskCounter = 0;

export class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private timer?: ReturnType<typeof setInterval>;
  private tickMs: number;
  private onError: (err: unknown, task: ScheduledTask) => void;
  private running = false;

  constructor(options: SchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? 1000;
    this.onError = options.onError ?? ((err, t) => console.error(`Scheduler error in ${t.name}:`, err));
  }

  schedule(name: string, cronExpr: string, fn: () => Promise<void> | void, once = false): string {
    const id = `task-${++_taskCounter}`;
    const task: ScheduledTask = {
      id, name, cronExpr, fn,
      nextRun: nextCronTime(cronExpr),
      runCount: 0, errorCount: 0,
      enabled: true, once,
    };
    this.tasks.set(id, task);
    return id;
  }

  scheduleOnce(name: string, cronExpr: string, fn: () => Promise<void> | void): string {
    return this.schedule(name, cronExpr, fn, true);
  }

  scheduleAt(name: string, runAt: number, fn: () => Promise<void> | void): string {
    const id = `task-${++_taskCounter}`;
    const task: ScheduledTask = {
      id, name, cronExpr: "@once",
      fn, nextRun: runAt,
      runCount: 0, errorCount: 0,
      enabled: true, once: true,
    };
    this.tasks.set(id, task);
    return id;
  }

  cancel(id: string): boolean {
    return this.tasks.delete(id);
  }

  enable(id: string): void { this.tasks.get(id) && (this.tasks.get(id)!.enabled = true); }
  disable(id: string): void { this.tasks.get(id) && (this.tasks.get(id)!.enabled = false); }

  getTask(id: string): ScheduledTask | undefined { return this.tasks.get(id); }
  getTasks(): ScheduledTask[] { return [...this.tasks.values()]; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (typeof this.timer === "object" && (this.timer as NodeJS.Timeout).unref) {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (!task.enabled || task.nextRun > now) continue;
      task.lastRun = now;
      task.runCount++;
      try {
        await task.fn();
      } catch (err) {
        task.errorCount++;
        this.onError(err, task);
      }
      if (task.once) {
        this.tasks.delete(task.id);
      } else {
        task.nextRun = nextCronTime(task.cronExpr, now);
      }
    }
  }
}
