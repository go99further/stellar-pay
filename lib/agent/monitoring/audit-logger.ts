/**
 * Audit Logger
 *
 * Inspired by compliance and security best practices:
 * - Immutable audit trail
 * - Structured log entries
 * - Tamper detection via chaining
 * - Query and export capabilities
 * - Retention policies
 *
 * Pattern: Action → Record → Chain → Store → Query
 */

export type AuditAction =
  | "swap_initiated"
  | "swap_completed"
  | "swap_failed"
  | "liquidity_added"
  | "liquidity_removed"
  | "price_alert_triggered"
  | "config_changed"
  | "permission_granted"
  | "permission_revoked"
  | "session_started"
  | "session_ended"
  | "error_occurred"
  | "recovery_attempted"
  | "circuit_breaker_opened"
  | "circuit_breaker_closed";

export interface AuditEntry {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly action: AuditAction;
  readonly actor: string;
  readonly resource: string;
  readonly outcome: "success" | "failure" | "pending";
  readonly details: Record<string, unknown>;
  readonly previousHash: string;
  readonly hash: string;
}

export interface AuditQuery {
  action?: AuditAction;
  actor?: string;
  resource?: string;
  outcome?: AuditEntry["outcome"];
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface AuditReport {
  entries: AuditEntry[];
  summary: {
    total: number;
    byAction: Record<string, number>;
    byOutcome: Record<string, number>;
    byActor: Record<string, number>;
    timeRange: { start: number; end: number };
  };
  integrityValid: boolean;
}

/**
 * Audit Logger
 * Immutable, tamper-evident audit trail
 */
export class AuditLogger {
  private entries: AuditEntry[] = [];
  private sequence = 0;
  private maxEntries = 10000;

  /**
   * Log an audit event
   */
  log(
    action: AuditAction,
    actor: string,
    resource: string,
    outcome: AuditEntry["outcome"],
    details: Record<string, unknown> = {}
  ): AuditEntry {
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].hash
      : "genesis";

    const entry: Omit<AuditEntry, "hash"> = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      sequence: ++this.sequence,
      timestamp: Date.now(),
      action,
      actor,
      resource,
      outcome,
      details,
      previousHash,
    };

    const hash = this.computeHash(entry);
    const finalEntry: AuditEntry = { ...entry, hash };

    this.entries.push(finalEntry);

    // Trim if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return finalEntry;
  }

  /**
   * Query audit entries
   */
  query(q: AuditQuery = {}): AuditEntry[] {
    let results = [...this.entries];

    if (q.action) results = results.filter((e) => e.action === q.action);
    if (q.actor) results = results.filter((e) => e.actor === q.actor);
    if (q.resource) results = results.filter((e) => e.resource === q.resource);
    if (q.outcome) results = results.filter((e) => e.outcome === q.outcome);
    if (q.startTime) results = results.filter((e) => e.timestamp >= q.startTime!);
    if (q.endTime) results = results.filter((e) => e.timestamp <= q.endTime!);

    results.sort((a, b) => b.timestamp - a.timestamp);

    if (q.limit) results = results.slice(0, q.limit);

    return results;
  }

  /**
   * Generate audit report
   */
  generateReport(q: AuditQuery = {}): AuditReport {
    const entries = this.query(q);

    const byAction: Record<string, number> = {};
    const byOutcome: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    let minTime = Infinity;
    let maxTime = 0;

    for (const entry of entries) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byOutcome[entry.outcome] = (byOutcome[entry.outcome] || 0) + 1;
      byActor[entry.actor] = (byActor[entry.actor] || 0) + 1;
      minTime = Math.min(minTime, entry.timestamp);
      maxTime = Math.max(maxTime, entry.timestamp);
    }

    return {
      entries,
      summary: {
        total: entries.length,
        byAction,
        byOutcome,
        byActor,
        timeRange: { start: minTime === Infinity ? 0 : minTime, end: maxTime },
      },
      integrityValid: this.verifyIntegrity(),
    };
  }

  /**
   * Verify chain integrity
   */
  verifyIntegrity(): boolean {
    for (let i = 1; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const prev = this.entries[i - 1];

      if (entry.previousHash !== prev.hash) return false;

      const { hash, ...rest } = entry;
      if (this.computeHash(rest) !== hash) return false;
    }
    return true;
  }

  /**
   * Export as JSON
   */
  export(): string {
    return JSON.stringify({ entries: this.entries, exportedAt: Date.now() }, null, 2);
  }

  /**
   * Get recent entries
   */
  getRecent(limit = 20): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  /**
   * Compute hash for entry
   */
  private computeHash(entry: Omit<AuditEntry, "hash">): string {
    const str = JSON.stringify(entry);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Global audit logger
 */
export const auditLogger = new AuditLogger();
