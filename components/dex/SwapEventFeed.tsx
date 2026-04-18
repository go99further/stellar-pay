"use client";

import { useContractEvents } from "@/hooks/useContractEvents";

function formatEventType(topics: string[]): string {
  if (topics.length >= 2) {
    const type = topics[1];
    if (type === "swap") return "Swap";
    if (type === "add_liq") return "Add Liquidity";
    if (type === "rem_liq") return "Remove Liquidity";
    return type;
  }
  return "Event";
}

const AMM_CONFIGURED = !!process.env.NEXT_PUBLIC_AMM_CONTRACT_ID;

export default function SwapEventFeed() {
  const { events, isPolling } = useContractEvents();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Live Events</h2>
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium ${
            isPolling
              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          }`}
        >
          {isPolling ? "● Live" : "○ Connecting"}
        </span>
      </div>

      {!AMM_CONFIGURED ? (
        <p className="text-sm text-gray-400">AMM contract not configured.</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No recent events. Make a swap or add liquidity to see activity.
        </p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto">
          {events.map((event, i) => (
            <li
              key={i}
              className="flex items-start gap-3 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg text-xs"
            >
              <span className="mt-0.5 w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
              <div className="min-w-0">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {formatEventType(event.topic?.map(String) ?? [])}
                </span>
                {event.id && (
                  <p className="text-gray-400 truncate">{event.id}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
