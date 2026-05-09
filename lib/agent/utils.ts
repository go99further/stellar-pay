import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// withRetry — exponential backoff for async tool calls
// ---------------------------------------------------------------------------

interface RetryOptions {
  initialDelay?: number;
  multiplier?: number;
  maxDelay?: number;
  maxAttempts?: number;
}

function isTerminalError(message: string): boolean {
  return message.toLowerCase().includes("context window exceeded");
}

function isRetryableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("timeout") ||
    lower.includes("temporarily")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    initialDelay = 125,
    multiplier = 2,
    maxDelay = 60000,
    maxAttempts = 3,
  } = options;

  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isTerminalError(message)) {
        throw err;
      }

      if (attempt === maxAttempts || !isRetryableError(message)) {
        throw err;
      }

      await sleep(Math.min(delay, maxDelay));
      delay = Math.min(delay * multiplier, maxDelay);
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error("withRetry: exhausted attempts");
}

// ---------------------------------------------------------------------------
// validateMessages — ensure messages alternate user/assistant roles
// ---------------------------------------------------------------------------

export function validateMessages(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;

  const result: Anthropic.MessageParam[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];

    if (curr.role === prev.role) {
      // Insert an empty message of the opposite role to fix the alternation
      const oppositeRole: "user" | "assistant" =
        curr.role === "user" ? "assistant" : "user";
      result.push({ role: oppositeRole, content: "" });
    }

    result.push(curr);
  }

  return result;
}

// ---------------------------------------------------------------------------
// trimHistory — safe MAX_HISTORY slice that never orphans a tool-result
//
// Anthropic rejects a message array where the first message is a user turn
// whose content is a ToolResult block with no preceding assistant ToolUse.
// Plain slice(-N) can produce exactly that. We walk the boundary forward
// until we land on a safe split point (a user text message or the start).
// ---------------------------------------------------------------------------

export function trimHistory<T extends { role: string; content: unknown }>(
  messages: T[],
  maxMessages: number
): T[] {
  if (messages.length <= maxMessages) return messages;

  let start = messages.length - maxMessages;

  // Walk forward until the first kept message is NOT a pure tool-result turn.
  // A tool-result turn is a user message whose every content block is a
  // tool_result — it must be preceded by the assistant message that issued
  // the matching tool_use.
  while (start < messages.length) {
    const first = messages[start];
    if (first.role !== "user") break;

    const content = first.content;
    const isToolResultTurn =
      Array.isArray(content) &&
      content.length > 0 &&
      content.every((b) => typeof b === "object" && b !== null && "type" in b && (b as { type: string }).type === "tool_result");

    if (!isToolResultTurn) break;

    start += 1;
  }

  return messages.slice(start);
}

// ---------------------------------------------------------------------------
// parseContractError — map AMM panic strings to friendly messages
// ---------------------------------------------------------------------------

const CONTRACT_ERROR_MAP: Record<string, string> = {
  "amount_in must be positive": "输入金额必须大于 0",
  "pool has no liquidity": "池子暂无流动性，无法交易",
  "token_in is not TokenA or TokenB": "不支持的代币类型",
  "slippage: amount_out below min_amount_out": "滑点超限，实际输出低于最小接受值",
  "zero output": "交易输出为 0，请增加输入金额",
  "amounts must be positive": "添加流动性金额必须大于 0",
  "slippage: lp_minted below min_lp": "添加流动性滑点超限",
  "zero lp minted": "LP token 铸造量为 0",
  "lp_amount must be positive": "LP 数量必须大于 0",
  "pool is empty": "池子为空，无法移除流动性",
  "slippage: amount_a below min_a": "移除流动性时 TokenA 不足",
  "slippage: amount_b below min_b": "移除流动性时 TokenB 不足",
  "already initialized": "合约已初始化",
};

export function parseContractError(raw: string): string {
  for (const [key, friendly] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (raw.includes(key)) {
      return friendly;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// calculateRecommendedSlippage — intelligent slippage based on trade size
// ---------------------------------------------------------------------------

/**
 * Calculate recommended slippage tolerance based on trade size relative to pool reserves.
 *
 * @param amountIn - Amount being traded (in raw units)
 * @param reserveIn - Input token reserve in the pool (in raw units)
 * @param reserveOut - Output token reserve in the pool (in raw units)
 * @returns Recommended slippage in basis points (100 = 1%)
 *
 * Logic:
 * - Small trades (<1% of reserves): 50 bps (0.5%)
 * - Medium trades (1-5% of reserves): 100 bps (1%)
 * - Large trades (5-10% of reserves): 200 bps (2%)
 * - Very large trades (>10% of reserves): 300 bps (3%)
 */
export function calculateRecommendedSlippage(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  // Avoid division by zero
  if (reserveIn === 0n) {
    return 300; // Maximum slippage for empty pools
  }

  // Calculate trade size as percentage of reserve (in basis points)
  // tradeSizeBps = (amountIn * 10000) / reserveIn
  const tradeSizeBps = (amountIn * 10000n) / reserveIn;

  // Thresholds in basis points:
  // 1% = 100 bps, 5% = 500 bps, 10% = 1000 bps
  if (tradeSizeBps < 100n) {
    // < 1% of pool: low slippage
    return 50;
  } else if (tradeSizeBps < 500n) {
    // 1-5% of pool: medium slippage
    return 100;
  } else if (tradeSizeBps < 1000n) {
    // 5-10% of pool: high slippage
    return 200;
  } else {
    // > 10% of pool: very high slippage
    return 300;
  }
}
