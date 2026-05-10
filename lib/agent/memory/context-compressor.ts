/**
 * Context Compressor
 *
 * Inspired by Aider's token-aware compression pattern:
 * - Intelligent message prioritization
 * - Semantic importance scoring
 * - Sliding window with key facts retention
 * - Token budget management
 *
 * Pattern: Analyze → Score → Select → Compress
 */

export interface CompressionConfig {
  maxTokens: number;
  minMessagesToKeep: number;
  alwaysKeepSystemPrompt: boolean;
  alwaysKeepRecentN: number;
  compressionRatio: number; // 0-1, target compression ratio
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ScoredMessage extends Message {
  score: number;
  tokenCount: number;
  importance: "critical" | "high" | "medium" | "low";
}

export interface CompressionResult {
  originalMessages: Message[];
  compressedMessages: Message[];
  originalTokenCount: number;
  compressedTokenCount: number;
  compressionRatio: number;
  removedCount: number;
  summary?: string;
}

/**
 * Context Compressor
 * Intelligently compresses conversation history while preserving important information
 */
export class ContextCompressor {
  private config: CompressionConfig;

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = {
      maxTokens: 4000,
      minMessagesToKeep: 5,
      alwaysKeepSystemPrompt: true,
      alwaysKeepRecentN: 3,
      compressionRatio: 0.5, // Target 50% compression
      ...config,
    };
  }

  /**
   * Compress messages to fit within token budget
   */
  compress(messages: Message[]): CompressionResult {
    if (messages.length === 0) {
      return this.createEmptyResult();
    }

    // Score all messages
    const scoredMessages = messages.map((msg) => this.scoreMessage(msg, messages));

    // Calculate total tokens
    const originalTokenCount = scoredMessages.reduce((sum, msg) => sum + msg.tokenCount, 0);

    // If under budget, no compression needed
    if (originalTokenCount <= this.config.maxTokens) {
      return {
        originalMessages: messages,
        compressedMessages: messages,
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        compressionRatio: 1.0,
        removedCount: 0,
      };
    }

    // Select messages to keep
    const selected = this.selectMessages(scoredMessages);

    // Generate summary of removed messages
    const removed = scoredMessages.filter((msg) => !selected.includes(msg));
    const summary = this.generateSummary(removed);

    // Build compressed message list
    const compressedMessages: Message[] = [];

    // Add system prompt if configured
    if (this.config.alwaysKeepSystemPrompt) {
      const systemMsg = messages.find((msg) => msg.role === "system");
      if (systemMsg && !selected.find((s) => s === systemMsg)) {
        compressedMessages.push(systemMsg);
      }
    }

    // Add summary if we removed messages
    if (summary) {
      compressedMessages.push({
        role: "assistant",
        content: summary,
        timestamp: Date.now(),
        metadata: { compressed: true, removedCount: removed.length },
      });
    }

    // Add selected messages in chronological order
    compressedMessages.push(...selected.map((s) => ({
      role: s.role,
      content: s.content,
      timestamp: s.timestamp,
      metadata: s.metadata,
    })));

    const compressedTokenCount = this.estimateTokens(
      compressedMessages.map((m) => m.content).join(" ")
    );

    return {
      originalMessages: messages,
      compressedMessages,
      originalTokenCount,
      compressedTokenCount,
      compressionRatio: compressedTokenCount / originalTokenCount,
      removedCount: removed.length,
      summary,
    };
  }

  /**
   * Score message importance
   */
  private scoreMessage(message: Message, allMessages: Message[]): ScoredMessage {
    let score = 0;
    const content = message.content.toLowerCase();
    const tokenCount = this.estimateTokens(message.content);

    // Recency bonus (exponential decay)
    const messageIndex = allMessages.indexOf(message);
    const recencyBonus = Math.exp(-(allMessages.length - messageIndex - 1) / 5) * 10;
    score += recencyBonus;

    // Role importance
    if (message.role === "system") {
      score += 20; // System prompts are critical
    } else if (message.role === "user") {
      score += 5; // User messages are important
    }

    // Content importance signals
    if (this.containsKeywords(content, ["error", "failed", "warning"])) {
      score += 8; // Errors are important
    }

    if (this.containsKeywords(content, ["swap", "transaction", "xdr", "sign"])) {
      score += 6; // Transaction-related content
    }

    if (this.containsKeywords(content, ["pool", "reserves", "liquidity"])) {
      score += 4; // Pool state information
    }

    if (this.containsNumbers(content)) {
      score += 3; // Numerical data (amounts, prices)
    }

    if (this.containsKeywords(content, ["confirmed", "success", "completed"])) {
      score += 5; // Successful operations
    }

    // Length penalty (very long messages are less important unless critical)
    if (tokenCount > 500) {
      score -= 2;
    }

    // Determine importance level
    let importance: ScoredMessage["importance"];
    if (score >= 20) importance = "critical";
    else if (score >= 10) importance = "high";
    else if (score >= 5) importance = "medium";
    else importance = "low";

    return {
      ...message,
      score,
      tokenCount,
      importance,
    };
  }

