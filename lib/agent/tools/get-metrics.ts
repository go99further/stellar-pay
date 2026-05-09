import type Anthropic from "@anthropic-ai/sdk";

export const getMetricsSchema: Anthropic.Tool = {
  name: "get_metrics",
  description:
    "Fetch AMM dashboard metrics: total swap count, aggregate token A and token B volume, TVL in both tokens, and a list of up to 10 recent swaps. Read-only.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export async function getMetricsHandler(): Promise<unknown> {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const url = base.startsWith("http") ? `${base}/api/metrics` : `https://${base}/api/metrics`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`metrics endpoint returned ${res.status}`);
  }
  return await res.json();
}
