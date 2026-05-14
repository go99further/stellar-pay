import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

// Helper function to check which provider to use (runtime check)
function useDeepSeek(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function getAnthropicClient(): Anthropic {
  if (useDeepSeek()) {
    throw new Error("Using DeepSeek provider, call getOpenAIClient() instead");
  }
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL; // Support custom base URL
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  anthropicClient = new Anthropic({
    apiKey,
    ...(baseURL && { baseURL })
  });
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

// Model mappings (configurable via env vars, with fallback defaults)
//
// DeepSeek V4 model lineup (per docs):
//   deepseek-v4-flash  — fast/cheap, replaces deepseek-chat for routing
//   deepseek-v4-pro    — strongest, replaces deepseek-chat for sub-agents
//   deepseek-chat      — legacy alias, deprecated 2026/07/24
//
// Override via MODEL_ROUTER / MODEL_ANALYTICS env vars if you want to pin
// a specific generation or experiment with a different cost/quality point.
export function getModelRouter(): string {
  if (process.env.MODEL_ROUTER) return process.env.MODEL_ROUTER;
  return useDeepSeek() ? "deepseek-v4-flash" : "claude-haiku-4-5-20251001";
}

export function getModelAnalytics(): string {
  if (process.env.MODEL_ANALYTICS) return process.env.MODEL_ANALYTICS;
  return useDeepSeek() ? "deepseek-v4-pro" : "claude-sonnet-4-6";
}

// Legacy exports (for backward compatibility)
export const MODEL_ROUTER = getModelRouter();
export const MODEL_ANALYTICS = getModelAnalytics();

// Provider info
export const PROVIDER = useDeepSeek() ? "deepseek" : "anthropic";
