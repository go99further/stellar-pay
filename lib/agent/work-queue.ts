/**
 * Work Queue — durable async job processing
 *
 * Inspired by Plandex operation queue + SWE-agent task scheduling:
 * - Priority-based job ordering
 * - Concurrency control (worker pool)
 * - Job lifecycle: pending → running → done/failed
 * - Retry with backoff
 * - Dead letter queue for exhausted jobs
 * - Job cancellation
 */

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface Job<T = unknown> {
  id: string;
  payload: T;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledAt: number;
  error?: string;
}

export interface WorkQueueOptions<T> {
  concurrency?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  onDead?: (job: Job<T>) => void;
}

let _idCounter = 0;
function nextId(): string { return `job-${++_idCounter}`; }

export class WorkQueue<T = unknown> {
  private pending: Job<T>[] = [];
  private running = new Map<string, Job<T>>();
  private done: Job<T>[] = [];
  private dead: Job<T>[] = [];
  private concurrency: number;
  private maxAttempts: number;
  private baseDelayMs: number;
  private onDead?: (job: Job<T>) => void;
  private processor?: (payload: T) => Promise<void>;
  private processing = false;

  constructor(options: WorkQueueOptions<T> = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 0;
    this.onDead = options.onDead;
  }

  enqueue(payload: T, options: { priority?: number; maxAttempts?: number } = {}): Job<T> {
    const job: Job<T> = {
      id: nextId(),
      payload,
      priority: options.priority ?? 0,
      status: "pending",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.maxAttempts,
      createdAt: Date.now(),
      scheduledAt: Date.now(),
    };
    this.insertByPriority(job);
    return job;
  }

  cancel(jobId: string): boolean {
    const idx = this.pending.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const [job] = this.pending.splice(idx, 1);
    job.status = "cancelled";
    this.done.push(job);
    return true;
  }

  process(processor: (payload: T) => Promise<void>): void {
    this.processor = processor;
    this.tick();
  }

  async drain(): Promise<void> {
    if (!this.processor) throw new Error("No processor registered");
    while (this.pending.length > 0 || this.running.size > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  get pendingCount(): number { return this.pending.length; }
  get runningCount(): number { return this.running.size; }
  get doneCount(): number { return this.done.length; }
  get deadCount(): number { return this.dead.length; }

  getJob(id: string): Job<T> | undefined {
    return (
      this.pending.find((j) => j.id === id) ??
      this.running.get(id) ??
      this.done.find((j) => j.id === id) ??
      this.dead.find((j) => j.id === id)
    );
  }

  getDeadLetters(): Job<T>[] { return [...this.dead]; }

  clear(): void {
    this.pending = [];
    this.running.clear();
    this.done = [];
    this.dead = [];
  }

  private tick(): void {
    if (this.processing) return;
    this.processing = true;
    Promise.resolve().then(() => {
      this.processing = false;
      this.startWorkers();
    });
  }

  private startWorkers(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      const now = Date.now();
      if (job.scheduledAt > now) {
        this.pending.unshift(job);
        break;
      }
      this.runJob(job);
    }
  }

  private runJob(job: Job<T>): void {
    job.status = "running";
    job.attempts++;
    this.running.set(job.id, job);

    this.processor!(job.payload).then(() => {
      job.status = "done";
      this.running.delete(job.id);
      this.done.push(job);
      this.startWorkers();
    }).catch((err) => {
      this.running.delete(job.id);
      job.error = err instanceof Error ? err.message : String(err);

      if (job.attempts >= job.maxAttempts) {
        job.status = "failed";
        this.dead.push(job);
        this.onDead?.(job);
      } else {
        job.status = "pending";
        const delay = this.baseDelayMs * Math.pow(2, job.attempts - 1);
        job.scheduledAt = Date.now() + delay;
        this.insertByPriority(job);
      }
      this.startWorkers();
    });
  }

  private insertByPriority(job: Job<T>): void {
    let i = 0;
    while (i < this.pending.length && this.pending[i].priority >= job.priority) i++;
    this.pending.splice(i, 0, job);
  }
}
