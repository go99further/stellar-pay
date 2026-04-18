/**
 * AMM pure math functions using bigint (Soroban i128 values overflow JS number).
 * All amounts are in the token's smallest unit (stroops / raw units).
 */

/**
 * Babylonian integer square root (no floating point).
 */
export function integerSqrt(n: bigint): bigint {
  if (n <= 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Constant product swap output with 0.3% fee (997/1000).
 * Formula: amount_out = (amount_in * 997 * reserve_out) / (reserve_in * 1000 + amount_in * 997)
 */
export function getSwapOutput(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

/**
 * Price impact as a percentage (0-100).
 * Uses floating-point arithmetic on Number for readability; inputs are
 * converted from bigint so precision is sufficient for UI display.
 * Formula: 1 - (actual_out / ideal_out), where ideal uses spot price (no fee).
 */
export function getPriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0;
  const aIn = Number(amountIn);
  const rIn = Number(reserveIn);
  const rOut = Number(reserveOut);
  // Spot price output (no fee)
  const idealOut = (aIn * rOut) / rIn;
  if (idealOut <= 0) return 0;
  // Actual output with 0.3% fee
  const aInFee = aIn * 997;
  const actualOut = (aInFee * rOut) / (rIn * 1000 + aInFee);
  const impact = (1 - actualOut / idealOut) * 100;
  return Math.max(0, impact);
}

/**
 * LP tokens minted for a deposit.
 * First deposit: sqrt(a * b). Subsequent: min ratio * total_supply.
 */
export function getLpTokensForDeposit(
  amountA: bigint,
  amountB: bigint,
  reserveA: bigint,
  reserveB: bigint,
  totalSupply: bigint
): bigint {
  if (amountA <= 0n || amountB <= 0n) return 0n;
  if (totalSupply === 0n) {
    // First deposit: geometric mean
    return integerSqrt(amountA * amountB);
  }
  if (reserveA <= 0n || reserveB <= 0n) return 0n;
  const lpA = (amountA * totalSupply) / reserveA;
  const lpB = (amountB * totalSupply) / reserveB;
  return lpA < lpB ? lpA : lpB;
}

/**
 * Token amounts returned when withdrawing `lpAmount` LP tokens.
 */
export function getWithdrawAmounts(
  lpAmount: bigint,
  reserveA: bigint,
  reserveB: bigint,
  totalSupply: bigint
): { amountA: bigint; amountB: bigint } {
  if (lpAmount <= 0n || totalSupply <= 0n) {
    return { amountA: 0n, amountB: 0n };
  }
  return {
    amountA: (lpAmount * reserveA) / totalSupply,
    amountB: (lpAmount * reserveB) / totalSupply,
  };
}

/**
 * Apply slippage tolerance in basis points (100 bps = 1%).
 * Returns the minimum acceptable amount after slippage.
 * e.g. applySlippage(1000n, 50n) → 995n  (0.5% slippage)
 */
export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  if (slippageBps <= 0n) return amount;
  return (amount * (10000n - slippageBps)) / 10000n;
}

/**
 * Check whether amount_out meets the minimum after slippage.
 */
export function checkSlippage(
  amountOut: bigint,
  minAmountOut: bigint
): boolean {
  return amountOut >= minAmountOut;
}
