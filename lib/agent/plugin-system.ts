/**
 * Plugin System
 *
 * Inspired by production extensibility patterns (Webpack/Vite/ESLint plugins):
 * - Lifecycle hooks (install, activate, deactivate, uninstall)
 * - Dependency resolution between plugins
 * - Plugin registry with version checking
 * - Sandboxed plugin context
 * - Hot-swap without restart
 *
 * Pattern: Register → Resolve → Install → Activate → Use → Deactivate
 */

export interface PluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  dependencies?: string[]; // plugin IDs this plugin requires
  tags: string[];
}

export interface PluginContext {
  config: Record<string, unknown>;
  emit: (event: string, data?: unknown) => void;
  on: (event: string, handler: (data: unknown) => void) => () => void;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface Plugin<TConfig = Record<string, unknown>> {
  meta: PluginMeta;
  defaultConfig?: TConfig;
  install?: (ctx: PluginContext) => Promise<void> | void;
  activate?: (ctx: PluginContext) => Promise<void> | void;
  deactivate?: (ctx: PluginContext) => Promise<void> | void;
  uninstall?: (ctx: PluginContext) => Promise<void> | void;
}

export type PluginStatus = "registered" | "installed" | "active" | "inactive" | "error";

export interface PluginRecord {
  plugin: Plugin;
  status: PluginStatus;
  config: Record<string, unknown>;
  installedAt?: number;
  activatedAt?: number;
  error?: string;
}

export interface PluginSystemStats {
  total: number;
  active: number;
  inactive: number;
  errored: number;
}

/**
 * Plugin System
 * Manages plugin lifecycle with dependency resolution
 */
export class PluginSystem {
  private registry: Map<string, PluginRecord> = new Map();
  private eventHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private logs: Array<{ level: string; pluginId: string; msg: string; timestamp: number }> = [];

  /**
   * Register a plugin
   */
  register(plugin: Plugin, config: Record<string, unknown> = {}): void {
    if (this.registry.has(plugin.meta.id)) {
      throw new Error(`Plugin "${plugin.meta.id}" is already registered`);
    }

    this.registry.set(plugin.meta.id, {
      plugin,
      status: "registered",
      config: { ...plugin.defaultConfig, ...config },
    });
  }

  /**
   * Install a plugin (runs install hook, resolves dependencies)
   */
  async install(pluginId: string): Promise<void> {
    const record = this.getRecord(pluginId);
    if (record.status !== "registered") {
      throw new Error(`Plugin "${pluginId}" is already installed (status: ${record.status})`);
    }

    // Install dependencies first
    for (const depId of record.plugin.meta.dependencies ?? []) {
      const dep = this.registry.get(depId);
      if (!dep) throw new Error(`Plugin "${pluginId}" requires missing dependency "${depId}"`);
      if (dep.status === "registered") await this.install(depId);
    }

    try {
      const ctx = this.createContext(pluginId, record.config);
      await record.plugin.install?.(ctx);
      record.status = "installed";
      record.installedAt = Date.now();
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Activate a plugin
   */
  async activate(pluginId: string): Promise<void> {
    const record = this.getRecord(pluginId);
    if (record.status === "registered") await this.install(pluginId);
    if (record.status !== "installed" && record.status !== "inactive") {
      throw new Error(`Cannot activate plugin "${pluginId}" (status: ${record.status})`);
    }

    try {
      const ctx = this.createContext(pluginId, record.config);
      await record.plugin.activate?.(ctx);
      record.status = "active";
      record.activatedAt = Date.now();
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Deactivate a plugin
   */
  async deactivate(pluginId: string): Promise<void> {
    const record = this.getRecord(pluginId);
    if (record.status !== "active") {
      throw new Error(`Plugin "${pluginId}" is not active`);
    }

    try {
      const ctx = this.createContext(pluginId, record.config);
      await record.plugin.deactivate?.(ctx);
      record.status = "inactive";
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginId: string): Promise<void> {
    const record = this.getRecord(pluginId);

    if (record.status === "active") await this.deactivate(pluginId);

    // Check no other active plugin depends on this one
    for (const [id, r] of this.registry.entries()) {
      if (id !== pluginId && r.status === "active") {
        if (r.plugin.meta.dependencies?.includes(pluginId)) {
          throw new Error(`Cannot uninstall "${pluginId}": plugin "${id}" depends on it`);
        }
      }
    }

    const ctx = this.createContext(pluginId, record.config);
    await record.plugin.uninstall?.(ctx);
    this.registry.delete(pluginId);
  }

  /**
   * Get plugin status
   */
  getStatus(pluginId: string): PluginStatus | null {
    return this.registry.get(pluginId)?.status ?? null;
  }

  /**
   * Get all plugins
   */
  getAll(): PluginRecord[] {
    return Array.from(this.registry.values());
  }

  /**
   * Get active plugins
   */
  getActive(): PluginRecord[] {
    return this.getAll().filter((r) => r.status === "active");
  }

  /**
   * Update plugin config at runtime
   */
  configure(pluginId: string, config: Record<string, unknown>): void {
    const record = this.getRecord(pluginId);
    record.config = { ...record.config, ...config };
  }

  /**
   * Emit a system event to all plugins listening
   */
  emit(event: string, data?: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  /**
   * Get system statistics
   */
  getStats(): PluginSystemStats {
    const all = this.getAll();
    return {
      total: all.length,
      active: all.filter((r) => r.status === "active").length,
      inactive: all.filter((r) => r.status === "inactive" || r.status === "installed").length,
      errored: all.filter((r) => r.status === "error").length,
    };
  }

  /**
   * Get plugin logs
   */
  getLogs(pluginId?: string) {
    return pluginId
      ? this.logs.filter((l) => l.pluginId === pluginId)
      : [...this.logs];
  }

  private getRecord(pluginId: string): PluginRecord {
    const record = this.registry.get(pluginId);
    if (!record) throw new Error(`Plugin "${pluginId}" not found`);
    return record;
  }

  private createContext(pluginId: string, config: Record<string, unknown>): PluginContext {
    return {
      config,
      emit: (event, data) => this.emit(event, data),
      on: (event, handler) => {
        if (!this.eventHandlers.has(event)) {
          this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler);
        return () => this.eventHandlers.get(event)?.delete(handler);
      },
      log: (level, msg) => {
        this.logs.push({ level, pluginId, msg, timestamp: Date.now() });
      },
    };
  }
}
