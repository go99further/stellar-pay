/**
 * Command Pattern
 *
 * Inspired by production command bus patterns (CQRS):
 * - Command encapsulation (execute + undo)
 * - Command history with undo/redo
 * - Macro commands (composite)
 * - Command queue with priority
 * - Command validation before execution
 *
 * Pattern: Command → Validate → Execute → History → Undo/Redo
 */

export interface CommandResult<T = void> {
  success: boolean;
  value?: T;
  error?: string;
}

export interface Command<T = void> {
  readonly name: string;
  execute(): CommandResult<T> | Promise<CommandResult<T>>;
  undo?(): void | Promise<void>;
  validate?(): string | null; // returns error message or null
}

export interface CommandStats {
  executed: number;
  undone: number;
  failed: number;
  historySize: number;
}

/**
 * CommandBus — executes commands, tracks history, supports undo/redo
 */
export class CommandBus {
  private history: Command[] = [];
  private future: Command[] = [];
  private stats = { executed: 0, undone: 0, failed: 0 };
  private maxHistory: number;
  private middlewares: Array<(cmd: Command, next: () => Promise<CommandResult>) => Promise<CommandResult>> = [];

  constructor(options: { maxHistory?: number } = {}) {
    this.maxHistory = options.maxHistory ?? 100;
  }

  use(middleware: (cmd: Command, next: () => Promise<CommandResult>) => Promise<CommandResult>): this {
    this.middlewares.push(middleware);
    return this;
  }

  async execute<T>(command: Command<T>): Promise<CommandResult<T>> {
    // Validate first
    if (command.validate) {
      const err = command.validate();
      if (err) {
        this.stats.failed++;
        return { success: false, error: err };
      }
    }

    const run = async (): Promise<CommandResult<T>> => {
      try {
        const result = await command.execute();
        if (result.success && command.undo) {
          this.history.push(command as Command);
          if (this.history.length > this.maxHistory) this.history.shift();
          this.future = []; // clear redo stack
        }
        if (result.success) this.stats.executed++;
        else this.stats.failed++;
        return result;
      } catch (e) {
        this.stats.failed++;
        return { success: false, error: String(e) };
      }
    };

    if (this.middlewares.length === 0) return run();

    let index = 0;
    const next = (): Promise<CommandResult> => {
      if (index >= this.middlewares.length) return run() as Promise<CommandResult>;
      return this.middlewares[index++](command as Command, next);
    };
    return next() as Promise<CommandResult<T>>;
  }

  async undo(): Promise<boolean> {
    const cmd = this.history.pop();
    if (!cmd) return false;
    await cmd.undo?.();
    this.future.push(cmd);
    this.stats.undone++;
    return true;
  }

  async redo(): Promise<boolean> {
    const cmd = this.future.pop();
    if (!cmd) return false;
    const result = await cmd.execute();
    if (result.success) {
      this.history.push(cmd);
      if (this.history.length > this.maxHistory) this.history.shift();
    }
    return result.success;
  }

  canUndo(): boolean { return this.history.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  getStats(): CommandStats {
    return {
      executed: this.stats.executed,
      undone: this.stats.undone,
      failed: this.stats.failed,
      historySize: this.history.length,
    };
  }

  clearHistory(): void {
    this.history = [];
    this.future = [];
  }
}

/**
 * MacroCommand — composite of multiple commands executed in sequence
 */
export class MacroCommand implements Command {
  readonly name: string;
  private commands: Command[];
  private executed: Command[] = [];

  constructor(name: string, commands: Command[]) {
    this.name = name;
    this.commands = commands;
  }

  async execute(): Promise<CommandResult> {
    this.executed = [];
    for (const cmd of this.commands) {
      const result = await cmd.execute();
      if (!result.success) {
        // Rollback already-executed commands
        for (const done of [...this.executed].reverse()) {
          await done.undo?.();
        }
        return { success: false, error: `Macro failed at ${cmd.name}: ${result.error}` };
      }
      this.executed.push(cmd);
    }
    return { success: true };
  }

  async undo(): Promise<void> {
    for (const cmd of [...this.executed].reverse()) {
      await cmd.undo?.();
    }
  }
}

/**
 * CommandQueue — priority queue for async command execution
 */
export interface QueuedCommand {
  command: Command;
  priority: number;
  resolve: (result: CommandResult) => void;
  reject: (err: unknown) => void;
}

export class CommandQueue {
  private queue: QueuedCommand[] = [];
  private running = false;
  private bus: CommandBus;

  constructor(bus?: CommandBus) {
    this.bus = bus ?? new CommandBus();
  }

  enqueue(command: Command, priority = 0): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, priority, resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const result = await this.bus.execute(item.command);
        item.resolve(result);
      } catch (e) {
        item.reject(e);
      }
    }
    this.running = false;
  }

  get size(): number { return this.queue.length; }
  get bus_(): CommandBus { return this.bus; }
}
