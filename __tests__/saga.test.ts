import { describe, it, expect, vi } from "vitest";
import { Saga } from "../lib/agent/saga";

interface PaymentContext {
  orderId: string;
  reserved: boolean;
  charged: boolean;
  notified: boolean;
}

describe("Saga", () => {
  describe("happy path", () => {
    it("should execute all steps and return completed", async () => {
      const ctx: PaymentContext = { orderId: "o1", reserved: false, charged: false, notified: false };
      const result = await new Saga<PaymentContext>()
        .step({ name: "reserve", execute: (c) => { c.reserved = true; } })
        .step({ name: "charge", execute: (c) => { c.charged = true; } })
        .step({ name: "notify", execute: (c) => { c.notified = true; } })
        .execute(ctx);

      expect(result.status).toBe("completed");
      expect(ctx.reserved).toBe(true);
      expect(ctx.charged).toBe(true);
      expect(ctx.notified).toBe(true);
    });

    it("should log each step as executed", async () => {
      const ctx = {};
      const result = await new Saga()
        .step({ name: "step1", execute: () => {} })
        .step({ name: "step2", execute: () => {} })
        .execute(ctx);

      expect(result.log).toHaveLength(2);
      expect(result.log[0]).toMatchObject({ step: "step1", status: "executed" });
      expect(result.log[1]).toMatchObject({ step: "step2", status: "executed" });
    });

    it("should return context in result", async () => {
      const ctx = { value: 42 };
      const result = await new Saga<{ value: number }>()
        .step({ name: "noop", execute: () => {} })
        .execute(ctx);
      expect(result.context.value).toBe(42);
    });

    it("should handle async steps", async () => {
      const order: string[] = [];
      const ctx = {};
      await new Saga()
        .step({ name: "a", execute: async () => { await Promise.resolve(); order.push("a"); } })
        .step({ name: "b", execute: async () => { await Promise.resolve(); order.push("b"); } })
        .execute(ctx);
      expect(order).toEqual(["a", "b"]);
    });
  });

  describe("failure and compensation", () => {
    it("should return failed status when a step throws", async () => {
      const ctx = {};
      const result = await new Saga()
        .step({ name: "ok", execute: () => {} })
        .step({ name: "fail", execute: () => { throw new Error("payment declined"); } })
        .execute(ctx);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toBe("payment declined");
    });

    it("should compensate previously executed steps in reverse order", async () => {
      const order: string[] = [];
      const ctx: PaymentContext = { orderId: "o1", reserved: false, charged: false, notified: false };

      await new Saga<PaymentContext>()
        .step({
          name: "reserve",
          execute: (c) => { c.reserved = true; },
          compensate: () => order.push("unreserve"),
        })
        .step({
          name: "charge",
          execute: (c) => { c.charged = true; },
          compensate: () => order.push("refund"),
        })
        .step({
          name: "notify",
          execute: () => { throw new Error("notify failed"); },
          compensate: () => order.push("unnotify"),
        })
        .execute(ctx);

      expect(order).toEqual(["refund", "unreserve"]);
    });

    it("should log failed step", async () => {
      const ctx = {};
      const result = await new Saga()
        .step({ name: "boom", execute: () => { throw new Error("oops"); } })
        .execute(ctx);

      const failLog = result.log.find((l) => l.status === "failed");
      expect(failLog?.step).toBe("boom");
      expect(failLog?.error).toBe("oops");
    });

    it("should log compensated steps", async () => {
      const ctx = {};
      const result = await new Saga()
        .step({ name: "step1", execute: () => {}, compensate: () => {} })
        .step({ name: "step2", execute: () => { throw new Error("fail"); } })
        .execute(ctx);

      const compensated = result.log.filter((l) => l.status === "compensated");
      expect(compensated).toHaveLength(1);
      expect(compensated[0].step).toBe("step1");
    });

    it("should not compensate steps without compensate function", async () => {
      const compensate = vi.fn();
      const ctx = {};
      await new Saga()
        .step({ name: "step1", execute: () => {} }) // no compensate
        .step({ name: "step2", execute: () => {}, compensate })
        .step({ name: "step3", execute: () => { throw new Error("fail"); } })
        .execute(ctx);

      expect(compensate).toHaveBeenCalledTimes(1);
    });

    it("should not execute steps after failure", async () => {
      const step3 = vi.fn();
      const ctx = {};
      await new Saga()
        .step({ name: "step1", execute: () => {} })
        .step({ name: "step2", execute: () => { throw new Error("fail"); } })
        .step({ name: "step3", execute: step3 })
        .execute(ctx);

      expect(step3).not.toHaveBeenCalled();
    });
  });

  describe("retry", () => {
    it("should retry a failing step up to retries count", async () => {
      let attempts = 0;
      const ctx = {};
      const result = await new Saga()
        .step({
          name: "flaky",
          retries: 2,
          execute: () => {
            attempts++;
            if (attempts < 3) throw new Error("transient");
          },
        })
        .execute(ctx);

      expect(result.status).toBe("completed");
      expect(attempts).toBe(3);
    });

    it("should fail after exhausting retries", async () => {
      let attempts = 0;
      const ctx = {};
      const result = await new Saga()
        .step({
          name: "always-fail",
          retries: 2,
          execute: () => { attempts++; throw new Error("permanent"); },
        })
        .execute(ctx);

      expect(result.status).toBe("failed");
      expect(attempts).toBe(3); // 1 initial + 2 retries
    });
  });

  describe("empty saga", () => {
    it("should complete with no steps", async () => {
      const result = await new Saga().execute({});
      expect(result.status).toBe("completed");
      expect(result.log).toHaveLength(0);
    });
  });

  describe("compensation error tolerance", () => {
    it("should continue compensating even if one compensation throws", async () => {
      const order: string[] = [];
      const ctx = {};
      const result = await new Saga()
        .step({ name: "s1", execute: () => {}, compensate: () => order.push("comp-s1") })
        .step({ name: "s2", execute: () => {}, compensate: () => { throw new Error("comp-fail"); } })
        .step({ name: "s3", execute: () => { throw new Error("fail"); } })
        .execute(ctx);

      expect(result.status).toBe("failed");
      expect(order).toContain("comp-s1");
    });
  });
});
