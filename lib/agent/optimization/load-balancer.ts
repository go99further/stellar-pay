/**
 * Load Balancer
 *
 * Inspired by production traffic distribution patterns:
 * - Round-robin, weighted, least-connections strategies
 * - Health-aware routing (skip unhealthy endpoints)
 * - Sticky sessions via consistent hashing
 * - Per-endpoint statistics
 * - Circuit-breaker integration
 *
 * Pattern: Request → Select → Route → Track → Adapt
 */

export type BalancingStrategy = "round-robin" | "weighted" | "least-connections" | "random" | "consistent-hash";

export interface Endpoint {
  id: string;
  url: string;
  weight: number;       // 1-100, used by weighted strategy
  healthy: boolean;
  connections: number;  // active connections
  totalRequests: number;
  totalErrors: number;
  averageLatency: number;
  lastChecked: number;
}

export interface LoadBalancerConfig {
  strategy: BalancingStrategy;
  healthCheckInterval: number; // ms
  maxRetries: number;
  stickySessionTtl: number; // ms, 0 = disabled
}

export interface RouteResult {
  endpoint: Endpoint;
  attempt: number;
}

type HealthChecker = (endpoint: Endpoint) => Promise<boolean>;

/**
 * Load Balancer
 * Distributes requests across multiple endpoints
 */
export class LoadBalancer {
  private endpoints: Map<string, Endpoint> = new Map();
  private config: LoadBalancerConfig;
  private rrIndex = 0;
  private stickyMap: Map<string, { endpointId: string; expiresAt: number }> = new Map();
  private healthChecker?: HealthChecker;
  private healthCheckTimer?: NodeJS.Timeout;
  private latencyHistory: Map<string, number[]> = new Map();

  constructor(config: Partial<LoadBalancerConfig> = {}, healthChecker?: HealthChecker) {
    this.config = {
      strategy: "round-robin",
      healthCheckInterval: 30000,
      maxRetries: 3,
      stickySessionTtl: 0,
      ...config,
    };
    this.healthChecker = healthChecker;
    if (healthChecker && this.config.healthCheckInterval > 0) {
      this.startHealthChecks();
    }
  }

  /**
   * Register an endpoint
   */
  addEndpoint(id: string, url: string, weight = 50): void {
    this.endpoints.set(id, {
      id,
      url,
      weight,
      healthy: true,
      connections: 0,
      totalRequests: 0,
      totalErrors: 0,
      averageLatency: 0,
      lastChecked: Date.now(),
    });
    this.latencyHistory.set(id, []);
  }

  /**
   * Remove an endpoint
   */
  removeEndpoint(id: string): boolean {
    this.latencyHistory.delete(id);
    return this.endpoints.delete(id);
  }

  /**
   * Select an endpoint for a request
   */
  select(sessionKey?: string): Endpoint | null {
    const healthy = this.getHealthyEndpoints();
    if (healthy.length === 0) return null;

    // Sticky session
    if (sessionKey && this.config.stickySessionTtl > 0) {
      const sticky = this.stickyMap.get(sessionKey);
      if (sticky && sticky.expiresAt > Date.now()) {
        const ep = this.endpoints.get(sticky.endpointId);
        if (ep?.healthy) return ep;
      }
    }

    let selected: Endpoint;

    switch (this.config.strategy) {
      case "round-robin":
        selected = this.roundRobin(healthy);
        break;
      case "weighted":
        selected = this.weighted(healthy);
        break;
      case "least-connections":
        selected = this.leastConnections(healthy);
        break;
      case "random":
        selected = healthy[Math.floor(Math.random() * healthy.length)];
        break;
      case "consistent-hash":
        selected = sessionKey
          ? this.consistentHash(healthy, sessionKey)
          : this.roundRobin(healthy);
        break;
      default:
        selected = healthy[0];
    }

    // Store sticky session
    if (sessionKey && this.config.stickySessionTtl > 0) {
      this.stickyMap.set(sessionKey, {
        endpointId: selected.id,
        expiresAt: Date.now() + this.config.stickySessionTtl,
      });
    }

    return selected;
  }

