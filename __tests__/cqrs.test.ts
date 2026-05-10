import { describe, it, expect, vi } from "vitest";
import { CommandBus, QueryBus, Ok, Err } from "../lib/agent/cqrs";

type CreateUserCmd = { type: "CreateUser"; payload: { name: string; email: string } };
type DeleteUserCmd = { type: "DeleteUser"; payload: { id: string } };
type GetUserQuery = { type: "GetUser"; payload: { id: string } };
type ListUsersQuery = { type: "ListUsers"; payload: { limit: number } };

interface User { id: string; name: string; email: string }

describe("CommandBus", () => {
  describe("register / dispatch", () => {
    it("should dispatch to registered handler", async () => {
      const bus = new CommandBus();
      bus.register<CreateUserCmd, string>("CreateUser", async (cmd) => {
        return Ok(`user-${cmd.payload.name}`);
      });
      const result = await bus.dispatch<string>({ type: "CreateUser", payload: { name: "Alice", email: "a@b.com" } });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("user-Alice");
    });

    it("should return Err for unregistered command", async () => {
      const bus = new CommandBus();
      const result = await bus.dispatch({ type: "Unknown", payload: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("No handler for command: Unknown");
    });

    it("should return Err when handler throws", async () => {
      const bus = new CommandBus();
      bus.register("Boom", async () => { throw new Error("handler exploded"); });
      const result = await bus.dispatch({ type: "Boom", payload: {} });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe("handler exploded");
    });

    it("should return Err when handler returns Err", async () => {
      const bus = new CommandBus();
      bus.register("Fail", async () => Err(new Error("validation failed")));
      const result = await bus.dispatch({ type: "Fail", payload: {} });
      expect(result.ok).toBe(false);
    });
  });

  describe("middleware", () => {
    it("should run middleware before handler", async () => {
      const order: string[] = [];
      const bus = new CommandBus();
      bus.use(async (_cmd, next) => { order.push("mw"); return next(); });
      bus.register("Cmd", async () => { order.push("handler"); return Ok(undefined); });
      await bus.dispatch({ type: "Cmd", payload: {} });
      expect(order).toEqual(["mw", "handler"]);
    });

    it("should run multiple middlewares in order", async () => {
      const order: string[] = [];
      const bus = new CommandBus();
      bus.use(async (_c, next) => { order.push("mw1"); return next(); });
      bus.use(async (_c, next) => { order.push("mw2"); return next(); });
      bus.register("Cmd", async () => { order.push("handler"); return Ok(undefined); });
      await bus.dispatch({ type: "Cmd", payload: {} });
      expect(order).toEqual(["mw1", "mw2", "handler"]);
    });

    it("middleware can short-circuit", async () => {
      const handler = vi.fn().mockResolvedValue(Ok(undefined));
      const bus = new CommandBus();
      bus.use(async () => Err(new Error("blocked")));
      bus.register("Cmd", handler);
      const result = await bus.dispatch({ type: "Cmd", payload: {} });
      expect(result.ok).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("QueryBus", () => {
  describe("register / query", () => {
    it("should dispatch to registered handler", async () => {
      const bus = new QueryBus();
      const users: User[] = [{ id: "1", name: "Alice", email: "a@b.com" }];
      bus.register<GetUserQuery, User | undefined>("GetUser", (q) =>
        users.find((u) => u.id === q.payload.id)
      );
      const user = await bus.query<User | undefined>({ type: "GetUser", payload: { id: "1" } });
      expect(user?.name).toBe("Alice");
    });

    it("should throw for unregistered query", async () => {
      const bus = new QueryBus();
      await expect(bus.query({ type: "Unknown", payload: {} })).rejects.toThrow("No handler for query: Unknown");
    });

    it("should support async handlers", async () => {
      const bus = new QueryBus();
      bus.register("Slow", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return [1, 2, 3];
      });
      const result = await bus.query<number[]>({ type: "Slow", payload: {} });
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("middleware", () => {
    it("should run middleware before handler", async () => {
      const order: string[] = [];
      const bus = new QueryBus();
      bus.use(async (_q, next) => { order.push("mw"); return next(); });
      bus.register("Q", () => { order.push("handler"); return 42; });
      await bus.query({ type: "Q", payload: {} });
      expect(order).toEqual(["mw", "handler"]);
    });

    it("middleware can return cached result", async () => {
      const handler = vi.fn().mockReturnValue("fresh");
      const bus = new QueryBus();
      bus.use(async () => "cached");
      bus.register("Q", handler);
      const result = await bus.query({ type: "Q", payload: {} });
      expect(result).toBe("cached");
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe("Ok / Err helpers", () => {
  it("Ok should create success result", () => {
    const r = Ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("Err should create failure result", () => {
    const r = Err(new Error("oops"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("oops");
  });
});
