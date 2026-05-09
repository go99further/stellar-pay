"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage, AgentStreamEvent, RouterOutput } from "@/lib/agent/types";
import { useWallet } from "@/context/WalletContext";
import { submitAmmTransaction } from "@/lib/amm-contract";
import { ConfirmationCard } from "@/components/agent/ConfirmationCard";
import { ToolCallStatus } from "@/components/agent/ToolCallStatus";

const HISTORY_KEY = "stellar-pay-agent-history";
const MAX_STORED_TURNS = 50;

interface ToolCall {
  name: string;
  input: unknown;
  status: "running" | "completed" | "error";
  error?: string;
}

interface PendingXdr {
  xdr: string;
  operationType: "swap" | "add_liquidity" | "remove_liquidity";
  details: Record<string, unknown>;
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  router?: RouterOutput;
  toolCalls?: ToolCall[];
  pendingXdr?: PendingXdr;
  agentStatus?: string | null;
}

export default function AgentPage() {
  const { address, connect, connectLoading, signTransaction } = useWallet();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatTurn[];
        // Filter out any pending XDRs (they shouldn't persist)
        const cleaned = parsed.map((t) => ({ ...t, pendingXdr: undefined }));
        setTurns(cleaned);
      }
    } catch {
      // Ignore parse errors
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  // Save history to localStorage whenever turns change
  useEffect(() => {
    if (!historyLoaded) return;
    try {
      // Only save the last MAX_STORED_TURNS turns
      const toSave = turns.slice(-MAX_STORED_TURNS);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(toSave));
    } catch {
      // Ignore storage errors
    }
  }, [turns, historyLoaded]);

  const clearHistory = useCallback(() => {
    setTurns([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    const nextTurns: ChatTurn[] = [
      ...turns,
      { role: "user", text },
      { role: "assistant", text: "" },
    ];
    setTurns(nextTurns);
    setInput("");
    setBusy(true);
    setError(null);
    setTxHash(null);

    const history: AgentMessage[] = nextTurns
      .filter((t) => t.role === "user" || t.text.length > 0)
      .map((t) => ({ role: t.role, content: t.text }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.slice(0, -1),
          walletAddress: address ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("no response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith("data:")) continue;
          const payload = raw.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as AgentStreamEvent;
            setTurns((prev) => {
              const copy = [...prev];
              const last = { ...copy[copy.length - 1] };
              if (evt.type === "text") {
                last.text += evt.delta;
              } else if (evt.type === "router") {
                last.router = evt.output;
              } else if (evt.type === "tool_use") {
                last.toolCalls = [
                  ...(last.toolCalls ?? []),
                  { name: evt.name, input: evt.input, status: "running" },
                ];
              } else if (evt.type === "tool_result") {
                // Mark the tool as completed or error
                const toolCalls = last.toolCalls ?? [];
                const lastToolIdx = toolCalls.length - 1;
                if (lastToolIdx >= 0) {
                  toolCalls[lastToolIdx] = {
                    ...toolCalls[lastToolIdx],
                    status: evt.isError ? "error" : "completed",
                    error: evt.isError ? String(evt.output) : undefined,
                  };
                  last.toolCalls = toolCalls;
                }

                // If the result contains an XDR, surface it for signing
                const output = evt.output as Record<string, unknown> | null;
                if (output && typeof output.xdr === "string") {
                  const operationType = getOperationType(evt.name);
                  if (operationType) {
                    last.pendingXdr = {
                      xdr: output.xdr,
                      operationType,
                      details: output,
                    };
                  }
                }
              } else if (evt.type === "error") {
                last.text += `\n[error] ${evt.message}`;
              } else if (evt.type === "agent_start") {
                last.agentStatus = `⏳ ${evt.agent}…`;
              } else if (evt.type === "agent_complete") {
                last.agentStatus = `✓ ${evt.agent} (${(evt.elapsedMs / 1000).toFixed(1)}s)`;
              }
              copy[copy.length - 1] = last;
              return copy;
            });
          } catch {
            // skip malformed chunk
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "request failed");
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [input, busy, turns, address]);

  const handleSign = useCallback(
    async (xdr: string, turnIndex: number) => {
      setBusy(true);
      setError(null);
      setTxHash(null);
      try {
        const signed = await signTransaction(xdr);
        const result = await submitAmmTransaction(signed);
        setTxHash(result.hash);
        // Clear the pending XDR from the turn
        setTurns((prev) => {
          const copy = [...prev];
          copy[turnIndex] = { ...copy[turnIndex], pendingXdr: undefined };
          return copy;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "signing failed");
      } finally {
        setBusy(false);
      }
    },
    [signTransaction]
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Stellar-Pay Agent</h1>
          <p className="text-sm text-neutral-500">
            Ask about the pool, swap tokens, or check risks.
          </p>
        </div>
        <div className="flex items-center gap-2 text-right">
          {turns.length > 0 && (
            <button
              onClick={clearHistory}
              disabled={busy}
              className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title="Clear conversation history"
            >
              Clear
            </button>
          )}
          {address ? (
            <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-mono text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {address.slice(0, 6)}…{address.slice(-4)}
            </span>
          ) : (
            <button
              onClick={() => void connect()}
              disabled={connectLoading}
              className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {connectLoading ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      <section className="flex-1 space-y-3 overflow-y-auto rounded border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {turns.length === 0 && (
          <p className="text-sm text-neutral-400">
            Try: &ldquo;Swap 10 TKNA for TKNB&rdquo;, &ldquo;What&apos;s the TVL?&rdquo;, or &ldquo;Is the pool safe right now?&rdquo;
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs font-medium uppercase text-neutral-500">{t.role}</div>
            {t.router && (
              <div className="text-xs text-indigo-500">
                intent: {t.router.intent} — {t.router.reason}
              </div>
            )}
            {t.agentStatus && (
              <div className="text-xs text-neutral-400">{t.agentStatus}</div>
            )}
            {t.toolCalls?.map((c, j) => (
              <ToolCallStatus key={j} toolName={c.name} status={c.status} error={c.error} />
            ))}
            {t.text && (
              <div className="whitespace-pre-wrap text-sm">{t.text}</div>
            )}
            {t.pendingXdr && (
              <ConfirmationCard
                operationType={t.pendingXdr.operationType}
                details={t.pendingXdr.details}
                onConfirm={() => void handleSign(t.pendingXdr!.xdr, i)}
                onCancel={() =>
                  setTurns((prev) => {
                    const copy = [...prev];
                    copy[i] = { ...copy[i], pendingXdr: undefined };
                    return copy;
                  })
                }
                disabled={busy}
                walletConnected={!!address}
              />
            )}
          </div>
        ))}
      </section>

      {txHash && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-2 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ Transaction confirmed:{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {txHash.slice(0, 12)}…
          </a>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the AMM pool, swap tokens, or check risks…"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </main>
  );
}

function getOperationType(
  toolName: string
): "swap" | "add_liquidity" | "remove_liquidity" | null {
  if (toolName === "build_swap_xdr") return "swap";
  if (toolName === "build_add_liquidity_xdr") return "add_liquidity";
  if (toolName === "build_remove_liquidity_xdr") return "remove_liquidity";
  return null;
}

// Force dynamic rendering to avoid SSR issues with WalletProvider
export const dynamic = "force-dynamic";
