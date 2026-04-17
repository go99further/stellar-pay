"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface AIInsightProps {
  question: string;
  options: string[];
  votes: Map<number, number>;
  totalVotes: number;
}

export default function AIInsight({ question, options, votes, totalVotes }: AIInsightProps) {
  const [insight, setInsight] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchInsight = useCallback(async () => {
    if (!question || options.length === 0 || totalVotes === 0) return;

    setLoading(true);
    try {
      const votesObj: Record<number, number> = {};
      votes.forEach((count, index) => {
        votesObj[index] = count;
      });

      const res = await fetch("/api/ai/poll-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, options, votes: votesObj, totalVotes }),
      });

      const data = await res.json();
      setInsight(data.insight ?? "");
    } catch {
      setInsight("");
    } finally {
      setLoading(false);
    }
  }, [question, options, votes, totalVotes]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchInsight, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchInsight, totalVotes]);

  if (!question || options.length === 0 || totalVotes === 0) return null;

  return (
    <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">AI Insight</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 border border-violet-500/30 text-violet-300">
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Powered by Claude
          </span>
        </div>
        <button
          onClick={fetchInsight}
          disabled={loading}
          className="text-xs text-slate-400 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
          title="Refresh insight"
        >
          {loading ? (
            <div className="w-3.5 h-3.5 border border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      </div>

      {loading && !insight ? (
        <div className="space-y-2">
          <div className="h-3 bg-white/10 rounded-full animate-pulse w-full" />
          <div className="h-3 bg-white/10 rounded-full animate-pulse w-4/5" />
          <div className="h-3 bg-white/10 rounded-full animate-pulse w-3/5" />
        </div>
      ) : insight ? (
        <p className="text-sm text-slate-300 leading-relaxed">{insight}</p>
      ) : null}
    </div>
  );
}
