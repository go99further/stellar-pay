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