  /**
   * Select messages to keep based on scores and constraints
   */
  private selectMessages(scoredMessages: ScoredMessage[]): ScoredMessage[] {
    const selected: ScoredMessage[] = [];
    let currentTokens = 0;
    const targetTokens = this.config.maxTokens;

    // Always keep recent N messages
    const recentMessages = scoredMessages.slice(-this.config.alwaysKeepRecentN);
    for (const msg of recentMessages) {
      selected.push(msg);
      currentTokens += msg.tokenCount;
    }

    // Sort remaining messages by score (descending)
    const remaining = scoredMessages
      .slice(0, -this.config.alwaysKeepRecentN)
      .sort((a, b) => b.score - a.score);

    // Add messages until we hit token budget
    for (const msg of remaining) {
      if (currentTokens + msg.tokenCount <= targetTokens) {
        selected.push(msg);
        currentTokens += msg.tokenCount;
      }

      // Stop if we have minimum messages
      if (selected.length >= this.config.minMessagesToKeep) {
        break;
      }
    }

    // Sort selected messages chronologically
    return selected.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Generate summary of removed messages
   */
  private generateSummary(removed: ScoredMessage[]): string | undefined {
    if (removed.length === 0) {
      return undefined;
    }

    // Extract key facts from removed messages
    const keyFacts: string[] = [];

    for (const msg of removed) {
      // Extract transaction mentions
      if (msg.content.includes("swap") || msg.content.includes("transaction")) {
        const match = msg.content.match(/swap.*?(\d+.*?for.*?\d+)/i);
        if (match) {
          keyFacts.push(`Transaction: ${match[1]}`);
        }
      }

      // Extract error mentions
      if (msg.content.includes("error") || msg.content.includes("failed")) {
        const match = msg.content.match(/(error|failed).*?[.!]/i);
        if (match) {
          keyFacts.push(`Issue: ${match[0]}`);
        }
      }

      // Extract pool state
      if (msg.content.includes("reserves") || msg.content.includes("liquidity")) {
        const match = msg.content.match(/reserves?:?\s*(\d+.*?\d+)/i);
        if (match) {
          keyFacts.push(`Pool state: ${match[1]}`);
        }
      }
    }

    if (keyFacts.length === 0) {
      return `[Earlier conversation: ${removed.length} messages compressed]`;
    }

    return `[Earlier conversation compressed (${removed.length} messages). Key facts: ${keyFacts.join("; ")}]`;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if content contains keywords
   */
  private containsKeywords(content: string, keywords: string[]): boolean {
    return keywords.some((keyword) => content.includes(keyword));
  }

  /**
   * Check if content contains numbers
   */
  private containsNumbers(content: string): boolean {
    return /\d+/.test(content);
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): CompressionResult {
    return {
      originalMessages: [],
      compressedMessages: [],
      originalTokenCount: 0,
      compressedTokenCount: 0,
      compressionRatio: 1.0,
      removedCount: 0,
    };
  }

  /**
   * Update compression config
   */
  updateConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current config
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }
}

/**
 * Global context compressor instance
 */
export const contextCompressor = new ContextCompressor();

/**
 * Convenience function to compress messages
 */
export function compressMessages(
  messages: Message[],
  maxTokens?: number
): CompressionResult {
  if (maxTokens) {
    contextCompressor.updateConfig({ maxTokens });
  }
  return contextCompressor.compress(messages);
}

/**
 * Usage example:
 *
 * const messages: Message[] = [
 *   { role: "system", content: "You are a trading assistant", timestamp: Date.now() },
 *   { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
 *   { role: "assistant", content: "Simulating swap...", timestamp: Date.now() },
 *   // ... many more messages
 * ];
 *
 * const result = contextCompressor.compress(messages);
 *
 * console.log("Original tokens:", result.originalTokenCount);
 * console.log("Compressed tokens:", result.compressedTokenCount);
 * console.log("Compression ratio:", result.compressionRatio);
 * console.log("Removed messages:", result.removedCount);
 * console.log("Summary:", result.summary);
 *
 * // Use compressed messages for API call
 * const response = await callLLM(result.compressedMessages);
 */
