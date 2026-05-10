import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/amm-contract", () => ({
  getReserves: vi.fn(),
  getLpSupply: vi.fn(),
  getAmmContractId: vi.fn(() => "AMM_CONTRACT_ID"),
  getTokenAId: vi.fn(() => "TOKEN_A_CONTRACT"),
  getTokenBId: vi.fn(() => "TOKEN_B_CONTRACT"),
  getLpTokenId: vi.fn(() => "LP_TOKEN_CONTRACT"),
}));

import { getPoolStatsHandler } from "../lib/agent/tools/get-pool-stats";
import { getReserves, getLpSupply } from "@/lib/amm-contract";

const DECIMALS = 7;
function toRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** DECIMALS));
}

describe("get-pool-stats tool", () => {
  beforeEach(() => {
    vi.mocked(getReserves).mockResolvedValue([toRaw(1_000_000), toRaw(2_000_000)]);
    vi.mocked(getLpSupply).mockResolvedValue(toRaw(500_000));
  });

  describe("getPoolStatsHandler", () => {
    it("should return tokenA with contractId and reserve", async () => {
      const result = await getPoolStatsHandler();
      expect(result.tokenA.contractId).toBe("TOKEN_A_CONTRACT");
      expect(result.tokenA.reserve).toBe("1000000.0");
    });

    it("should return tokenB with contractId and reserve", async () => {
      const result = await getPoolStatsHandler();
      expect(result.tokenB.contractId).toBe("TOKEN_B_CONTRACT");
      expect(result.tokenB.reserve).toBe("2000000.0");
    });

    it("should return lpToken with contractId and totalSupply", async () => {
      const result = await getPoolStatsHandler();
      expect(result.lpToken.contractId).toBe("LP_TOKEN_CONTRACT");
      expect(result.lpToken.totalSupply).toBe("500000.0");
    });

    it("should return ammContractId", async () => {
      const result = await getPoolStatsHandler();
      expect(result.ammContractId).toBe("AMM_CONTRACT_ID");
    });

    it("should call getReserves and getLpSupply", async () => {
      vi.clearAllMocks();
      vi.mocked(getReserves).mockResolvedValue([toRaw(1_000_000), toRaw(2_000_000)]);
      vi.mocked(getLpSupply).mockResolvedValue(toRaw(500_000));
      await getPoolStatsHandler();
      expect(getReserves).toHaveBeenCalledOnce();
      expect(getLpSupply).toHaveBeenCalledOnce();
    });

    it("should format reserves with 7 decimal places", async () => {
      vi.mocked(getReserves).mockResolvedValue([toRaw(1.5), toRaw(3.25)]);
      vi.mocked(getLpSupply).mockResolvedValue(toRaw(2.1));
      const result = await getPoolStatsHandler();
      expect(result.tokenA.reserve).toBe("1.5");
      expect(result.tokenB.reserve).toBe("3.25");
      expect(result.lpToken.totalSupply).toBe("2.1");
    });
  });
});
