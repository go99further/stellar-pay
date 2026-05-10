import { describe, it, expect } from "vitest";
import type {
  AgentRole,
  AgentMessage,
  RouterIntent,
  RouterOutput,
  AgentStreamEvent,
  BatchOperation,
  BatchOperationState,
} from "../lib/agent/types";

describe("types", () => {
  describe("AgentRole", () => {
    it("should accept user and assistant roles", () => {
      const user: AgentRole = "user";
      const assistant: AgentRole = "assistant";
      expect(user).toBe("user");
      expect(assistant).toBe("assistant");
    });
  });

  describe("AgentMessage", () => {
    it("should construct a valid user message", () => {
      const msg: AgentMessage = { role: "user", content: "hello" };
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("hello");
    });

    it("should construct a valid assistant message", () => {
      const msg: AgentMessage = { role: "assistant", content: "hi there" };
      expect(msg.role).toBe("assistant");
    });
  });

  describe("RouterIntent", () => {
    it("should cover all four intent values", () => {
      const intents: RouterIntent[] = ["analytics", "trading", "security", "clarify"];
      expect(intents).toHaveLength(4);
    });
  });

  describe("RouterOutput", () => {
    it("should construct a valid RouterOutput", () => {
      const output: RouterOutput = { intent: "analytics", reason: "user asked about pool stats" };
      expect(output.intent).toBe("analytics");
      expect(output.reason).toBeDefined();
    });
  });

  describe("AgentStreamEvent", () => {
    it("should construct router event", () => {
      const evt: AgentStreamEvent = {
        type: "router",
        output: { intent: "trading", reason: "swap request" },
      };
      expect(evt.type).toBe("router");
    });

    it("should construct agent_start event", () => {
      const evt: AgentStreamEvent = { type: "agent_start", agent: "trading" };
      expect(evt.type).toBe("agent_start");
      expect(evt.agent).toBe("trading");
    });

    it("should construct agent_complete event", () => {
      const evt: AgentStreamEvent = { type: "agent_complete", agent: "analytics", elapsedMs: 123 };
      expect(evt.type).toBe("agent_complete");
      expect(evt.elapsedMs).toBe(123);
    });

    it("should construct text event", () => {
      const evt: AgentStreamEvent = { type: "text", delta: "hello" };
      expect(evt.type).toBe("text");
      expect(evt.delta).toBe("hello");
    });

    it("should construct tool_use event", () => {
      const evt: AgentStreamEvent = { type: "tool_use", name: "get-pool-stats", input: { pool: "A" } };
      expect(evt.type).toBe("tool_use");
    });

    it("should construct tool_result event", () => {
      const evt: AgentStreamEvent = { type: "tool_result", name: "get-pool-stats", output: { price: 1.0 } };
      expect(evt.type).toBe("tool_result");
    });

    it("should construct tool_result event with isError", () => {
      const evt: AgentStreamEvent = { type: "tool_result", name: "simulate-swap", output: "error", isError: true };
      expect(evt.isError).toBe(true);
    });

    it("should construct usage event", () => {
      const evt: AgentStreamEvent = { type: "usage", inputTokens: 100, outputTokens: 50, agent: "analytics" };
      expect(evt.type).toBe("usage");
      expect(evt.inputTokens).toBe(100);
    });

    it("should construct done event", () => {
      const evt: AgentStreamEvent = { type: "done" };
      expect(evt.type).toBe("done");
    });

    it("should construct error event", () => {
      const evt: AgentStreamEvent = { type: "error", message: "something went wrong" };
      expect(evt.type).toBe("error");
      expect(evt.message).toBe("something went wrong");
    });
  });

  describe("BatchOperation", () => {
    it("should construct a valid BatchOperation", () => {
      const op: BatchOperation = {
        step: 1,
        total: 3,
        type: "swap",
        description: "Swap 10 TKNA for TKNB",
        completed: false,
      };
      expect(op.step).toBe(1);
      expect(op.total).toBe(3);
      expect(op.type).toBe("swap");
      expect(op.completed).toBe(false);
    });

    it("should accept all three operation types", () => {
      const types: BatchOperation["type"][] = ["swap", "add_liquidity", "remove_liquidity"];
      expect(types).toHaveLength(3);
    });
  });

  describe("BatchOperationState", () => {
    it("should construct a valid BatchOperationState", () => {
      const state: BatchOperationState = {
        operations: [
          { step: 1, total: 2, type: "swap", description: "step 1", completed: false },
          { step: 2, total: 2, type: "add_liquidity", description: "step 2", completed: false },
        ],
        currentStep: 1,
      };
      expect(state.operations).toHaveLength(2);
      expect(state.currentStep).toBe(1);
    });
  });
});
