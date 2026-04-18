import * as StellarSdk from "@stellar/stellar-sdk";

export interface AmmSwapEvent {
  user: string;
  tokenIn: string;
  amountIn: bigint;
  amountOut: bigint;
}

export interface AmmLiquidityEvent {
  provider: string;
  amountA: bigint;
  amountB: bigint;
  lpAmount: bigint;
}

/**
 * Decode the topic XDR symbol to a readable string.
 * AMM topics are base64-encoded ScVal symbols like "swap", "add_liq", "rem_liq".
 */
export function decodeEventTopic(topicXdr: string): string {
  try {
    const scVal = StellarSdk.xdr.ScVal.fromXDR(topicXdr, "base64");
    const native = StellarSdk.scValToNative(scVal);
    return String(native);
  } catch {
    return topicXdr;
  }
}

/**
 * Decode a swap event value (base64 XDR tuple: user, token_in, amount_in, amount_out).
 */
export function decodeSwapEvent(valueXdr: string): AmmSwapEvent | null {
  try {
    const scVal = StellarSdk.xdr.ScVal.fromXDR(valueXdr, "base64");
    const native = StellarSdk.scValToNative(scVal) as unknown[];
    if (!Array.isArray(native) || native.length < 4) return null;
    return {
      user: String(native[0]),
      tokenIn: String(native[1]),
      amountIn: BigInt(String(native[2])),
      amountOut: BigInt(String(native[3])),
    };
  } catch {
    return null;
  }
}

/**
 * Decode an add_liq or rem_liq event value (base64 XDR tuple: provider, amountA, amountB, lpAmount).
 */
export function decodeLiquidityEvent(valueXdr: string): AmmLiquidityEvent | null {
  try {
    const scVal = StellarSdk.xdr.ScVal.fromXDR(valueXdr, "base64");
    const native = StellarSdk.scValToNative(scVal) as unknown[];
    if (!Array.isArray(native) || native.length < 4) return null;
    return {
      provider: String(native[0]),
      amountA: BigInt(String(native[1])),
      amountB: BigInt(String(native[2])),
      lpAmount: BigInt(String(native[3])),
    };
  } catch {
    return null;
  }
}
