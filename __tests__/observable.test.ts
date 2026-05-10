import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Observable,
  Subject,
  BehaviorSubject,
  ReplaySubject,
  of,
  from,
  interval,
  timer,
  merge,
  combineLatest,
} from "../lib/agent/types/observable";

describe("Observable", () => {
  describe("of / from", () => {
    it("should emit values synchronously with of()", () => {
      const results: number[] = [];
      of(1, 2, 3).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([1, 2, 3]);
    });

    it("should complete after emitting all values", () => {
      let completed = false;
      of(1, 2).subscribe({ complete: () => { completed = true; } });
      expect(completed).toBe(true);
    });

    it("should emit from iterable with from()", () => {
      const results: number[] = [];
      from([10, 20, 30]).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([10, 20, 30]);
    });

    it("should work with Set as iterable", () => {
      const results: string[] = [];
      from(new Set(["a", "b", "c"])).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual(["a", "b", "c"]);
    });
  });

  describe("map", () => {
    it("should transform values", () => {
      const results: number[] = [];
      of(1, 2, 3).map((x) => x * 2).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([2, 4, 6]);
    });

    it("should chain multiple maps", () => {
      const results: string[] = [];
      of(1, 2, 3)
        .map((x) => x * 10)
        .map((x) => `$${x}`)
        .subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual(["$10", "$20", "$30"]);
    });
  });

  describe("filter", () => {
    it("should only emit matching values", () => {
      const results: number[] = [];
      of(1, 2, 3, 4, 5).filter((x) => x % 2 === 0).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([2, 4]);
    });
  });

  describe("take", () => {
    it("should take only N values", () => {
      const results: number[] = [];
      of(1, 2, 3, 4, 5).take(3).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([1, 2, 3]);
    });

    it("should complete after N values", () => {
      let completed = false;
      of(1, 2, 3, 4).take(2).subscribe({ complete: () => { completed = true; } });
      expect(completed).toBe(true);
    });
  });

  describe("skip", () => {
    it("should skip first N values", () => {
      const results: number[] = [];
      of(1, 2, 3, 4, 5).skip(2).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([3, 4, 5]);
    });
  });

  describe("distinctUntilChanged", () => {
    it("should suppress consecutive duplicates", () => {
      const results: number[] = [];
      of(1, 1, 2, 2, 3, 1).distinctUntilChanged().subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([1, 2, 3, 1]);
    });

    it("should support custom equality", () => {
      const results: { id: number }[] = [];
      of({ id: 1 }, { id: 1 }, { id: 2 })
        .distinctUntilChanged((a, b) => a.id === b.id)
        .subscribe({ next: (v) => results.push(v) });
      expect(results.map((r) => r.id)).toEqual([1, 2]);
    });
  });

  describe("reduce", () => {
    it("should accumulate and emit on complete", () => {
      const results: number[] = [];
      of(1, 2, 3, 4).reduce((acc, v) => acc + v, 0).subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([10]);
    });
  });

  describe("toArray", () => {
    it("should collect all values into an array", () => {
      const results: number[][] = [];
      of(1, 2, 3).toArray().subscribe({ next: (v) => results.push(v) });
      expect(results).toEqual([[1, 2, 3]]);
    });
  });

  describe("unsubscribe", () => {
    it("should stop receiving values after unsubscribe", () => {
      const subject = new Subject<number>();
      const results: number[] = [];
      const unsub = subject.subscribe({ next: (v) => results.push(v) });

      subject.next(1);
      unsub();
      subject.next(2);

      expect(results).toEqual([1]);
    });
  });

  describe("catchError", () => {
    it("should recover from error with fallback observable", () => {
      const results: number[] = [];
      const errors: unknown[] = [];

      new Observable<number>((obs) => {
        obs.next(1);
        obs.error?.("boom");
      })
        .catchError(() => of(99))
        .subscribe({ next: (v) => results.push(v), error: (e) => errors.push(e) });

      expect(results).toEqual([1, 99]);
      expect(errors).toEqual([]);
    });
  });

  describe("retry", () => {
    it("should retry on error up to N times", () => {
      let attempts = 0;
      const results: number[] = [];
      const errors: unknown[] = [];

      new Observable<number>((obs) => {
        attempts++;
        obs.next(attempts);
        obs.error?.("fail");
      })
        .retry(2)
        .subscribe({ next: (v) => results.push(v), error: (e) => errors.push(e) });

      expect(attempts).toBe(3); // initial + 2 retries
      expect(results).toEqual([1, 2, 3]);
      expect(errors).toEqual(["fail"]);
    });
  });

  describe("debounce", () => {
    it("should debounce rapid emissions", async () => {
      const subject = new Subject<number>();
      const results: number[] = [];
      subject.debounce(20).subscribe({ next: (v) => results.push(v) });

      subject.next(1);
      subject.next(2);
      subject.next(3);

      await new Promise((r) => setTimeout(r, 40));
      expect(results).toEqual([3]);
    });
  });

  describe("throttle", () => {
    it("should throttle emissions", async () => {
      const subject = new Subject<number>();
      const results: number[] = [];
      subject.throttle(30).subscribe({ next: (v) => results.push(v) });

      subject.next(1);
      subject.next(2); // throttled
      await new Promise((r) => setTimeout(r, 40));
      subject.next(3);

      expect(results).toContain(1);
      expect(results).toContain(3);
      expect(results).not.toContain(2);
    });
  });

  describe("timer", () => {
    it("should emit once after delay", async () => {
      const results: number[] = [];
      timer(20).subscribe({ next: (v) => results.push(v) });
      await new Promise((r) => setTimeout(r, 40));
      expect(results).toEqual([0]);
    });
  });

  describe("interval", () => {
    it("should emit incrementing values", async () => {
      const results: number[] = [];
      const unsub = interval(10).take(3).subscribe({ next: (v) => results.push(v) });
      await new Promise((r) => setTimeout(r, 60));
      unsub();
      expect(results).toEqual([0, 1, 2]);
    });
  });

  describe("merge", () => {
    it("should merge multiple observables", () => {
      const results: number[] = [];
      merge(of(1, 2), of(3, 4)).subscribe({ next: (v) => results.push(v) });
      expect(results.sort()).toEqual([1, 2, 3, 4]);
    });

    it("should complete when all sources complete", () => {
      let completed = false;
      merge(of(1), of(2)).subscribe({ complete: () => { completed = true; } });
      expect(completed).toBe(true);
    });
  });

  describe("combineLatest", () => {
    it("should emit when all sources have emitted", () => {
      const results: [number, string][] = [];
      const a = new Subject<number>();
      const b = new Subject<string>();

      combineLatest<[number, string]>([a, b]).subscribe({ next: (v) => results.push(v) });

      a.next(1);
      expect(results).toEqual([]); // b hasn't emitted yet
      b.next("x");
      expect(results).toEqual([[1, "x"]]);
      a.next(2);
      expect(results).toEqual([[1, "x"], [2, "x"]]);
    });
  });
});

