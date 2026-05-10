import { describe, it, expect } from "vitest";
import { spec, allOf, anyOf, SpecificationEvaluator } from "../lib/agent/specification";

interface Order {
  amount: number;
  currency: string;
  userId: string;
  verified: boolean;
}

const minAmount = spec<Order>(
  "MinAmount",
  (o) => o.amount >= 10,
  (o) => `Amount ${o.amount} is below minimum of 10`
);

const maxAmount = spec<Order>(
  "MaxAmount",
  (o) => o.amount <= 10000,
  (o) => `Amount ${o.amount} exceeds maximum of 10000`
);

const validCurrency = spec<Order>(
  "ValidCurrency",
  (o) => ["USD", "EUR", "XLM"].includes(o.currency),
  (o) => `Currency ${o.currency} is not supported`
);

const isVerified = spec<Order>(
  "IsVerified",
  (o) => o.verified,
  () => "User is not verified"
);

const hasUserId = spec<Order>(
  "HasUserId",
  (o) => o.userId.length > 0,
  () => "User ID is required"
);

const validOrder: Order = { amount: 100, currency: "USD", userId: "user1", verified: true };

describe("Specification", () => {
  describe("basic spec", () => {
    it("should return true when predicate passes", () => {
      expect(minAmount.isSatisfiedBy(validOrder)).toBe(true);
    });

    it("should return false when predicate fails", () => {
      expect(minAmount.isSatisfiedBy({ ...validOrder, amount: 5 })).toBe(false);
    });

    it("should return empty violations when satisfied", () => {
      expect(minAmount.explain(validOrder)).toEqual([]);
    });

    it("should return explanation when not satisfied", () => {
      const violations = minAmount.explain({ ...validOrder, amount: 5 });
      expect(violations[0]).toMatch(/below minimum/);
    });

    it("should use default explanation when none provided", () => {
      const s = spec<number>("positive", (n) => n > 0);
      const violations = s.explain(-1);
      expect(violations[0]).toMatch(/positive.*not satisfied/i);
    });
  });

  describe("AND composition", () => {
    it("should pass when both specs pass", () => {
      const combined = minAmount.and(maxAmount);
      expect(combined.isSatisfiedBy(validOrder)).toBe(true);
    });

    it("should fail when left spec fails", () => {
      const combined = minAmount.and(maxAmount);
      expect(combined.isSatisfiedBy({ ...validOrder, amount: 5 })).toBe(false);
    });

    it("should fail when right spec fails", () => {
      const combined = minAmount.and(maxAmount);
      expect(combined.isSatisfiedBy({ ...validOrder, amount: 99999 })).toBe(false);
    });

    it("should collect violations from both sides", () => {
      const combined = minAmount.and(validCurrency);
      const violations = combined.explain({ ...validOrder, amount: 5, currency: "BTC" });
      expect(violations).toHaveLength(2);
    });

    it("should have descriptive name", () => {
      const combined = minAmount.and(maxAmount);
      expect(combined.name).toContain("AND");
      expect(combined.name).toContain("MinAmount");
      expect(combined.name).toContain("MaxAmount");
    });
  });

  describe("OR composition", () => {
    it("should pass when either spec passes", () => {
      const usdOrEur = spec<Order>("USD", (o) => o.currency === "USD")
        .or(spec<Order>("EUR", (o) => o.currency === "EUR"));
      expect(usdOrEur.isSatisfiedBy(validOrder)).toBe(true);
      expect(usdOrEur.isSatisfiedBy({ ...validOrder, currency: "EUR" })).toBe(true);
    });

    it("should fail when neither spec passes", () => {
      const usdOrEur = spec<Order>("USD", (o) => o.currency === "USD")
        .or(spec<Order>("EUR", (o) => o.currency === "EUR"));
      expect(usdOrEur.isSatisfiedBy({ ...validOrder, currency: "XLM" })).toBe(false);
    });

    it("should return no violations when satisfied", () => {
      const s = spec<number>("pos", (n) => n > 0).or(spec<number>("zero", (n) => n === 0));
      expect(s.explain(0)).toEqual([]);
    });

    it("should collect violations from both when neither passes", () => {
      const s = spec<number>("pos", (n) => n > 0).or(spec<number>("zero", (n) => n === 0));
      const violations = s.explain(-1);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe("NOT composition", () => {
    it("should invert a passing spec", () => {
      const notVerified = isVerified.not();
      expect(notVerified.isSatisfiedBy(validOrder)).toBe(false);
      expect(notVerified.isSatisfiedBy({ ...validOrder, verified: false })).toBe(true);
    });

    it("should have descriptive name", () => {
      expect(isVerified.not().name).toContain("NOT");
      expect(isVerified.not().name).toContain("IsVerified");
    });

    it("should return violation when not satisfied", () => {
      const notVerified = isVerified.not();
      const violations = notVerified.explain(validOrder);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe("allOf()", () => {
    it("should pass when all specs pass", () => {
      const all = allOf(minAmount, maxAmount, validCurrency, isVerified, hasUserId);
      expect(all.isSatisfiedBy(validOrder)).toBe(true);
    });

    it("should fail when any spec fails", () => {
      const all = allOf(minAmount, maxAmount, validCurrency);
      expect(all.isSatisfiedBy({ ...validOrder, currency: "BTC" })).toBe(false);
    });

    it("should collect all violations", () => {
      const all = allOf(minAmount, validCurrency, isVerified);
      const violations = all.explain({ ...validOrder, amount: 1, currency: "BTC", verified: false });
      expect(violations.length).toBe(3);
    });
  });

  describe("anyOf()", () => {
    it("should pass when at least one spec passes", () => {
      const any = anyOf(
        spec<Order>("tiny", (o) => o.amount < 5),
        spec<Order>("normal", (o) => o.amount >= 10)
      );
      expect(any.isSatisfiedBy(validOrder)).toBe(true);
    });

    it("should fail when none pass", () => {
      const any = anyOf(
        spec<Order>("tiny", (o) => o.amount < 5),
        spec<Order>("huge", (o) => o.amount > 10000)
      );
      expect(any.isSatisfiedBy(validOrder)).toBe(false);
    });
  });

  describe("complex composition", () => {
    it("should support nested and/or/not", () => {
      const validAmount = minAmount.and(maxAmount);
      const acceptedCurrency = validCurrency;
      const fullSpec = validAmount.and(acceptedCurrency).and(isVerified);

      expect(fullSpec.isSatisfiedBy(validOrder)).toBe(true);
      expect(fullSpec.isSatisfiedBy({ ...validOrder, amount: 1 })).toBe(false);
      expect(fullSpec.isSatisfiedBy({ ...validOrder, currency: "BTC" })).toBe(false);
      expect(fullSpec.isSatisfiedBy({ ...validOrder, verified: false })).toBe(false);
    });
  });
});

describe("SpecificationEvaluator", () => {
  it("should return valid when all specs pass", () => {
    const evaluator = new SpecificationEvaluator<Order>()
      .add(minAmount)
      .add(maxAmount)
      .add(validCurrency)
      .add(isVerified);

    const result = evaluator.evaluate(validOrder);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("should collect all violations", () => {
    const evaluator = new SpecificationEvaluator<Order>()
      .add(minAmount)
      .add(validCurrency)
      .add(isVerified);

    const result = evaluator.evaluate({ ...validOrder, amount: 1, currency: "BTC", verified: false });
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(3);
  });

  it("should return invalid with specific messages", () => {
    const evaluator = new SpecificationEvaluator<Order>().add(minAmount);
    const result = evaluator.evaluate({ ...validOrder, amount: 1 });
    expect(result.violations[0]).toMatch(/below minimum/);
  });
});
