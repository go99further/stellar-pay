/**
 * Pre-execution Validator for Trading Operations
 *
 * Inspired by SWE-agent's validation pattern:
 * - Dry-run before actual execution
 * - Catch errors without side effects
 * - Provide actionable feedback
 *
 * Pattern: Validate → Simulate → Execute
 */

import type { Contract } from "@stellar/stellar-sdk";
import { getReserves, getPrice, getTokenAId, getTokenBId, getTokenBalance } from "../../amm-contract";
import { getSwapOutput } from "../../amm-math";

const DUMMY_READER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  estimatedCost?: {
    gasFee: string;
    slippage: number;
    priceImpact: number;
  };
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: "low" | "medium" | "high";
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: number;
  userAddress: string;
}

/**
 * Pre-execution validator for swap operations
 * Validates before calling simulate_swap
 */
export class SwapValidator {
  private contract: Contract;
  private callerPublicKey: string;

  constructor(contract: Contract, callerPublicKey?: string) {
    this.contract = contract;
    this.callerPublicKey = callerPublicKey ?? DUMMY_READER;
  }

  /**
   * Validate swap parameters before execution
   * Returns validation result with errors/warnings
   */
  async validate(params: SwapParams): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Basic parameter validation
    this.validateBasicParams(params, errors);

    // 2. Token validation
    await this.validateTokens(params, errors);

    // 3. Amount validation
    await this.validateAmounts(params, errors, warnings);

    // 4. Deadline validation
    this.validateDeadline(params, errors, warnings);

    // 5. Slippage validation
    await this.validateSlippage(params, warnings);

    // If any errors, return early
    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // 6. Estimate costs (only if no errors)
    const estimatedCost = await this.estimateCost(params);

