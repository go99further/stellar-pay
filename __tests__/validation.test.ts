import { describe, it, expect } from "vitest";

/**
 * Test the SendPayment validation logic (extracted from component)
 */
describe("SendPayment Validation", () => {
  function isValidAddress(addr: string): boolean {
    return addr.length === 0 || (addr.startsWith("G") && addr.length === 56);
  }

  function isValidAmount(amount: string): boolean {
    return amount.length === 0 || (parseFloat(amount) > 0 && !isNaN(parseFloat(amount)));
  }

  function calculateMax(balance: string): string {
    const max = Math.max(0, parseFloat(balance) - 1);
    return max.toFixed(7);
  }

  it("validates correct Stellar addresses", () => {
    const validAddr = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
    expect(isValidAddress(validAddr)).toBe(true);
    expect(isValidAddress("")).toBe(true); // empty is valid (not yet entered)
  });

  it("rejects invalid Stellar addresses", () => {
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("GABC")).toBe(false); // too short
    expect(isValidAddress("X" + "A".repeat(55))).toBe(false); // wrong prefix
  });

  it("validates amounts correctly", () => {
    expect(isValidAmount("100")).toBe(true);
    expect(isValidAmount("0.001")).toBe(true);
    expect(isValidAmount("")).toBe(true); // empty is valid
    expect(isValidAmount("0")).toBe(false); // zero is invalid
    expect(isValidAmount("-5")).toBe(false); // negative
    expect(isValidAmount("abc")).toBe(false); // not a number
  });

  it("calculates MAX amount correctly", () => {
    expect(calculateMax("10000")).toBe("9999.0000000");
    expect(calculateMax("1")).toBe("0.0000000");
    expect(calculateMax("0.5")).toBe("0.0000000"); // can't go negative
  });
});
