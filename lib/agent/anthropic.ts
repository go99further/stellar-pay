import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

// Determine which provider to use based on env vars
const USE_DEEPSEEK = Boolean(process.env.DEEPSEEK_API_KEY);

export function getAnthropicClient(): Anthropic {
  if (USE_DEEPSEEK) {
    throw new Error("Using DeepSeek provider, call getOpenAIClient() instead");
  }
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

export function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }
  openaiClient = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
  });
  return openaiClient;
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function hasDeepSeekKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function hasAnyKey(): boolean {
  return hasAnthropicKey() || hasDeepSeekKey();
}

// Model mappings
export const MODEL_ROUTER = USE_DEEPSEEK ? "deepseek-chat" : "claude-haiku-4-5-20251001";
export const MODEL_ANALYTICS = USE_DEEPSEEK ? "deepseek-chat" : "claude-sonnet-4-6";

// Provider info
export const PROVIDER = USE_DEEPSEEK ? "deepseek" : "anthropic";
