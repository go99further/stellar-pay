import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure logic helpers extracted from AIInsight & poll-insight route — testable
// without React or the Anthropic SDK.
// ---------------------------------------------------------------------------

/**
 * Convert a Map<number, number> to a plain Record<number, number>.
 * This is required before JSON.stringify because JSON.stringify(new Map())
 * produces "{}" (empty object), losing all data.
 */
function mapToRecord(votes: Map<number, number>): Record<number, number> {
  const obj: Record<number, number> = {};
  votes.forEach((count, index) => {
    obj[index] = count;
  });
  return obj;
}

/**
 * Compute the percentage for a single option, matching the route logic.
 * Returns "0.0" when totalVotes is 0 to avoid division by zero.
 */
function computePercentage(count: number, totalVotes: number): string {
  return totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : "0.0";
}

/**
 * Guard that mirrors the AIInsight component's early-return condition.
 * The component renders nothing (and therefore never fetches) when this
 * returns false.
 */
function shouldFetchInsight(
  question: string,
  options: string[],
  totalVotes: number
): boolean {
  return Boolean(question) && options.length > 0 && totalVotes > 0;
}

// ---------------------------------------------------------------------------

describe("AI Insight — Map → plain object conversion", () => {
  it("converts a Map to a plain Record preserving all entries", () => {
    const votes = new Map<number, number>([
      [0, 42],
      [1, 13],
      [2, 5],
    ]);
    const record = mapToRecord(votes);
    expect(record[0]).toBe(42);
    expect(record[1]).toBe(13);
    expect(record[2]).toBe(5);
  });

  it("produces an empty object for an empty Map", () => {
    const record = mapToRecord(new Map());
    expect(Object.keys(record)).toHaveLength(0);
  });
});

describe("AI Insight — percentage calculation", () => {
  it("calculates correct percentage string", () => {
    expect(computePercentage(1, 4)).toBe("25.0");
    expect(computePercentage(2, 3)).toBe("66.7");
    expect(computePercentage(10, 10)).toBe("100.0");
  });

  it("returns '0.0' when totalVotes is 0 (no division by zero)", () => {
    expect(computePercentage(0, 0)).toBe("0.0");
    expect(computePercentage(5, 0)).toBe("0.0");
  });
});

describe("AI Insight — shouldFetchInsight guard", () => {
  it("returns true when all conditions are met", () => {
    expect(shouldFetchInsight("Best framework?", ["React", "Vue"], 7)).toBe(true);
  });

  it("returns false when totalVotes is 0", () => {
    expect(shouldFetchInsight("Best framework?", ["React", "Vue"], 0)).toBe(false);
  });

  it("returns false when question is empty", () => {
    expect(shouldFetchInsight("", ["React", "Vue"], 10)).toBe(false);
  });

  it("returns false when options array is empty", () => {
    expect(shouldFetchInsight("Best framework?", [], 10)).toBe(false);
  });
});