  /**
   * Execute a request with automatic retry and failover
   */
  async execute<T>(
    fn: (endpoint: Endpoint) => Promise<T>,
    sessionKey?: string
  ): Promise<T> {
    const tried = new Set<string>();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const healthy = this.getHealthyEndpoints().filter((e) => !tried.has(e.id));
      if (healthy.length === 0) break;

      const endpoint = this.selectFrom(healthy, sessionKey);
      if (!endpoint) break;

      tried.add(endpoint.id);
      endpoint.connections++;
      endpoint.totalRequests++;
      const start = Date.now();

      try {
        const result = await fn(endpoint);
        const latency = Date.now() - start;
        this.recordLatency(endpoint.id, latency);
        endpoint.connections--;
        return result;
      } catch (err) {
        endpoint.connections--;
        endpoint.totalErrors++;
        lastError = err instanceof Error ? err : new Error(String(err));

        // Mark unhealthy after too many errors
        const errorRate = endpoint.totalErrors / endpoint.totalRequests;
        if (errorRate > 0.5 && endpoint.totalRequests >= 5) {
          endpoint.healthy = false;
        }
      }
    }

    throw lastError ?? new Error("No healthy endpoints available");
  }

  /**
   * Mark an endpoint healthy or unhealthy
   */
  setHealth(id: string, healthy: boolean): void {
    const ep = this.endpoints.get(id);
    if (ep) {
      ep.healthy = healthy;
      ep.lastChecked = Date.now();
    }
  }

  /**
   * Get all endpoints
   */
  getEndpoints(): Endpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get healthy endpoints
   */
  getHealthyEndpoints(): Endpoint[] {
    return Array.from(this.endpoints.values()).filter((e) => e.healthy);
  }

  /**
   * Get per-endpoint statistics
   */
  getStats(): Record<string, { requests: number; errors: number; errorRate: number; avgLatency: number; connections: number }> {
    const result: Record<string, { requests: number; errors: number; errorRate: number; avgLatency: number; connections: number }> = {};
    for (const ep of this.endpoints.values()) {
      result[ep.id] = {
        requests: ep.totalRequests,
        errors: ep.totalErrors,
        errorRate: ep.totalRequests > 0 ? ep.totalErrors / ep.totalRequests : 0,
        avgLatency: ep.averageLatency,
        connections: ep.connections,
      };
    }
    return result;
  }

  /**
   * Stop health check timer
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }

  private roundRobin(endpoints: Endpoint[]): Endpoint {
    const ep = endpoints[this.rrIndex % endpoints.length];
    this.rrIndex = (this.rrIndex + 1) % endpoints.length;
    return ep;
  }

  private weighted(endpoints: Endpoint[]): Endpoint {
    const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const ep of endpoints) {
      rand -= ep.weight;
      if (rand <= 0) return ep;
    }
    return endpoints[endpoints.length - 1];
  }

  private leastConnections(endpoints: Endpoint[]): Endpoint {
    return endpoints.reduce((min, ep) => (ep.connections < min.connections ? ep : min));
  }

  private consistentHash(endpoints: Endpoint[], key: string): Endpoint {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return endpoints[hash % endpoints.length];
  }

  private selectFrom(endpoints: Endpoint[], sessionKey?: string): Endpoint | null {
    if (endpoints.length === 0) return null;
    switch (this.config.strategy) {
      case "round-robin": return this.roundRobin(endpoints);
      case "weighted": return this.weighted(endpoints);
      case "least-connections": return this.leastConnections(endpoints);
      case "random": return endpoints[Math.floor(Math.random() * endpoints.length)];
      case "consistent-hash": return sessionKey ? this.consistentHash(endpoints, sessionKey) : this.roundRobin(endpoints);
      default: return endpoints[0];
    }
  }

  private recordLatency(id: string, latency: number): void {
    const history = this.latencyHistory.get(id) ?? [];
    history.push(latency);
    if (history.length > 100) history.shift();
    this.latencyHistory.set(id, history);

    const ep = this.endpoints.get(id);
    if (ep) {
      ep.averageLatency = history.reduce((a, b) => a + b, 0) / history.length;
    }
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      for (const ep of this.endpoints.values()) {
        try {
          const healthy = await this.healthChecker!(ep);
          ep.healthy = healthy;
          ep.lastChecked = Date.now();
        } catch {
          ep.healthy = false;
        }
      }
    }, this.config.healthCheckInterval);
  }
}
