/**
 * Dependency Injection Container
 *
 * Inspired by production DI patterns (InversifyJS/NestJS):
 * - Service registration with lifecycle (singleton/transient/scoped)
 * - Constructor injection via tokens
 * - Circular dependency detection
 * - Factory providers
 * - Lazy initialization
 *
 * Pattern: Register → Resolve → Inject → Lifecycle → Dispose
 */

export type ServiceLifetime = "singleton" | "transient" | "scoped";
export type Token<T = unknown> = string | symbol;

export interface ServiceDescriptor<T = unknown> {
  token: Token<T>;
  lifetime: ServiceLifetime;
  factory: (container: Container) => T;
  dependencies?: Token[];
}

export interface ContainerStats {
  registered: number;
  singletons: number;
  resolutions: number;
}

/**
 * IoC Container
 */
export class Container {
  private descriptors: Map<Token, ServiceDescriptor> = new Map();
  private singletonCache: Map<Token, unknown> = new Map();
  private scopedCache: Map<Token, unknown> = new Map();
  private resolutionStack: Set<Token> = new Set();
  private stats = { registered: 0, singletons: 0, resolutions: 0 };

  /**
   * Register a singleton service
   */
  singleton<T>(token: Token<T>, factory: (c: Container) => T): this {
    return this.register({ token, lifetime: "singleton", factory });
  }

  /**
   * Register a transient service (new instance each time)
   */
  transient<T>(token: Token<T>, factory: (c: Container) => T): this {
    return this.register({ token, lifetime: "transient", factory });
  }

  /**
   * Register a scoped service (one per scope)
   */
  scoped<T>(token: Token<T>, factory: (c: Container) => T): this {
    return this.register({ token, lifetime: "scoped", factory });
  }

  /**
   * Register a constant value
   */
  value<T>(token: Token<T>, value: T): this {
    return this.singleton(token, () => value);
  }

  /**
   * Resolve a service
   */
  resolve<T>(token: Token<T>): T {
    const descriptor = this.descriptors.get(token);
    if (!descriptor) {
      throw new Error(`Service not registered: ${String(token)}`);
    }

    // Circular dependency detection
    if (this.resolutionStack.has(token)) {
      const cycle = [...this.resolutionStack, token].map(String).join(" → ");
      throw new Error(`Circular dependency detected: ${cycle}`);
    }

    this.stats.resolutions++;
    this.resolutionStack.add(token);

    try {
      switch (descriptor.lifetime) {
        case "singleton": {
          if (!this.singletonCache.has(token)) {
            const instance = descriptor.factory(this);
            this.singletonCache.set(token, instance);
            this.stats.singletons++;
          }
          return this.singletonCache.get(token) as T;
        }
        case "scoped": {
          if (!this.scopedCache.has(token)) {
            const instance = descriptor.factory(this);
            this.scopedCache.set(token, instance);
          }
          return this.scopedCache.get(token) as T;
        }
        case "transient":
        default:
          return descriptor.factory(this) as T;
      }
    } finally {
      this.resolutionStack.delete(token);
    }
  }

  /**
   * Check if a token is registered
   */
  has(token: Token): boolean {
    return this.descriptors.has(token);
  }

  /**
   * Create a child scope (scoped services are isolated)
   */
  createScope(): Container {
    const scope = new Container();
    // Copy all descriptors to child
    for (const [token, descriptor] of this.descriptors.entries()) {
      scope.descriptors.set(token, descriptor);
    }
    // Singletons are shared
    scope.singletonCache = this.singletonCache;
    return scope;
  }

  /**
   * Clear scoped cache (end of scope)
   */
  endScope(): void {
    this.scopedCache.clear();
  }

  /**
   * Dispose all singleton instances that implement dispose()
   */
  async dispose(): Promise<void> {
    for (const instance of this.singletonCache.values()) {
      if (instance && typeof (instance as { dispose?: () => Promise<void> }).dispose === "function") {
        await (instance as { dispose: () => Promise<void> }).dispose();
      }
    }
    this.singletonCache.clear();
    this.scopedCache.clear();
  }

  /**
   * Get container statistics
   */
  getStats(): ContainerStats {
    return {
      registered: this.descriptors.size,
      singletons: this.singletonCache.size,
      resolutions: this.stats.resolutions,
    };
  }

  private register<T>(descriptor: ServiceDescriptor<T>): this {
    this.descriptors.set(descriptor.token, descriptor as ServiceDescriptor);
    this.stats.registered++;
    return this;
  }
}
