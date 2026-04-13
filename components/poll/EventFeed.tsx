"use client";

import { useContractEvents } from "@/hooks/useContractEvents";

export default function EventFeed() {
  const { events, isPolling } = useContractEvents(5000);

  return (
    <div className="p-6 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Event Feed</h3>
        <div className="flex items-center gap-2">
          {isPolling && (
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <span className="text-xs text-slate-400">
            {isPolling ? "Live" : "Paused"}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-slate-500">
          No events yet. Events will appear here when votes are cast.
        </p>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5 animate-fade-in"
            >
              <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-slate-300 truncate">
                  {event.topic.join(" / ") || event.type}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ledger #{event.ledger} &middot;{" "}
                  {new Date(event.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
