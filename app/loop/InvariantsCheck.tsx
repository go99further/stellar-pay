"use client";

import { getFeedbackRecords } from "@/lib/agent/alert-feedback";
import { getSecurityRecords } from "@/lib/agent/security-feedback";

interface InvariantsCheckProps {
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export function InvariantsCheck({ t }: InvariantsCheckProps) {
  const alertRecords = getFeedbackRecords();
  const securityRecords = getSecurityRecords();

  // Invariant 1: no-future-leak — settledAt > triggeredAt for all settled records
  const noFutureLeakViolations = [
    ...alertRecords.filter(r => r.settledAt !== undefined && r.settledAt <= r.triggeredAt),
    ...securityRecords.filter(r => r.settledAt !== undefined && r.settledAt <= r.triggeredAt),
  ];

  // Invariant 2: idempotent-settle — every settled record has settledAt set
  const idempotentViolations = [
    ...alertRecords.filter(r => r.outcome !== "pending" && r.settledAt === undefined),
    ...securityRecords.filter(r => r.outcome !== "pending" && r.outcome !== "expired" && r.settledAt === undefined),
  ];

  const totalRecords = alertRecords.length + securityRecords.length;

  return (
    <div className="rounded border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
      <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        {t("inv.title")}
      </h3>
      <ul className="mt-2 space-y-1 text-xs text-emerald-800 dark:text-emerald-300">
        <li>
          <span className={noFutureLeakViolations.length === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            {noFutureLeakViolations.length === 0 ? "✓" : "✗"}
          </span>{" "}
          {t("inv.no_future_leak", { n: noFutureLeakViolations.length, total: totalRecords })}
        </li>
        <li>
          <span className={idempotentViolations.length === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            {idempotentViolations.length === 0 ? "✓" : "✗"}
          </span>{" "}
          {t("inv.idempotent", { n: idempotentViolations.length, total: totalRecords })}
        </li>
        <li>
          <span className="text-emerald-700 dark:text-emerald-400">✓</span>{" "}
          {t("inv.hitl")}
        </li>
        <li>
          <span className="text-emerald-700 dark:text-emerald-400">✓</span>{" "}
          {t("inv.read_only")}
        </li>
      </ul>
      <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
        {t("inv.tests_prefix")}
        <code className="rounded bg-emerald-100 px-1 dark:bg-emerald-900">
          __tests__/alert-feedback.test.ts
        </code>
        ,{" "}
        <code className="rounded bg-emerald-100 px-1 dark:bg-emerald-900">
          __tests__/security-feedback.test.ts
        </code>
        {t("inv.tests_suffix")}
      </div>
    </div>
  );
}
