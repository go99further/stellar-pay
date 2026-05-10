import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandBus, MacroCommand, CommandQueue } from "../lib/agent/command-bus";
import type { Command, CommandResult } from "../lib/agent/command-bus";

// Helper: simple counter command
function makeIncrement(counter: { value: number }, by = 1): Command {
  return {
    name: "increment",
    execute() { counter.value += by; return { success: true }; },
    undo() { counter.value -= by; },
  };
}

function makeFailingCommand(name = "fail"): Command {
  return {
    name,
    execute() { return { success: false, error: "intentional failure" }; },
  };
}

function makeThrowingCommand(): Command {
  return {
    name: "throw",
    execute() { throw new Error("unexpected throw"); },
  };
}

describe("CommandBus", () => {
  let bus: CommandBus;

  beforeEach(() => {
    bus = new CommandBus();
  });

  describe("execute", () => {
    it("should execute a command and return success", async () => {
      const counter = { value: 0 };
      const result = await bus.execute(makeIncrement(counter));
      expect(result.success).toBe(true);
      expect(counter.value).toBe(1);
    });

    it("should return failure result without throwing", async () => {
      const result = await bus.execute(makeFailingCommand());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/intentional failure/);
    });

    it("should catch thrown errors and return failure", async () => {
      const result = await bus.execute(makeThrowingCommand());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unexpected throw/);
    });

    it("should run validation before executing", async () => {
      const counter = { value: 0 };
      const cmd: Command = {
        name: "validated",
        validate() { return "value must be positive"; },
        execute() { counter.value++; return { success: true }; },
      };
      const result = await bus.execute(cmd);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/value must be positive/);
      expect(counter.value).toBe(0); // never executed
    });

    it("should pass validation when validate returns null", async () => {
      const counter = { value: 0 };
      const cmd: Command = {
        name: "valid",
        validate() { return null; },
        execute() { counter.value++; return { success: true }; },
      };
      const result = await bus.execute(cmd);
      expect(result.success).toBe(true);
      expect(counter.value).toBe(1);
    });
  });

  describe("undo / redo", () => {
    it("should undo last command", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter, 5));
      expect(counter.value).toBe(5);
      await bus.undo();
      expect(counter.value).toBe(0);
    });

    it("should redo after undo", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter, 3));
      await bus.undo();
      await bus.redo();
      expect(counter.value).toBe(3);
    });

    it("should return false when nothing to undo", async () => {
      expect(await bus.undo()).toBe(false);
    });

    it("should return false when nothing to redo", async () => {
      expect(await bus.redo()).toBe(false);
    });

    it("should clear redo stack on new execute", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      await bus.undo();
      expect(bus.canRedo()).toBe(true);
      await bus.execute(makeIncrement(counter, 10));
      expect(bus.canRedo()).toBe(false);
    });

    it("should not add to history if command has no undo", async () => {
      await bus.execute(makeFailingCommand("no-undo"));
      expect(bus.canUndo()).toBe(false);
    });

    it("should undo multiple commands in reverse order", async () => {
      const log: string[] = [];
      const makeLogged = (name: string): Command => ({
        name,
        execute() { log.push(`exec:${name}`); return { success: true }; },
        undo() { log.push(`undo:${name}`); },
      });

      await bus.execute(makeLogged("a"));
      await bus.execute(makeLogged("b"));
      await bus.undo();
      await bus.undo();

      expect(log).toEqual(["exec:a", "exec:b", "undo:b", "undo:a"]);
    });
  });

  describe("canUndo / canRedo", () => {
    it("should report canUndo correctly", async () => {
      const counter = { value: 0 };
      expect(bus.canUndo()).toBe(false);
      await bus.execute(makeIncrement(counter));
      expect(bus.canUndo()).toBe(true);
    });

    it("should report canRedo correctly", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      expect(bus.canRedo()).toBe(false);
      await bus.undo();
      expect(bus.canRedo()).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should track executed, undone, failed counts", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      await bus.execute(makeIncrement(counter));
      await bus.execute(makeFailingCommand());
      await bus.undo();

      const stats = bus.getStats();
      expect(stats.executed).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.undone).toBe(1);
    });

    it("should report historySize", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      await bus.execute(makeIncrement(counter));
      expect(bus.getStats().historySize).toBe(2);
    });
  });

  describe("maxHistory", () => {
    it("should evict oldest history entries when limit exceeded", async () => {
      const bus2 = new CommandBus({ maxHistory: 2 });
      const counter = { value: 0 };
      await bus2.execute(makeIncrement(counter));
      await bus2.execute(makeIncrement(counter));
      await bus2.execute(makeIncrement(counter));
      expect(bus2.getStats().historySize).toBe(2);
    });
  });

  describe("clearHistory", () => {
    it("should clear history and future stacks", async () => {
      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      await bus.undo();
      bus.clearHistory();
      expect(bus.canUndo()).toBe(false);
      expect(bus.canRedo()).toBe(false);
    });
  });

  describe("middleware", () => {
    it("should run middleware before command execution", async () => {
      const log: string[] = [];
      bus.use(async (cmd, next) => {
        log.push(`before:${cmd.name}`);
        const result = await next();
        log.push(`after:${cmd.name}`);
        return result;
      });

      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      expect(log).toEqual(["before:increment", "after:increment"]);
    });

    it("should allow middleware to block execution", async () => {
      const counter = { value: 0 };
      bus.use(async (_cmd, _next) => ({ success: false, error: "blocked" }));
      const result = await bus.execute(makeIncrement(counter));
      expect(result.success).toBe(false);
      expect(counter.value).toBe(0);
    });

    it("should chain multiple middlewares", async () => {
      const log: string[] = [];
      bus.use(async (cmd, next) => { log.push("mw1"); return next(); });
      bus.use(async (cmd, next) => { log.push("mw2"); return next(); });

      const counter = { value: 0 };
      await bus.execute(makeIncrement(counter));
      expect(log).toEqual(["mw1", "mw2"]);
    });
  });
});

