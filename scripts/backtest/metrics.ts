import type { RiskLevel } from "../../lib/agent/security-core";

export interface DetectorResult {
  scenarioId: string;
  detector: "priceImpact" | "liquidityFlow" | "anomaly" | "sandwich";
  expected: RiskLevel | undefined;
  actual: RiskLevel;
  match: boolean;
  details?: Record<string, unknown>;
}

export interface SetMetrics {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

/**
 * Treat "medium" and "high" as positive (alert), "low" as negative (no alert).
 * Compare expected vs actual to build a confusion matrix.
 */
export function computeSetMetrics(results: DetectorResult[]): SetMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of results) {
    if (r.expected === undefined) continue;
    const expectedPositive = r.expected !== "low";
    const actualPositive = r.actual !== "low";
    if (expectedPositive && actualPositive) tp++;
    else if (!expectedPositive && actualPositive) fp++;
    else if (expectedPositive && !actualPositive) fn++;
    else tn++;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn, tn };
}

export function setSimilarity(expected: string[], actual: string[]): {
  jaccard: number;
  missed: string[];
  extra: string[];
} {
  const e = new Set(expected);
  const a = new Set(actual);
  const intersection = [...e].filter((x) => a.has(x));
  const union = new Set([...e, ...a]);
  const jaccard = union.size === 0 ? 1 : intersection.length / union.size;
  const missed = [...e].filter((x) => !a.has(x));
  const extra = [...a].filter((x) => !e.has(x));
  return { jaccard, missed, extra };
}
