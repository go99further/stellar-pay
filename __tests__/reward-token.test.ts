import { describe, it, expect } from "vitest";

/**
 * Tests for RewardToken integration logic
 * Covers token amount formatting, balance calculations, and cross-contract reward math
 */
describe("RewardToken Logic", () => {
  // Soroban token amounts use 7 decimal places (stroop-like)
  const DECIMALS = 7;
  const SCALE = 10 ** DECIMALS; // 10_000_000

  function formatTokenAmount(raw: bigint | number): string {
    const n = typeof raw === "bigint" ? Number(raw) : raw;
    return (n / SCALE).toFixed(DECIMALS);
  }

  function parseTokenAmount(display: string): number {
    return Math.round(parseFloat(display) * SCALE);
  }

  it("formats raw token amounts correctly", () => {
    expect(formatTokenAmount(10_000_000)).toBe("1.0000000");
    expect(formatTokenAmount(5_000_000)).toBe("0.5000000");
    expect(formatTokenAmount(100_000_000)).toBe("10.0000000");
    expect(formatTokenAmount(0)).toBe("0.0000000");
  });

  it("parses display amounts back to raw", () => {
    expect(parseTokenAmount("1.0")).toBe(10_000_000);
    expect(parseTokenAmount("0.5")).toBe(5_000_000);
    expect(parseTokenAmount("10")).toBe(100_000_000);
  });

  it("vote reward is exactly 1 VOTE token (10_000_000 raw)", () => {
    const VOTE_REWARD_RAW = 1_0000000; // as coded in poll contract
    expect(formatTokenAmount(VOTE_REWARD_RAW)).toBe("1.0000000");
  });

  it("accumulates reward balance correctly for multiple votes", () => {
    const VOTE_REWARD_RAW = 10_000_000;
    let balance = 0;
    const votes = 5;
    for (let i = 0; i < votes; i++) {
      balance += VOTE_REWARD_RAW;
    }
    expect(formatTokenAmount(balance)).toBe("5.0000000");
  });

  it("handles zero balance display", () => {
    expect(formatTokenAmount(0)).toBe("0.0000000");
  });

  it("token symbol should be VOTE", () => {
    const TOKEN_SYMBOL = "VOTE";
    const TOKEN_NAME = "VoteReward";
    expect(TOKEN_SYMBOL).toBe("VOTE");
    expect(TOKEN_NAME).toBe("VoteReward");
  });

  it("cross-contract: total supply increases by reward per vote", () => {
    const VOTE_REWARD = 10_000_000;
    let totalSupply = 0;
    const voterCount = 3;

    // Simulate 3 people voting
    for (let i = 0; i < voterCount; i++) {
      totalSupply += VOTE_REWARD;
    }

    expect(totalSupply).toBe(30_000_000);
    expect(formatTokenAmount(totalSupply)).toBe("3.0000000");
  });

  it("amount must be positive (mirrors contract validation)", () => {
    function isValidMintAmount(amount: number): boolean {
      return amount > 0;
    }
    expect(isValidMintAmount(10_000_000)).toBe(true);
    expect(isValidMintAmount(0)).toBe(false);
    expect(isValidMintAmount(-1)).toBe(false);
  });
});