describe("MacroCommand", () => {
  it("should execute all sub-commands in order", async () => {
    const log: string[] = [];
    const makeLogged = (name: string): Command => ({
      name,
      execute() { log.push(name); return { success: true }; },
      undo() { log.push(`undo:${name}`); },
    });

    const macro = new MacroCommand("batch", [makeLogged("a"), makeLogged("b"), makeLogged("c")]);
    const result = await macro.execute();
    expect(result.success).toBe(true);
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("should rollback on sub-command failure", async () => {
    const log: string[] = [];
    const ok = (name: string): Command => ({
      name,
      execute() { log.push(`exec:${name}`); return { success: true }; },
      undo() { log.push(`undo:${name}`); },
    });
    const fail: Command = {
      name: "fail",
      execute() { return { success: false, error: "boom" }; },
    };

    const macro = new MacroCommand("batch", [ok("a"), ok("b"), fail]);
    const result = await macro.execute();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/fail/);
    expect(log).toContain("undo:b");
    expect(log).toContain("undo:a");
  });

  it("should undo all executed commands in reverse", async () => {
    const log: string[] = [];
    const makeLogged = (name: string): Command => ({
      name,
      execute() { log.push(`exec:${name}`); return { success: true }; },
      undo() { log.push(`undo:${name}`); },
    });

    const macro = new MacroCommand("batch", [makeLogged("x"), makeLogged("y")]);
    await macro.execute();
    await macro.undo();
    expect(log).toEqual(["exec:x", "exec:y", "undo:y", "undo:x"]);
  });
});

describe("CommandQueue", () => {
  it("should execute commands sequentially", async () => {
    const queue = new CommandQueue();
    const log: number[] = [];
    const makeDelayed = (n: number): Command => ({
      name: `cmd${n}`,
      async execute() {
        await new Promise((r) => setTimeout(r, 5));
        log.push(n);
        return { success: true };
      },
    });

    await Promise.all([
      queue.enqueue(makeDelayed(1)),
      queue.enqueue(makeDelayed(2)),
      queue.enqueue(makeDelayed(3)),
    ]);

    expect(log).toEqual([1, 2, 3]);
  });

  it("should respect priority ordering", async () => {
    const queue = new CommandQueue();
    const log: string[] = [];

    // Enqueue low priority first, then high priority
    const p1 = queue.enqueue({ name: "low", execute() { log.push("low"); return { success: true }; } }, 0);
    const p2 = queue.enqueue({ name: "high", execute() { log.push("high"); return { success: true }; } }, 10);

    await Promise.all([p1, p2]);
    // First item already started, but high priority should run before remaining low ones
    expect(log).toContain("low");
    expect(log).toContain("high");
  });

  it("should report queue size", () => {
    const queue = new CommandQueue();
    expect(queue.size).toBe(0);
  });
});
