import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scheduler, nextCronTime } from "../lib/agent/scheduler";

describe("nextCronTime", () => {
  it("should return next minute for * * * * *", () => {
    const now = new Date("2024-01-15T10:30:00.000Z").getTime();
    const next = nextCronTime("* * * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(31);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("should find next matching minute", () => {
    const now = new Date("2024-01-15T10:30:00.000Z").getTime();
    const next = nextCronTime("45 * * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(45);
  });

  it("should advance to next hour if minute already passed", () => {
    const now = new Date("2024-01-15T10:50:00.000Z").getTime();
    const next = nextCronTime("30 * * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCHours()).toBe(11);
  });

  it("should handle step expressions", () => {
    const now = new Date("2024-01-15T10:00:00.000Z").getTime();
    const next = nextCronTime("*/15 * * * *", now);
    const d = new Date(next);
    expect(d.getUTCMinutes()).toBe(15);
  });

  it("should throw for invalid cron expression", () => {
    expect(() => nextCronTime("* * *")).toThrow("Invalid cron expression");
  });
});

describe("Scheduler", () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler({ tickMs: 50 });
  });

  describe("scheduleAt / tick", () => {
    it("should run a task when its time arrives", async () => {
      const fn = vi.fn();
      scheduler.scheduleAt("test", Date.now() - 1, fn);
      await scheduler.tick();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should not run a task before its time", async () => {
      const fn = vi.fn();
      scheduler.scheduleAt("future", Date.now() + 60000, fn);
      await scheduler.tick();
      expect(fn).not.toHaveBeenCalled();
    });

    it("should remove once task after running", async () => {
      const fn = vi.fn();
      const id = scheduler.scheduleAt("once", Date.now() - 1, fn);
      await scheduler.tick();
      expect(scheduler.getTask(id)).toBeUndefined();
    });

    it("should track runCount", async () => {
      const id = scheduler.scheduleAt("task", Date.now() - 1, vi.fn());
      // Task is once, so it runs once and is removed
      await scheduler.tick();
      // Task is gone after once run
      expect(scheduler.getTask(id)).toBeUndefined();
    });
  });

  describe("schedule (recurring)", () => {
    it("should keep recurring task after running", async () => {
      const fn = vi.fn();
      const id = scheduler.schedule("recurring", "* * * * *", fn);
      const task = scheduler.getTask(id)!;
      // Force nextRun to past
      task.nextRun = Date.now() - 1;
      await scheduler.tick();
      expect(scheduler.getTask(id)).toBeDefined();
    });

    it("should update nextRun after execution", async () => {
      const id = scheduler.schedule("recurring", "* * * * *", vi.fn());
      const task = scheduler.getTask(id)!;
      task.nextRun = Date.now() - 1;
      const before = task.nextRun;
      await scheduler.tick();
      expect(task.nextRun).toBeGreaterThan(before);
    });
  });

  describe("cancel", () => {
    it("should cancel a scheduled task", async () => {
      const fn = vi.fn();
      const id = scheduler.scheduleAt("task", Date.now() - 1, fn);
      scheduler.cancel(id);
      await scheduler.tick();
      expect(fn).not.toHaveBeenCalled();
    });

    it("should return true when task existed", () => {
      const id = scheduler.scheduleAt("task", Date.now() + 1000, vi.fn());
      expect(scheduler.cancel(id)).toBe(true);
    });

    it("should return false for unknown task", () => {
      expect(scheduler.cancel("nonexistent")).toBe(false);
    });
  });

  describe("enable / disable", () => {
    it("should not run disabled task", async () => {
      const fn = vi.fn();
      const id = scheduler.scheduleAt("task", Date.now() - 1, fn);
      scheduler.disable(id);
      await scheduler.tick();
      expect(fn).not.toHaveBeenCalled();
    });

    it("should run re-enabled task", async () => {
      const fn = vi.fn();
      const id = scheduler.scheduleAt("task", Date.now() - 1, fn);
      scheduler.disable(id);
      scheduler.enable(id);
      await scheduler.tick();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should call onError when task throws", async () => {
      const errors: unknown[] = [];
      const s = new Scheduler({ onError: (err) => errors.push(err) });
      s.scheduleAt("boom", Date.now() - 1, () => { throw new Error("task failed"); });
      await s.tick();
      expect(errors).toHaveLength(1);
    });

    it("should track errorCount", async () => {
      const s = new Scheduler({ onError: () => {} });
      const id = s.schedule("err", "* * * * *", () => { throw new Error("fail"); });
      const task = s.getTask(id)!;
      task.nextRun = Date.now() - 1;
      await s.tick();
      expect(task.errorCount).toBe(1);
    });

    it("should continue running other tasks after one fails", async () => {
      const s = new Scheduler({ onError: () => {} });
      const fn2 = vi.fn();
      s.scheduleAt("fail", Date.now() - 1, () => { throw new Error("fail"); });
      s.scheduleAt("ok", Date.now() - 1, fn2);
      await s.tick();
      expect(fn2).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTasks", () => {
    it("should return all scheduled tasks", () => {
      scheduler.scheduleAt("a", Date.now() + 1000, vi.fn());
      scheduler.scheduleAt("b", Date.now() + 2000, vi.fn());
      expect(scheduler.getTasks()).toHaveLength(2);
    });
  });

  describe("start / stop", () => {
    it("should not throw on start/stop", () => {
      expect(() => { scheduler.start(); scheduler.stop(); }).not.toThrow();
    });

    it("should not start twice", () => {
      scheduler.start();
      scheduler.start(); // second call is no-op
      scheduler.stop();
    });
  });

  describe("scheduleOnce", () => {
    it("should run once and be removed", async () => {
      const fn = vi.fn();
      const id = scheduler.scheduleOnce("once-cron", "* * * * *", fn);
      const task = scheduler.getTask(id)!;
      task.nextRun = Date.now() - 1;
      await scheduler.tick();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(scheduler.getTask(id)).toBeUndefined();
    });
  });

  describe("runCount tracking", () => {
    it("should increment runCount on each execution", async () => {
      const id = scheduler.schedule("counter", "* * * * *", vi.fn());
      const task = scheduler.getTask(id)!;
      task.nextRun = Date.now() - 1;
      await scheduler.tick();
      task.nextRun = Date.now() - 1;
      await scheduler.tick();
      expect(task.runCount).toBe(2);
    });
  });

  describe("nextCronTime — additional cases", () => {
    it("should handle comma-separated minutes", () => {
      const now = new Date("2024-01-15T10:10:00.000Z").getTime();
      const next = nextCronTime("15,45 * * * *", now);
      const d = new Date(next);
      expect(d.getMinutes()).toBe(15);
    });

    it("should handle specific hour (local time)", () => {
      // Use a time where local hour is known: pick a time 2 hours before midnight local
      const base = new Date();
      base.setHours(0, 0, 0, 0); // midnight local today
      const targetHour = 2;
      base.setHours(targetHour - 1, 50, 0, 0); // 1h50 local — next match at 2:00
      const next = nextCronTime(`0 ${targetHour} * * *`, base.getTime());
      const d = new Date(next);
      expect(d.getHours()).toBe(targetHour);
      expect(d.getMinutes()).toBe(0);
    });
  });
});