describe("Subject", () => {
  it("should multicast to multiple subscribers", () => {
    const subject = new Subject<number>();
    const r1: number[] = [];
    const r2: number[] = [];

    subject.subscribe({ next: (v) => r1.push(v) });
    subject.subscribe({ next: (v) => r2.push(v) });

    subject.next(42);
    expect(r1).toEqual([42]);
    expect(r2).toEqual([42]);
  });

  it("should track observer count", () => {
    const subject = new Subject<number>();
    const unsub = subject.subscribe({ next: () => {} });
    expect(subject.observerCount).toBe(1);
    unsub();
    expect(subject.observerCount).toBe(0);
  });

  it("should not emit after complete", () => {
    const subject = new Subject<number>();
    const results: number[] = [];
    subject.subscribe({ next: (v) => results.push(v) });

    subject.next(1);
    subject.complete();
    subject.next(2); // should be ignored

    expect(results).toEqual([1]);
    expect(subject.closed).toBe(true);
  });

  it("should propagate errors to subscribers", () => {
    const subject = new Subject<number>();
    const errors: unknown[] = [];
    subject.subscribe({ error: (e) => errors.push(e) });
    subject.error("oops");
    expect(errors).toEqual(["oops"]);
  });
});

describe("BehaviorSubject", () => {
  it("should replay current value to new subscriber", () => {
    const bs = new BehaviorSubject(10);
    const results: number[] = [];
    bs.subscribe({ next: (v) => results.push(v) });
    expect(results).toEqual([10]);
  });

  it("should update value on next()", () => {
    const bs = new BehaviorSubject(0);
    bs.next(5);
    expect(bs.value).toBe(5);
  });

  it("should emit new value to existing subscribers", () => {
    const bs = new BehaviorSubject(0);
    const results: number[] = [];
    bs.subscribe({ next: (v) => results.push(v) });
    bs.next(1);
    bs.next(2);
    expect(results).toEqual([0, 1, 2]);
  });

  it("should give late subscriber the latest value", () => {
    const bs = new BehaviorSubject(0);
    bs.next(7);
    const results: number[] = [];
    bs.subscribe({ next: (v) => results.push(v) });
    expect(results).toEqual([7]);
  });
});

describe("ReplaySubject", () => {
  it("should replay buffered values to new subscriber", () => {
    const rs = new ReplaySubject<number>(3);
    rs.next(1);
    rs.next(2);
    rs.next(3);

    const results: number[] = [];
    rs.subscribe({ next: (v) => results.push(v) });
    expect(results).toEqual([1, 2, 3]);
  });

  it("should respect buffer size", () => {
    const rs = new ReplaySubject<number>(2);
    rs.next(1);
    rs.next(2);
    rs.next(3); // evicts 1

    const results: number[] = [];
    rs.subscribe({ next: (v) => results.push(v) });
    expect(results).toEqual([2, 3]);
  });

  it("should continue emitting to existing subscribers", () => {
    const rs = new ReplaySubject<number>(2);
    const results: number[] = [];
    rs.subscribe({ next: (v) => results.push(v) });
    rs.next(10);
    rs.next(20);
    expect(results).toEqual([10, 20]);
  });
});

describe("Observable — pipe operator", () => {
  it("should apply a custom operator via pipe()", () => {
    const double = (obs: Observable<number>) => obs.map((x) => x * 2);
    const results: number[] = [];
    of(1, 2, 3).pipe(double).subscribe({ next: (v) => results.push(v) });
    expect(results).toEqual([2, 4, 6]);
  });
});

describe("Observable — error handling", () => {
  it("should call error observer on error", () => {
    const errors: unknown[] = [];
    new Observable<number>((obs) => {
      obs.next(1);
      obs.error(new Error("boom"));
    }).subscribe({ error: (e) => errors.push(e) });
    expect(errors).toHaveLength(1);
  });
});

describe("Subject — error closes subject", () => {
  it("should mark subject as closed after error", () => {
    const s = new Subject<number>();
    s.error(new Error("fail"));
    expect(s.closed).toBe(true);
  });
});

describe("BehaviorSubject — complete", () => {
  it("should stop emitting after complete", () => {
    const bs = new BehaviorSubject(0);
    const results: number[] = [];
    bs.subscribe({ next: (v) => results.push(v) });
    bs.next(1);
    bs.complete();
    bs.next(2);
    expect(results).toEqual([0, 1]);
  });
});
