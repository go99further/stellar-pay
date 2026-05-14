// This endpoint is rate-limited because it's deployed publicly on Vercel and
// triggers paid Anthropic API calls. Without a rate limit, a single runaway
// client or a trivial DoS could exhaust the monthly API budget in minutes.
// MultiTierRateLimiter enforces both a per-second burst cap and a per-hour
// volume cap per IP so the demo stays available for everyone.
import { NextRequest } from "next/server";
import { hasAnyKey } from "@/lib/agent/anthropic";
import { DEFAULT_PERMISSION_CONTEXT, isOperationAllowed } from "@/lib/agent/permissions";
import { classifyIntent } from "@/lib/agent/router";
import { dispatch } from "@/lib/agent/dispatcher";
import { config } from "@/lib/agent/config";
import { trimHistory } from "@/lib/agent/utils";
import type { AgentMessage, AgentStreamEvent } from "@/lib/agent/types";
import { MultiTierRateLimiter } from "@/lib/agent/token-bucket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-IP rate limit. Tuned for a public Vercel demo:
// - 5 req/sec to stop runaway clients
// - 100 req/hr (~67 per 60min as configured) to bound monthly Anthropic spend
//
// Why MultiTierRateLimiter: a single bucket either allows bursts (if rate is
// high) or blocks bursts (if rate is low). Two tiers let us smooth bursts at
// the second level while capping daily volume at the minute level.
const RATE_LIMIT = new MultiTierRateLimiter(5, 100);

function sseLine(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  if (!hasAnyKey()) {
    return new Response(
      JSON.stringify({
        error: "ANTHROPIC_API_KEY or DEEPSEEK_API_KEY is not set on the server. Add it to .env.local and restart.",
      }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  let body: { messages?: AgentMessage[]; walletAddress?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const MAX_HISTORY = config.maxHistory;
  const rawHistory = Array.isArray(body.messages) ? body.messages : [];
  const history = trimHistory(rawHistory, MAX_HISTORY);
  if (history.length === 0) {
    return new Response(JSON.stringify({ error: "messages is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // walletAddress is optional — only needed for build_*_xdr tools
  const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress : undefined;

  // Identify the caller. x-forwarded-for is set by Vercel's edge; fall back to
  // "unknown" only as a last resort (it would collapse all unknown callers into
  // one bucket but never block a legitimate visitor due to misconfigured proxies).
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

  const rl = RATE_LIMIT.consume(ip);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({
        error: "Demo rate limit reached. This is a public demo capped at 5 req/sec, 100 req/hr per IP. Try again shortly.",
        retryAfter: rl.retryAfter,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": String(Math.ceil((rl.retryAfter ?? 1000) / 1000)),
          "X-RateLimit-Limit": "100",
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(sseLine(evt)));
      };
      try {
        const routed = await classifyIntent(history);
        send({ type: "router", output: routed });

        if (!isOperationAllowed(DEFAULT_PERMISSION_CONTEXT, routed.intent)) {
          send({ type: "error", message: "This operation is currently disabled." });
          send({ type: "done" });
          return;
        }

        send({ type: "agent_start", agent: routed.intent });
        const t0 = Date.now();
        for await (const evt of dispatch(routed.intent, history, walletAddress)) {
          send(evt);
        }
        if (routed.intent !== "clarify") {
          send({ type: "agent_complete", agent: routed.intent, elapsedMs: Date.now() - t0 });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "agent error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
