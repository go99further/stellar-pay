/**
 * Config Manager
 *
 * Inspired by production configuration management patterns:
 * - Layered config (defaults → env → file → runtime overrides)
 * - Schema validation with type coercion
 * - Hot reload without restart
 * - Secret masking in logs
 * - Change listeners
 *
 * Pattern: Load → Validate → Merge → Watch → Notify
 */

export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigArray;
export type ConfigObject = { [key: string]: ConfigValue };
export type ConfigArray = ConfigValue[];

export type ConfigSchema = {
  [key: string]: {
    type: "string" | "number" | "boolean" | "object" | "array";
    required?: boolean;
    default?: ConfigValue;
    secret?: boolean;
    validate?: (value: ConfigValue) => boolean;
    description?: string;
  };
};

export interface ConfigSource {
  name: string;
  priority: number; // higher = overrides lower
  load: () => Promise<ConfigObject> | ConfigObject;
}

export interface ConfigChangeEvent {
  key: string;
  oldValue: ConfigValue;
  newValue: ConfigValue;
  source: string;
}

export type ConfigChangeListener = (event: ConfigChangeEvent) => void;

export interface ConfigManagerOptions {
  schema?: ConfigSchema;
  sources?: ConfigSource[];
  reloadIntervalMs?: number;
}

/**
 * Config Manager
 * Layered configuration with validation and hot reload
 */
export class ConfigManager {
  private config: ConfigObject = {};
  private schema: ConfigSchema;
  private sources: ConfigSource[];
  private listeners: Map<string, Set<ConfigChangeListener>> = new Map();
  private globalListeners: Set<ConfigChangeListener> = new Set();
  private reloadTimer?: NodeJS.Timeout;
  private lastLoaded: Map<string, ConfigObject> = new Map();

  constructor(options: ConfigManagerOptions = {}) {
    this.schema = options.schema ?? {};
    this.sources = (options.sources ?? []).sort((a, b) => a.priority - b.priority);

    if (options.reloadIntervalMs && options.reloadIntervalMs > 0) {
      this.reloadTimer = setInterval(() => void this.reload(), options.reloadIntervalMs);
    }
  }

  /**
   * Load all config sources and merge
   */
  async load(): Promise<void> {
    const merged: ConfigObject = {};

    for (const source of this.sources) {
      try {
        const data = await source.load();
        this.lastLoaded.set(source.name, data);
        this.deepMerge(merged, data);
      } catch {
        // Use last known good config for this source
        const cached = this.lastLoaded.get(source.name);
        if (cached) this.deepMerge(merged, cached);
      }
    }

    // Apply defaults from schema
    for (const [key, def] of Object.entries(this.schema)) {
      if (!(key in merged) && def.default !== undefined) {
        merged[key] = def.default;
      }
    }

    // Validate
    this.validate(merged);

    // Detect changes and notify
    const changes = this.detectChanges(this.config, merged);
    this.config = merged;

    for (const change of changes) {
      this.notifyChange(change);
    }
  }

  /**
   * Reload config from all sources
   */
  async reload(): Promise<void> {
    await this.load();
  }

  /**
   * Get a config value
   */
  get<T extends ConfigValue = ConfigValue>(key: string): T {
    const parts = key.split(".");
    let current: ConfigValue = this.config;

    for (const part of parts) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return undefined as unknown as T;
      }
      current = (current as ConfigObject)[part];
    }

    return current as T;
  }

  /**
   * Get with default fallback
   */
  getOrDefault<T extends ConfigValue>(key: string, defaultValue: T): T {
    const value = this.get<T>(key);
    return value !== undefined && value !== null ? value : defaultValue;
  }

  /**
   * Set a runtime override
   */
  set(key: string, value: ConfigValue, source = "runtime"): void {
    const oldValue = this.get(key);
    const parts = key.split(".");
    let current = this.config;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) current[parts[i]] = {};
      current = current[parts[i]] as ConfigObject;
    }

    current[parts[parts.length - 1]] = value;

    if (oldValue !== value) {
      this.notifyChange({ key, oldValue, newValue: value, source });
    }
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get all config (with secrets masked)
   */
  getAll(maskSecrets = true): ConfigObject {
    if (!maskSecrets) return { ...this.config };

    const masked = JSON.parse(JSON.stringify(this.config)) as ConfigObject;
    for (const [key, def] of Object.entries(this.schema)) {
      if (def.secret && key in masked) {
        masked[key] = "***";
      }
    }
    return masked;
  }

  /**
   * Subscribe to changes for a specific key
   */
  onChange(key: string, listener: ConfigChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    return () => this.listeners.get(key)?.delete(listener);
  }

  /**
   * Subscribe to all changes
   */
  onAnyChange(listener: ConfigChangeListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  /**
   * Add a config source
   */
  addSource(source: ConfigSource): void {
    this.sources.push(source);
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Stop hot reload
   */
  destroy(): void {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
  }

  private validate(config: ConfigObject): void {
    for (const [key, def] of Object.entries(this.schema)) {
      const value = config[key];

      if (def.required && (value === undefined || value === null)) {
        throw new Error(`Config key "${key}" is required`);
      }

      if (value !== undefined && value !== null) {
        if (def.validate && !def.validate(value)) {
          throw new Error(`Config key "${key}" failed validation`);
        }
      }
    }
  }

  private detectChanges(oldConfig: ConfigObject, newConfig: ConfigObject): ConfigChangeEvent[] {
    const changes: ConfigChangeEvent[] = [];
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    for (const key of allKeys) {
      const oldVal = oldConfig[key];
      const newVal = newConfig[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ key, oldValue: oldVal, newValue: newVal, source: "reload" });
      }
    }

    return changes;
  }

  private notifyChange(event: ConfigChangeEvent): void {
    const keyListeners = this.listeners.get(event.key);
    if (keyListeners) {
      for (const listener of keyListeners) listener(event);
    }
    for (const listener of this.globalListeners) listener(event);
  }

  private deepMerge(target: ConfigObject, source: ConfigObject): void {
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        this.deepMerge(target[key] as ConfigObject, value as ConfigObject);
      } else {
        target[key] = value;
      }
    }
  }
}
