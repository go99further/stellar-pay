/**
 * Loop detection for agent tool-call sequences.
 *
 * Two detection modes (mirrors SWE-agent + Aider patterns):
 *   1. Consecutive identical calls — same (name, inputHash) 3 times in a row → LoopDetectedError
 *   2. Repeating sequence — a window of N calls appears twice in a row → LoopDetectedError
 *
 * Usage: create one LoopDetector per agent run, call record() before executing each tool.
 */

export class LoopDetectedError extends Error {
  constructor(
    public readonly kind: "consecutive" | "sequence",
    public readonly detail: string
  ) {
    super(`Loop detected (${kind}): ${detail}`);
    this.name = "LoopDetectedError";
  }
}

interface CallRecord {
  name: string;
  hash: string;
}

/** FNV-1a 32-bit — fast, no crypto dependency, good enough for loop detection */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16).padStart(8, "0");
}

function hashInput(input: unknown): string {
  try {
    return fnv1a(JSON.stringify(input) ?? "");
  } catch {
    return fnv1a(String(input));
  }
}

export class LoopDetector {
  private readonly window: CallRecord[] = [];

  constructor(
    /** How many consecutive identical calls trigger the error (default: 3) */
    private readonly maxConsecutive: number = 3,
    /** Sequence length to check for repetition (default: 4) */
    private readonly sequenceLen: number = 4
  ) {}

  /**
   * Record a tool call. Throws LoopDetectedError if a loop is detected.
   * Call this before executing the tool.
   */
  record(name: string, input: unknown): void {
    const hash = hashInput(input);
    this.window.push({ name, hash });

    // Keep window bounded — we only need 2 * sequenceLen + maxConsecutive entries
    const maxWindow = Math.max(this.maxConsecutive, this.sequenceLen * 2) + 4;
    if (this.window.length > maxWindow) {
      this.window.splice(0, this.window.length - maxWindow);
    }

    this.checkConsecutive(name, hash);
    this.checkSequence();
  }

  private checkConsecutive(name: string, hash: string): void {
    const len = this.window.length;
    if (len < this.maxConsecutive) return;

    for (let i = len - this.maxConsecutive; i < len; i++) {
      const r = this.window[i];
      if (r.name !== name || r.hash !== hash) return;
    }

    throw new LoopDetectedError(
      "consecutive",
      `"${name}" called ${this.maxConsecutive} times in a row with identical input`
    );
  }

  private checkSequence(): void {
    const len = this.window.length;
    if (len < this.sequenceLen * 2) return;

    const key = (r: CallRecord) => `${r.name}:${r.hash}`;

    // Compare the last sequenceLen calls against the sequenceLen calls before them
    const recent = this.window.slice(len - this.sequenceLen).map(key).join("|");
    const prior = this.window.slice(len - this.sequenceLen * 2, len - this.sequenceLen).map(key).join("|");

    if (recent === prior) {
      const names = this.window.slice(len - this.sequenceLen).map(r => r.name).join(" → ");
      throw new LoopDetectedError(
        "sequence",
        `sequence [${names}] repeated twice in a row`
      );
    }
  }

  /** Reset state (e.g. after a successful tool result breaks the pattern) */
  reset(): void {
    this.window.length = 0;
  }
}
