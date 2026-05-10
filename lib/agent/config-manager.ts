/**
 * Config Manager — hierarchical configuration with validation
 *
 * Inspired by Aider/SWE-agent config patterns:
 * - Layered config (defaults → file → env → runtime)
 * - Schema validation
 * - Hot reload / change watchers
 * - Dot-notation access
 * - Secret masking in logs
 */

export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigValue[];
export interface ConfigObject { [key: string]: ConfigValue }

export type Validator<T> = (value: unknown) => value is T;

export interface ConfigSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "object" | "array";
    required?: boolean;
    default?: ConfigValue;
    secret?: boolean;
    validate?: (v: ConfigValue) => boolean;
  };
}

export interface ConfigOptions {
  schema?: ConfigSchema;
  onError?: (err: Error) => void;
}

export class ConfigManager {
  private layers: ConfigObject[] = [];
  private merged: ConfigObject = {};
  private schema: ConfigSchema;
  private listeners = new Map<string, Array<(newVal: ConfigValue, oldVal: ConfigValue) => void>>();
  private onError: (err: Error) => void;

  constructor(options: ConfigOptions = {}) {
    this.schema = options.schema ?? {};
    this.onError = options.onError ?? ((e) => console.error("Config error:", e));
  }

  load(config: ConfigObject, priority = 0): void {
    this.layers[priority] = config;
    this.remerge();
  }

  loadEnv(prefix = ""): void {
    const env: ConfigObject = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (prefix && !key.startsWith(prefix)) continue;
      const k = prefix ? key.slice(prefix.length).toLowerCase().replace(/_/g, ".") : key.toLowerCase();
      env[k] = value ?? "";
    }
    this.load(env, 10);
  }

  get<T extends ConfigValue = ConfigValue>(path: string, fallback?: T): T {
    const value = this.getDeep(this.merged, path.split("."));
    if (value === undefined) {
      const schemaDef = this.schema[path];
      if (schemaDef?.default !== undefined) return schemaDef.default as T;
      if (fallback !== undefined) return fallback;
      return undefined as unknown as T;
    }
    return value as T;
  }

  set(path: string, value: ConfigValue): void {
    const old = this.get(path);
    this.setDeep(this.merged, path.split("."), value);
    this.notifyListeners(path, value, old);
  }

  has(path: string): boolean {
    return this.getDeep(this.merged, path.split(".")) !== undefined;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const [key, def] of Object.entries(this.schema)) {
      const value = this.get(key);
      if (def.required && (value === undefined || value === null)) {
        errors.push(`Required config key missing: ${key}`);
        continue;
      }
      if (value !== undefined && value !== null) {
        if (def.type === "number" && typeof value !== "number") errors.push(`${key} must be a number`);
        if (def.type === "string" && typeof value !== "string") errors.push(`${key} must be a string`);
        if (def.type === "boolean" && typeof value !== "boolean") errors.push(`${key} must be a boolean`);
        if (def.validate && !def.validate(value)) errors.push(`${key} failed custom validation`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  toObject(maskSecrets = false): ConfigObject {
    if (!maskSecrets) return { ...this.merged };
    const result: ConfigObject = {};
    for (const [key, value] of Object.entries(this.merged)) {
      result[key] = this.schema[key]?.secret ? "***" : value;
    }
    return result;
  }

  onChange(path: string, listener: (newVal: ConfigValue, oldVal: ConfigValue) => void): () => void {
    if (!this.listeners.has(path)) this.listeners.set(path, []);
    this.listeners.get(path)!.push(listener);
    return () => {
      const arr = this.listeners.get(path);
      if (arr) this.listeners.set(path, arr.filter((l) => l !== listener));
    };
  }

  private remerge(): void {
    const old = { ...this.merged };
    this.merged = {};
    for (const layer of this.layers) {
      if (!layer) continue;
      Object.assign(this.merged, layer);
    }
    // Notify changed keys
    const allKeys = new Set([...Object.keys(old), ...Object.keys(this.merged)]);
    for (const key of allKeys) {
      if (old[key] !== this.merged[key]) {
        this.notifyListeners(key, this.merged[key], old[key]);
      }
    }
  }

  private getDeep(obj: ConfigObject, parts: string[]): ConfigValue | undefined {
    let cur: ConfigValue = obj;
    for (const part of parts) {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as ConfigObject)[part];
      if (cur === undefined) return undefined;
    }
    return cur;
  }

  private setDeep(obj: ConfigObject, parts: string[], value: ConfigValue): void {
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]] as ConfigObject;
    }
    cur[parts[parts.length - 1]] = value;
  }

  private notifyListeners(path: string, newVal: ConfigValue, oldVal: ConfigValue): void {
    for (const listener of this.listeners.get(path) ?? []) {
      listener(newVal, oldVal);
    }
  }
}
