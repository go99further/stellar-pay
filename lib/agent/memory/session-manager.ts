/**
 * Session Manager
 *
 * Inspired by claw-code's session management pattern:
 * - Persistent session state across requests
 * - Context compression for long conversations
 * - Automatic cleanup of stale sessions
 * - Session recovery on reconnection
 *
 * Pattern: Create → Update → Compress → Persist → Recover
 */

export interface SessionState {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  context: SessionContext;
  metadata: Record<string, unknown>;
}

export interface SessionContext {
  conversationHistory: Message[];
  pendingOperations: PendingOperation[];
  userPreferences: UserPreferences;
  agentState: AgentState;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PendingOperation {
  id: string;
  type: "swap" | "add_liquidity" | "remove_liquidity";
  status: "pending" | "confirmed" | "executing" | "completed" | "failed";
  data: Record<string, unknown>;
  createdAt: number;
}

export interface UserPreferences {
  defaultSlippage: number;
  defaultDeadline: number;
  autoConfirm: boolean;
  theme: "light" | "dark";
}

export interface AgentState {
  currentIntent?: string;
  lastToolCalls: string[];
  errorCount: number;
  successCount: number;
}

export interface SessionConfig {
  maxHistorySize: number;
  sessionTimeout: number; // milliseconds
  compressionThreshold: number; // number of messages before compression
  storageKey: string;
}

/**
 * Session Manager
 * Manages user sessions with automatic compression and persistence
 */
export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private config: SessionConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<SessionConfig> = {}) {
    this.config = {
      maxHistorySize: 50,
      sessionTimeout: 1000 * 60 * 60 * 24, // 24 hours
      compressionThreshold: 20,
      storageKey: "stellar-pay-sessions",
      ...config,
    };

    this.loadFromStorage();
    this.startCleanupTimer();
  }

  /**
   * Create a new session
   */
  createSession(userId: string, metadata: Record<string, unknown> = {}): SessionState {
    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: SessionState = {
      sessionId,
      userId,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + this.config.sessionTimeout,
      context: {
        conversationHistory: [],
        pendingOperations: [],
        userPreferences: this.getDefaultPreferences(),
        agentState: {
          lastToolCalls: [],
          errorCount: 0,
          successCount: 0,
        },
      },
      metadata,
    };

    this.sessions.set(sessionId, session);
    this.persistToStorage();

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionState | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session expired
    if (Date.now() > session.expiresAt) {
      this.deleteSession(sessionId);
      return null;
    }

    // Update last accessed time
    session.lastAccessedAt = Date.now();
    session.expiresAt = Date.now() + this.config.sessionTimeout;

    return session;
  }

  /**
   * Update session context
   */
  updateSession(sessionId: string, updates: Partial<SessionContext>): boolean {
    const session = this.getSession(sessionId);

    if (!session) {
      return false;
    }

    session.context = {
      ...session.context,
      ...updates,
    };

    // Check if compression is needed
    if (
      session.context.conversationHistory.length >= this.config.compressionThreshold
    ) {
      this.compressSession(sessionId);
    }

    this.persistToStorage();
    return true;
  }

  /**
   * Add message to conversation history
   */
  addMessage(sessionId: string, message: Message): boolean {
    const session = this.getSession(sessionId);

    if (!session) {
      return false;
    }

    session.context.conversationHistory.push(message);

    // Trim history if too long
    if (session.context.conversationHistory.length > this.config.maxHistorySize) {
      session.context.conversationHistory = session.context.conversationHistory.slice(
        -this.config.maxHistorySize
      );
    }

    this.persistToStorage();
    return true;
  }

  /**
   * Add pending operation
   */
  addPendingOperation(sessionId: string, operation: Omit<PendingOperation, "id" | "createdAt">): string | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    const pendingOp: PendingOperation = {
      ...operation,
      id: this.generateOperationId(),
      createdAt: Date.now(),
    };

    session.context.pendingOperations.push(pendingOp);
    this.persistToStorage();

    return pendingOp.id;
  }

  /**
   * Update pending operation status
   */
  updatePendingOperation(
    sessionId: string,
    operationId: string,
    status: PendingOperation["status"]
  ): boolean {
    const session = this.getSession(sessionId);

    if (!session) {
      return false;
    }

    const operation = session.context.pendingOperations.find((op) => op.id === operationId);

    if (!operation) {
      return false;
    }

    operation.status = status;

    // Remove completed/failed operations after 1 hour
    if (status === "completed" || status === "failed") {
      setTimeout(() => {
        this.removePendingOperation(sessionId, operationId);
      }, 1000 * 60 * 60);
    }

    this.persistToStorage();
    return true;
  }

  /**
   * Remove pending operation
   */
  removePendingOperation(sessionId: string, operationId: string): boolean {
    const session = this.getSession(sessionId);

    if (!session) {
      return false;
    }

    const index = session.context.pendingOperations.findIndex((op) => op.id === operationId);

    if (index === -1) {
      return false;
    }

    session.context.pendingOperations.splice(index, 1);
    this.persistToStorage();

    return true;
  }

  /**
   * Compress session context
   * Summarize old messages to save space
   */
  private compressSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    const history = session.context.conversationHistory;

    if (history.length < this.config.compressionThreshold) {
      return;
    }

    // Keep last 10 messages, compress the rest
    const recentMessages = history.slice(-10);
    const oldMessages = history.slice(0, -10);

    // Create summary of old messages
    const summary: Message = {
      role: "assistant",
      content: `[Compressed ${oldMessages.length} messages from earlier conversation]`,
      timestamp: Date.now(),
      metadata: {
        compressed: true,
        originalCount: oldMessages.length,
      },
    };

    session.context.conversationHistory = [summary, ...recentMessages];
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.persistToStorage();
    }
    return deleted;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): SessionState[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.userId === userId
    );
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.persistToStorage();
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 1000 * 60 * 5);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Persist sessions to storage
   */
  private persistToStorage(): void {
    if (typeof localStorage === "undefined") {
      return; // Server-side, skip
    }

    try {
      const data = Array.from(this.sessions.entries());
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn("Failed to persist sessions:", error);
    }
  }

  /**
   * Load sessions from storage
   */
  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") {
      return; // Server-side, skip
    }

    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) return;

      const data = JSON.parse(raw) as Array<[string, SessionState]>;
      this.sessions = new Map(data);

      // Clean up expired sessions on load
      this.cleanupExpiredSessions();
    } catch (error) {
      console.warn("Failed to load sessions:", error);
    }
  }

  /**
   * Get default user preferences
   */
  private getDefaultPreferences(): UserPreferences {
    return {
      defaultSlippage: 1.0, // 1%
      defaultDeadline: 300, // 5 minutes
      autoConfirm: false,
      theme: "light",
    };
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Get session statistics
   */
  getStatistics(): {
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    totalPendingOperations: number;
  } {
    const now = Date.now();
    let activeSessions = 0;
    let totalMessages = 0;
    let totalPendingOperations = 0;

    for (const session of this.sessions.values()) {
      if (now <= session.expiresAt) {
        activeSessions++;
      }
      totalMessages += session.context.conversationHistory.length;
      totalPendingOperations += session.context.pendingOperations.length;
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      totalMessages,
      totalPendingOperations,
    };
  }
}

/**
 * Global session manager instance
 */
export const sessionManager = new SessionManager();

/**
 * Usage example:
 *
 * // Create session
 * const session = sessionManager.createSession("user-123", { source: "web" });
 *
 * // Add messages
 * sessionManager.addMessage(session.sessionId, {
 *   role: "user",
 *   content: "Swap 10 TKNA for TKNB",
 *   timestamp: Date.now(),
 * });
 *
 * // Add pending operation
 * const opId = sessionManager.addPendingOperation(session.sessionId, {
 *   type: "swap",
 *   status: "pending",
 *   data: { amountIn: "10", tokenIn: "TKNA", tokenOut: "TKNB" },
 * });
 *
 * // Update operation status
 * sessionManager.updatePendingOperation(session.sessionId, opId, "completed");
 *
 * // Get session later
 * const retrieved = sessionManager.getSession(session.sessionId);
 * console.log("Conversation history:", retrieved?.context.conversationHistory);
 */
