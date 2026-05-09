import { NextRequest } from "next/server";
import { hasAnyKey } from "@/lib/agent/anthropic";
import { DEFAULT_PERMISSION_CONTEXT, isOperationAllowed } from "@/lib/agent/permissions";
import { classifyIntent } from "@/lib/agent/router";
import { defaultRegistry } from "@/lib/agent/registry";
import { config } from "@/lib/agent/config";
import { trimHistory } from "@/lib/agent/utils";
import type { AgentMessage, AgentStreamEvent } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

        const agent = defaultRegistry.get(routed.intent);
        if (agent) {
          send({ type: "agent_start", agent: routed.intent });
          const t0 = Date.now();
          for await (const evt of agent.run(history, walletAddress)) {
            send(evt);
          }
          send({ type: "agent_complete", agent: routed.intent, elapsedMs: Date.now() - t0 });
        } else {
          send({ type: "text", delta: "Could you rephrase? I can answer questions about the AMM pool, execute swaps, manage liquidity, or analyze risks." });
          send({ type: "done" });
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