    return {
      valid: true,
      errors: [],
      warnings,
      estimatedCost,
    };
  }

  /**
   * Validate basic parameters (non-null, correct types)
   */
  private validateBasicParams(params: SwapParams, errors: ValidationError[]): void {
    if (!params.tokenIn || params.tokenIn.length !== 56) {
      errors.push({
        code: "INVALID_TOKEN_IN",
        message: "Invalid tokenIn address",
        field: "tokenIn",
        suggestion: "Provide a valid Stellar contract address (56 characters)",
      });
    }

    if (!params.tokenOut || params.tokenOut.length !== 56) {
      errors.push({
        code: "INVALID_TOKEN_OUT",
        message: "Invalid tokenOut address",
        field: "tokenOut",
        suggestion: "Provide a valid Stellar contract address (56 characters)",
      });
    }

    if (params.tokenIn === params.tokenOut) {
      errors.push({
        code: "SAME_TOKEN",
        message: "Cannot swap token to itself",
        field: "tokenIn,tokenOut",
        suggestion: "Choose different tokens for swap",
      });
    }

    if (params.amountIn <= 0n) {
      errors.push({
        code: "INVALID_AMOUNT",
        message: "Amount must be greater than 0",
        field: "amountIn",
        suggestion: "Provide a positive amount",
      });
    }

    if (!params.userAddress || params.userAddress.length !== 56) {
      errors.push({
        code: "INVALID_USER_ADDRESS",
        message: "Invalid user address",
        field: "userAddress",
        suggestion: "Connect wallet first",
      });
    }
  }

  /**
   * Validate tokens exist and are supported
   */
  private async validateTokens(
    params: SwapParams,
    errors: ValidationError[]
  ): Promise<void> {
    try {
      // Check if pool exists for this token pair
      const poolExists = await this.checkPoolExists(params.tokenIn, params.tokenOut);
      if (!poolExists) {
        errors.push({
          code: "POOL_NOT_FOUND",
          message: `No liquidity pool found for ${params.tokenIn}/${params.tokenOut}`,
          field: "tokenIn,tokenOut",
          suggestion: "Check token addresses or create a pool first",
        });
      }
    } catch (err) {
      errors.push({
        code: "TOKEN_VALIDATION_FAILED",
        message: `Failed to validate tokens: ${err instanceof Error ? err.message : "unknown error"}`,
        field: "tokenIn,tokenOut",
      });
    }
  }

  /**
   * Validate amounts (balance, liquidity, etc.)
   */
  private async validateAmounts(
    params: SwapParams,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    try {
      // Check user balance
      const balance = await this.getUserBalance(params.userAddress, params.tokenIn);
      if (balance < params.amountIn) {
        errors.push({
          code: "INSUFFICIENT_BALANCE",
          message: `Insufficient balance. Have ${balance}, need ${params.amountIn}`,
          field: "amountIn",
          suggestion: `Reduce amount to ${balance} or less`,
        });
      }

      // Check pool liquidity
      const reserves = await this.getPoolReserves(params.tokenIn, params.tokenOut);
      const tradeRatio = Number((params.amountIn * 10000n) / reserves.reserveIn) / 100;

      if (tradeRatio > 10) {
        warnings.push({
          code: "HIGH_TRADE_RATIO",
          message: `Trade size is ${tradeRatio.toFixed(1)}% of pool reserves`,
          severity: "high",
        });
      } else if (tradeRatio > 5) {
        warnings.push({
          code: "MEDIUM_TRADE_RATIO",
          message: `Trade size is ${tradeRatio.toFixed(1)}% of pool reserves`,
          severity: "medium",
        });
      }

      // Check if output liquidity is sufficient
      if (reserves.reserveOut < params.minAmountOut) {
        errors.push({
          code: "INSUFFICIENT_LIQUIDITY",
          message: `Pool has insufficient liquidity for this trade`,
          field: "amountIn",
          suggestion: `Reduce trade size or split into multiple trades`,
        });
      }
    } catch (err) {
      errors.push({
        code: "AMOUNT_VALIDATION_FAILED",
        message: `Failed to validate amounts: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  /**
   * Validate deadline is in the future
   */
  private validateDeadline(
    params: SwapParams,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilDeadline = params.deadline - now;

    if (timeUntilDeadline <= 0) {
      errors.push({
        code: "DEADLINE_PASSED",
        message: "Deadline has already passed",
        field: "deadline",
        suggestion: "Set deadline to at least 5 minutes in the future",
      });
    } else if (timeUntilDeadline < 60) {
      warnings.push({
        code: "SHORT_DEADLINE",
        message: `Deadline is only ${timeUntilDeadline}s away`,
        severity: "high",
      });
    } else if (timeUntilDeadline < 300) {
      warnings.push({
        code: "TIGHT_DEADLINE",
        message: `Deadline is ${Math.floor(timeUntilDeadline / 60)} minutes away`,
        severity: "medium",
      });
    }
  }

  /**
   * Validate slippage tolerance
   */
  private async validateSlippage(
    params: SwapParams,
    warnings: ValidationWarning[]
  ): Promise<void> {
    try {
      // Simulate swap to get expected output
      const expectedOutput = await this.simulateSwap(params);
      const slippageBps = Number(
        ((expectedOutput - params.minAmountOut) * 10000n) / expectedOutput
      );

      if (slippageBps > 500) {
        // >5%
        warnings.push({
          code: "HIGH_SLIPPAGE",
          message: `Slippage tolerance is ${(slippageBps / 100).toFixed(2)}%`,
          severity: "high",
        });
      } else if (slippageBps > 200) {
        // >2%
        warnings.push({
          code: "MEDIUM_SLIPPAGE",
          message: `Slippage tolerance is ${(slippageBps / 100).toFixed(2)}%`,
          severity: "medium",
        });
      }

      // Check if slippage is too tight
      if (slippageBps < 10) {
        // <0.1%
        warnings.push({
          code: "TIGHT_SLIPPAGE",
          message: `Slippage tolerance is very tight (${(slippageBps / 100).toFixed(2)}%)`,
          severity: "medium",
        });
      }
    } catch (err) {
      // Simulation failed, but don't block the trade
      warnings.push({
        code: "SLIPPAGE_CHECK_FAILED",
        message: "Could not verify slippage tolerance",
        severity: "low",
      });
    }
  }

  /**
   * Estimate transaction cost
   */
  private async estimateCost(params: SwapParams): Promise<ValidationResult["estimatedCost"]> {
    try {
      const expectedOutput = await this.simulateSwap(params);
      const priceImpact = this.calculatePriceImpact(params.amountIn, expectedOutput);
      const slippage = Number(
        ((expectedOutput - params.minAmountOut) * 10000n) / expectedOutput
      ) / 100;

      return {
        gasFee: "0.0001 XLM", // Stellar testnet fee
        slippage,
        priceImpact,
      };
    } catch {
      return undefined;
    }
  }

  // ── Helper methods — real contract calls ──

  private async checkPoolExists(tokenA: string, tokenB: string): Promise<boolean> {
    const tA = getTokenAId();
    const tB = getTokenBId();
    // If env vars are not configured, assume pool exists (testnet / CI)
    if (!tA || !tB) return true;
    const isKnownPair = (tokenA === tA && tokenB === tB) || (tokenA === tB && tokenB === tA);
    if (!isKnownPair) return false;
    const [rA, rB] = await getReserves(this.callerPublicKey);
    return rA > 0n && rB > 0n;
  }

  private async getUserBalance(user: string, token: string): Promise<bigint> {
    return getTokenBalance(user, token, user);
  }

  private async getPoolReserves(
    tokenIn: string,
    tokenOut: string
  ): Promise<{ reserveIn: bigint; reserveOut: bigint }> {
    const [rA, rB] = await getReserves(this.callerPublicKey);
    const isAtoB = tokenIn === getTokenAId();
    return isAtoB
      ? { reserveIn: rA, reserveOut: rB }
      : { reserveIn: rB, reserveOut: rA };
  }

  private async simulateSwap(params: SwapParams): Promise<bigint> {
    const price = await getPrice(this.callerPublicKey, params.tokenIn, params.amountIn);
    if (price > 0n) return price;
    // Fallback to local constant-product math if contract returns 0
    const { reserveIn, reserveOut } = await this.getPoolReserves(params.tokenIn, params.tokenOut);
    return getSwapOutput(params.amountIn, reserveIn, reserveOut);
  }

  private calculatePriceImpact(amountIn: bigint, amountOut: bigint): number {
    // Simplified price impact calculation
    const ratio = Number(amountOut * 10000n / amountIn) / 10000;
    return Math.abs(1 - ratio) * 100;
  }
}

/**
 * Usage example:
 *
 * const validator = new SwapValidator(contract);
 * const result = await validator.validate({
 *   tokenIn: "CBWYMSLBEJDFVH4QIYV7VX2W26JWVEPMC7FU4PZPS5H62SUJKJ7V4TV2",
 *   tokenOut: "CCOTCYJNSVFPNLCH3CASXSDM7IGFG23HB4PDSNZNKUUCUBLVQY3V5XTR",
 *   amountIn: 100n * 10n ** 7n,
 *   minAmountOut: 95n * 10n ** 7n,
 *   deadline: Math.floor(Date.now() / 1000) + 300,
 *   userAddress: "GXXXXXX...",
 * });
 *
 * if (!result.valid) {
 *   console.error("Validation failed:", result.errors);
 *   return;
 * }
 *
 * if (result.warnings.length > 0) {
 *   console.warn("Warnings:", result.warnings);
 * }
 *
 * // Proceed with swap
 * await executeSwap(params);
 */
