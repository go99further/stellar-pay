/**
 * Heartbeat Mechanism
 *
 * Inspired by Plandex's connection health monitoring:
 * - Periodic health checks
 * - Connection state tracking
 * - Automatic reconnection
 * - Latency monitoring
 * - Failure detection
 *
 * Pattern: Ping → Monitor → Detect → Reconnect → Report
 */

export interface HeartbeatConfig {
  interval: number; // Milliseconds between heartbeats
  timeout: number; // Milliseconds before considering failed
  maxFailures: number; // Max consecutive failures before disconnect
  reconnectDelay: number; // Milliseconds before reconnect attempt
  maxReconnectAttempts: number; // Max reconnection attempts
}

export interface HeartbeatStatus {
  connected: boolean;
  lastHeartbeat: number;
  consecutiveFailures: number;
  averageLatency: number;
  uptime: number;
  reconnectAttempts: number;
}

export interface HeartbeatEvent {
  type: "heartbeat" | "failure" | "reconnect" | "disconnect";
  timestamp: number;
  latency?: number;
  error?: string;
}

export type HeartbeatCallback = (event: HeartbeatEvent) => void;

/**
 * Heartbeat Monitor
 * Monitors connection health with periodic heartbeats
 */
export class HeartbeatMonitor {
  private config: HeartbeatConfig;
  private status: HeartbeatStatus;
  private intervalId: NodeJS.Timeout | null = null;
  private callbacks: Set<HeartbeatCallback> = new Set();
  private latencyHistory: number[] = [];
  private startTime: number = 0;
  private pingFunction: () => Promise<void>;

  constructor(
    pingFunction: () => Promise<void>,
    config: Partial<HeartbeatConfig> = {}
  ) {
    this.pingFunction = pingFunction;
    this.config = {
      interval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      maxFailures: 3,
      reconnectDelay: 5000, // 5 seconds
      maxReconnectAttempts: 5,
      ...config,
    };

    this.status = {
      connected: false,
      lastHeartbeat: 0,
      consecutiveFailures: 0,
      averageLatency: 0,
      uptime: 0,
      reconnectAttempts: 0,
    };
  }

