"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchContractEvents, getContractId } from "@/lib/poll-contract";

export interface ContractEvent {
  id: string;
  type: string;
  ledger: number;
  topic: string[];
  value: string;
  timestamp: number;
}

export function useContractEvents(pollInterval = 5000) {
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const lastLedger = useRef(0);

  const poll = useCallback(async () => {
    if (!getContractId()) return;

    try {
      const result = await fetchContractEvents(
        lastLedger.current || undefined
      );

      if (result.events.length > 0) {
        const newEvents: ContractEvent[] = result.events.map(
          (evt: { id: string; type: string; topic: unknown[]; value: unknown }, i: number) => ({
            id: `${evt.id || i}-${Date.now()}`,
            type: evt.type,
            ledger: result.latestLedger,
            topic: evt.topic?.map((t: unknown) => String(t)) || [],
            value: String(evt.value || ""),
            timestamp: Date.now(),
          })
        );

        setEvents((prev) => [...newEvents, ...prev].slice(0, 50));
      }

      lastLedger.current = result.latestLedger;
    } catch {
      // Silently fail on polling errors
    }
  }, []);

  useEffect(() => {
    if (!getContractId()) return;

    setIsPolling(true);
    poll(); // Initial fetch

    const interval = setInterval(poll, pollInterval);
    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [poll, pollInterval]);

  return { events, isPolling };
}