  /**
   * Start heartbeat monitoring
   */
  start(): void {
    if (this.intervalId) return;

    this.startTime = Date.now();
    this.status.connected = true;
    this.status.consecutiveFailures = 0;
    this.status.reconnectAttempts = 0;

    // Send initial heartbeat
    this.sendHeartbeat();

    // Schedule periodic heartbeats
    this.intervalId = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.interval);
  }

  /**
   * Stop heartbeat monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.status.connected = false;
    this.emit({
      type: "disconnect",
      timestamp: Date.now(),
    });
  }

  /**
   * Send heartbeat ping
   */
  private async sendHeartbeat(): Promise<void> {
    const startTime = Date.now();

    try {
      // Execute ping with timeout
      await this.withTimeout(this.pingFunction(), this.config.timeout);

      const latency = Date.now() - startTime;

      // Update status
      this.status.lastHeartbeat = Date.now();
      this.status.consecutiveFailures = 0;
      this.status.connected = true;

      // Track latency
      this.latencyHistory.push(latency);
      if (this.latencyHistory.length > 10) {
        this.latencyHistory.shift();
      }
      this.status.averageLatency = this.calculateAverageLatency();

      // Update uptime
      this.status.uptime = Date.now() - this.startTime;

      // Emit success event
      this.emit({
        type: "heartbeat",
        timestamp: Date.now(),
        latency,
      });
    } catch (error) {
      this.handleFailure(error);
    }
  }

  /**
   * Handle heartbeat failure
   */
  private handleFailure(error: unknown): void {
    this.status.consecutiveFailures++;

    const errorMessage = error instanceof Error ? error.message : String(error);

    this.emit({
      type: "failure",
      timestamp: Date.now(),
      error: errorMessage,
    });

    // Check if we should disconnect
    if (this.status.consecutiveFailures >= this.config.maxFailures) {
      this.status.connected = false;
      this.emit({
        type: "disconnect",
        timestamp: Date.now(),
        error: `Max failures reached: ${this.status.consecutiveFailures}`,
      });

      // Attempt reconnection
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect
   */
  private async attemptReconnect(): Promise<void> {
    if (this.status.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.stop();
      return;
    }

    this.status.reconnectAttempts++;

    // Wait before reconnecting
    await this.sleep(this.config.reconnectDelay);

    this.emit({
      type: "reconnect",
      timestamp: Date.now(),
    });

    // Reset failure count and try again
    this.status.consecutiveFailures = 0;
    this.sendHeartbeat();
  }

  /**
   * Subscribe to heartbeat events
   */
  on(callback: HeartbeatCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Emit event to all subscribers
   */
  private emit(event: HeartbeatEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error("Heartbeat callback error:", error);
      }
    }
  }

  /**
   * Get current status
   */
  getStatus(): HeartbeatStatus {
    return { ...this.status };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status.connected;
  }

  /**
   * Get latency history
   */
  getLatencyHistory(): number[] {
    return [...this.latencyHistory];
  }

  /**
   * Calculate average latency
   */
  private calculateAverageLatency(): number {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }

  /**
   * Execute promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("Heartbeat timeout")), timeoutMs)
      ),
    ]);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart if running
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }
}

/**
 * Multi-connection Heartbeat Manager
 * Manages heartbeats for multiple connections
 */
export class HeartbeatManager {
  private monitors: Map<string, HeartbeatMonitor> = new Map();

  /**
   * Add a connection to monitor
   */
  addConnection(
    name: string,
    pingFunction: () => Promise<void>,
    config?: Partial<HeartbeatConfig>
  ): void {
    if (this.monitors.has(name)) {
      throw new Error(`Connection "${name}" already exists`);
    }

    const monitor = new HeartbeatMonitor(pingFunction, config);
    this.monitors.set(name, monitor);
    monitor.start();
  }

  /**
   * Remove a connection
   */
  removeConnection(name: string): boolean {
    const monitor = this.monitors.get(name);
    if (!monitor) return false;

    monitor.stop();
    this.monitors.delete(name);
    return true;
  }

  /**
   * Get monitor for connection
   */
  getMonitor(name: string): HeartbeatMonitor | null {
    return this.monitors.get(name) || null;
  }

  /**
   * Get status for all connections
   */
  getAllStatus(): Record<string, HeartbeatStatus> {
    const status: Record<string, HeartbeatStatus> = {};
    for (const [name, monitor] of this.monitors.entries()) {
      status[name] = monitor.getStatus();
    }
    return status;
  }

  /**
   * Check if all connections are healthy
   */
  isHealthy(): boolean {
    for (const monitor of this.monitors.values()) {
      if (!monitor.isConnected()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Stop all monitors
   */
  stopAll(): void {
    for (const monitor of this.monitors.values()) {
      monitor.stop();
    }
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    totalConnections: number;
    connectedCount: number;
    disconnectedCount: number;
    averageLatency: number;
  } {
    const statuses = Array.from(this.monitors.values()).map((m) => m.getStatus());

    return {
      totalConnections: this.monitors.size,
      connectedCount: statuses.filter((s) => s.connected).length,
      disconnectedCount: statuses.filter((s) => !s.connected).length,
      averageLatency:
        statuses.reduce((sum, s) => sum + s.averageLatency, 0) / statuses.length || 0,
    };
  }
}

/**
 * Global heartbeat manager
 */
export const heartbeatManager = new HeartbeatManager();

/**
 * Usage example:
 *
 * // Single connection
 * const monitor = new HeartbeatMonitor(
 *   async () => {
 *     await fetch("https://api.example.com/ping");
 *   },
 *   {
 *     interval: 30000,
 *     timeout: 5000,
 *     maxFailures: 3,
 *   }
 * );
 *
 * monitor.on((event) => {
 *   console.log("Heartbeat event:", event.type);
 *   if (event.type === "failure") {
 *     console.error("Heartbeat failed:", event.error);
 *   }
 * });
 *
 * monitor.start();
 *
 * // Multiple connections
 * heartbeatManager.addConnection("rpc", async () => {
 *   await stellarClient.ping();
 * });
 *
 * heartbeatManager.addConnection("api", async () => {
 *   await apiClient.healthCheck();
 * });
 *
 * console.log("All healthy:", heartbeatManager.isHealthy());
 * console.log("Status:", heartbeatManager.getAllStatus());
 */
