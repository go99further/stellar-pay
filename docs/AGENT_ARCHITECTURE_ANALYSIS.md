# Stellar-Pay Agent 架构分析与并行化方案

## 📊 当前架构梳理

### 1. 核心组件架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                        │
│                  app/api/agent/route.ts                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Router Agent       │
              │  classifyIntent()    │
              │  (串行路由决策)       │
              └──────────┬───────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌────────┐     ┌─────────┐    ┌──────────┐
    │Analytics│     │ Trading │    │ Security │
    │ Agent   │     │  Agent  │    │  Agent   │
    └────────┘     └─────────┘    └──────────┘
         │               │               │
         └───────────────┴───────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Tool Execution     │
              │   (RPC calls)        │
              └──────────────────────┘
```

### 2. 当前执行流程（串行）

```typescript
// app/api/agent/route.ts (lines 59-84)
const routed = await classifyIntent(history);  // Step 1: 路由决策
send({ type: "router", output: routed });

switch (routed.intent) {                       // Step 2: 单一 agent 执行
  case "analytics":
    for await (const evt of runAnalytics(history)) send(evt);
    break;
  case "trading":
    for await (const evt of runTrading(history, walletAddress)) send(evt);
    break;
  case "security":
    for await (const evt of runSecurity(history)) send(evt);
    break;
}
```

**问题识别：**
1. ❌ **Router 是瓶颈**：必须等待 classifyIntent 完成才能执行 agent
2. ❌ **单一 agent 执行**：一次只能路由到一个 agent（analytics/trading/security）
3. ❌ **无并行工具调用**：每个 agent 内部的 tool 调用也是串行的
4. ❌ **无 agent 间协作**：Trading agent 需要 Security 检查时，只能内部调用函数，无法并行

### 3. 已有的并行化基础设施（未使用）

项目中已经实现了多个并行化组件，但**未被主流程使用**：

#### 3.1 WorkflowEngine (lib/agent/pipeline/workflow-engine.ts)
```typescript
// 支持 DAG 并行执行
const workflow = createWorkflow<Context>("swap-with-security")
  .addStep({ id: "security-check", execute: checkSecurity, parallel: true })
  .addStep({ id: "simulate-swap", execute: simulateSwap, parallel: true })
  .addStep({ id: "build-xdr", execute: buildXdr, dependsOn: ["security-check", "simulate-swap"] });
```
✅ 支持并行步骤
✅ 支持依赖管理
❌ **未被 route.ts 使用**

#### 3.2 SagaOrchestrator (lib/agent/recovery/saga-orchestrator.ts)
```typescript
// 支持补偿事务
const saga = createSaga<SwapContext>("swap-saga")
  .step({ execute: reserveFunds, compensate: releaseFunds })
  .step({ execute: executeSwap, compensate: revertSwap });
```
✅ 支持事务补偿
❌ **仅用于错误恢复，未用于并行编排**

#### 3.3 EventBus (lib/agent/event-bus.ts)
```typescript
// 支持发布订阅
eventBus.on("swap:completed", handleSwapComplete);
eventBus.emit("swap:completed", { txHash });
```
✅ 支持异步事件
❌ **未用于 agent 间通信**

---

## 🔍 A2A 协议研究总结

根据 GitHub 研究（OpenAI Swarm, AutoGen, LangGraph, CrewAI），主流 A2A 协议特点：

| 协议 | 消息格式 | 路由机制 | 并行支持 | 适用场景 |
|------|---------|---------|---------|---------|
| **OpenAI Swarm** | Chat API + sender | 函数返回 handoff | ❌ 串行 | 简单对话流 |
| **AutoGen** | Event-driven | Message passing | ✅ 并行 | 企业级分布式 |
| **LangGraph** | State graph | Conditional edges | ✅ Fan-out/in | 复杂工作流 |
| **CrewAI** | Task delegation | Hierarchical | ✅ 可配置 | 团队协作 |

**关键洞察：**
- Swarm 模式（当前架构）：简单但串行
- LangGraph 模式：适合复杂并行工作流
- 混合模式：Router + Parallel Execution（推荐）

---

## 🚀 并行化改进方案

### 方案 A：渐进式并行化（推荐 ⭐）

**原则：保持现有架构，逐步引入并行**

#### Phase 1: Router 后并行工具调用（Week 1）

```typescript
// app/api/agent/route-v2.ts
export async function POST(req: NextRequest) {
  const history = await parseRequest(req);
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(sseLine(evt)));
      };

      // Step 1: 路由决策（保持不变）
      const routed = await classifyIntent(history);
      send({ type: "router", output: routed });

      // Step 2: 根据 intent 决定是否并行
      if (routed.intent === "trading") {
        // Trading 需要 Security 预检查 → 并行执行
        await runTradingWithSecurityParallel(history, send, walletAddress);
      } else {
        // 其他 intent 保持串行
        await runSingleAgent(routed.intent, history, send, walletAddress);
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}

// 新增：Trading + Security 并行执行
async function runTradingWithSecurityParallel(
  history: AgentMessage[],
  send: (evt: AgentStreamEvent) => void,
  walletAddress?: string
) {
  // 并行启动两个 agent
  const tradingGen = runTrading(history, walletAddress);
  const securityGen = runSecurity(history);

  // 使用 Promise.race 或自定义 merge 逻辑
  const merged = mergeAsyncGenerators([
    { gen: tradingGen, agent: "trading" },
    { gen: securityGen, agent: "security" },
  ]);

  for await (const evt of merged) {
    send(evt);
  }
}

// 工具函数：合并多个 AsyncGenerator
async function* mergeAsyncGenerators<T>(
  generators: Array<{ gen: AsyncGenerator<T>; agent: string }>
): AsyncGenerator<T & { agent: string }> {
  const promises = generators.map(({ gen, agent }) =>
    gen.next().then((result) => ({ result, agent, gen }))
  );

  while (promises.length > 0) {
    const { result, agent, gen } = await Promise.race(promises);
    
    if (!result.done) {
      yield { ...result.value, agent };
      // 继续该 generator
      const idx = promises.findIndex((p) => p === promises[0]); // 简化示例
      promises[idx] = gen.next().then((r) => ({ result: r, agent, gen }));
    } else {
      // 移除已完成的 generator
      const idx = promises.findIndex((p) => p === promises[0]);
      promises.splice(idx, 1);
    }
  }
}
```

**优点：**
- ✅ 最小改动，风险低
- ✅ 保持现有 Router 逻辑
- ✅ Trading + Security 并行执行（最常见场景）
- ✅ 渐进式迁移

**缺点：**
- ⚠️ 仍需 Router 决策（有延迟）
- ⚠️ 只支持预定义的并行组合

---

#### Phase 2: 多意图并行路由（Week 2-3）

```typescript
// lib/agent/router-v2.ts
export async function classifyIntents(
  history: AgentMessage[]
): Promise<RouterOutput[]> {
  // 修改 Router 支持返回多个 intent
  const client = getAnthropicClient();
  
  const response = await client.messages.create({
    model: MODEL_ROUTER,
    max_tokens: 512,
    system: MULTI_INTENT_SYSTEM_PROMPT,
    tools: [ROUTE_MULTI_TOOL], // 新工具：返回 intent 数组
    messages: toAnthropicMessages(history),
  });

  // 返回多个 intent（例如：["security", "trading"]）
  return parseMultiIntentResponse(response);
}

// app/api/agent/route-v3.ts
const routed = await classifyIntents(history); // 返回数组

if (routed.length === 1) {
  // 单一 intent，串行执行
  await runSingleAgent(routed[0].intent, history, send, walletAddress);
} else {
  // 多 intent，并行执行
  await runMultiAgentParallel(routed, history, send, walletAddress);
}

async function runMultiAgentParallel(
  intents: RouterOutput[],
  history: AgentMessage[],
  send: (evt: AgentStreamEvent) => void,
  walletAddress?: string
) {
  const generators = intents.map((intent) => {
    switch (intent.intent) {
      case "analytics":
        return { gen: runAnalytics(history), agent: "analytics" };
      case "trading":
        return { gen: runTrading(history, walletAddress), agent: "trading" };
      case "security":
        return { gen: runSecurity(history), agent: "security" };
      default:
        throw new Error(`Unknown intent: ${intent.intent}`);
    }
  });

  const merged = mergeAsyncGenerators(generators);
  for await (const evt of merged) {
    send(evt);
  }
}
```

**优点：**
- ✅ 真正的多 agent 并行
- ✅ Router 一次决策，返回所有需要的 agents
- ✅ 用户问 "检查安全性并模拟交换" → 同时执行 Security + Trading

**缺点：**
- ⚠️ Router prompt 需要重新设计
- ⚠️ 前端需要处理多 agent 的流式输出

---

#### Phase 3: Agent 内部工具并行（Week 3-4）

```typescript
// lib/agent/trading-v2.ts
async function* runTradingAnthropic(
  history: AgentMessage[],
  userPublicKey?: string
): AsyncGenerator<AgentStreamEvent> {
  // ... existing code ...

  // 当 agent 调用多个独立工具时，并行执行
  if (finalMessage.stop_reason === "tool_use") {
    const toolBlocks = finalMessage.content.filter((b) => b.type === "tool_use");
    
    // 检测独立工具（可并行）
    const independentTools = detectIndependentTools(toolBlocks);
    
    if (independentTools.length > 1) {
      // 并行执行
      const results = await Promise.allSettled(
        independentTools.map((block) => runTool(block.name, block.input, userPublicKey))
      );
      
      // 合并结果
      const toolResults = results.map((r, i) => {
        const block = independentTools[i];
        if (r.status === "fulfilled") {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: JSON.stringify(r.value),
          };
        } else {
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: r.reason.message,
            is_error: true,
          };
        }
      });
      
      messages.push({ role: "user", content: toolResults });
    } else {
      // 串行执行（有依赖）
      // ... existing sequential code ...
    }
  }
}

// 检测工具是否独立（无依赖）
function detectIndependentTools(
  toolBlocks: Anthropic.ToolUseBlock[]
): Anthropic.ToolUseBlock[] {
  // 简单规则：get_* 工具通常独立
  // 复杂规则：分析工具的输入参数是否依赖其他工具的输出
  return toolBlocks.filter((b) => b.name.startsWith("get_"));
}
```

**优点：**
- ✅ Agent 内部自动优化
- ✅ 对外部透明
- ✅ 显著提升 RPC 密集型操作速度

**缺点：**
- ⚠️ 需要工具依赖分析
- ⚠️ 错误处理更复杂

---

### 方案 B：基于 LangGraph 的完全重构（不推荐）

```typescript
// lib/agent/graph-orchestrator.ts
import { StateGraph } from "@langchain/langgraph";

const graph = new StateGraph({
  channels: {
    messages: { value: (x, y) => x.concat(y) },
    intent: { value: (x, y) => y ?? x },
  },
})
  .addNode("router", routerNode)
  .addNode("analytics", analyticsNode)
  .addNode("trading", tradingNode)
  .addNode("security", securityNode)
  .addEdge("router", "analytics")
  .addEdge("router", "trading")
  .addEdge("router", "security")
  .addConditionalEdges("router", shouldRunMultiple);

const app = graph.compile();
```

**为什么不推荐：**
- ❌ 引入重量级依赖（@langchain/langgraph）
- ❌ 学习曲线陡峭
- ❌ 过度设计（当前需求不需要复杂图）
- ❌ 面试时难以解释每一行代码

---

## 📋 实施计划

### Week 1: Phase 1 实施
- [ ] 实现 `mergeAsyncGenerators` 工具函数
- [ ] 创建 `runTradingWithSecurityParallel` 函数
- [ ] 修改 `app/api/agent/route.ts` 支持 Trading + Security 并行
- [ ] 添加单元测试
- [ ] 性能基准测试（对比串行 vs 并行）

### Week 2: Phase 2 实施
- [ ] 设计多意图 Router prompt
- [ ] 实现 `classifyIntents` 返回数组
- [ ] 实现 `runMultiAgentParallel` 函数
- [ ] 前端适配多 agent 流式输出
- [ ] 集成测试

### Week 3: Phase 3 实施
- [ ] 实现工具依赖分析
- [ ] 修改 Trading/Analytics/Security agents 支持工具并行
- [ ] 错误处理和重试逻辑
- [ ] 端到端测试

### Week 4: 优化与监控
- [ ] 添加并行度监控（Prometheus metrics）
- [ ] 性能调优（并发数限制、超时控制）
- [ ] 文档更新
- [ ] 生产环境灰度发布

---

## 🎯 推荐方案总结

**立即实施：Phase 1（Trading + Security 并行）**
- 投入：2-3 天
- 收益：30-50% 延迟降低（最常见场景）
- 风险：低

**中期目标：Phase 2（多意图并行路由）**
- 投入：1 周
- 收益：支持复杂查询并行
- 风险：中（需要前端配合）

**长期优化：Phase 3（工具级并行）**
- 投入：1-2 周
- 收益：RPC 密集型操作 2-3x 提速
- 风险：中（依赖分析复杂度）

**不推荐：LangGraph 完全重构**
- 投入：3-4 周
- 收益：架构更"现代"
- 风险：高（引入新依赖，过度设计）

---

## 📊 性能预期

### 当前架构（串行）
```
User Query → Router (200ms) → Trading Agent (1500ms) → Total: 1700ms
```

### Phase 1（Trading + Security 并行）
```
User Query → Router (200ms) → [Trading (1500ms) || Security (800ms)] → Total: 1700ms
                                ↓ 并行执行，取最长
                                Max(1500, 800) = 1500ms
Total: 1700ms → 实际无提升（因为 Trading 更慢）

但如果 Security 需要阻塞 Trading：
串行：200 + 800 + 1500 = 2500ms
并行：200 + Max(800, 1500) = 1700ms  ✅ 节省 800ms (32%)
```

### Phase 2（多意图并行）
```
User: "检查池状态并评估风险"
串行：Router (200ms) → Analytics (1000ms) → Security (800ms) = 2000ms
并行：Router (200ms) → [Analytics (1000ms) || Security (800ms)] = 1200ms
✅ 节省 800ms (40%)
```

### Phase 3（工具级并行）
```
Trading Agent 调用 3 个独立 RPC：
串行：get_reserves (300ms) + get_price (300ms) + get_balance (300ms) = 900ms
并行：Max(300, 300, 300) = 300ms
✅ 节省 600ms (67%)
```

---

## 🔧 技术债务与风险

### 当前技术债
1. **未使用的并行基础设施**：WorkflowEngine, SagaOrchestrator 已实现但未集成
2. **EventBus 未用于 agent 通信**：仅用于内部事件，未用于 A2A
3. **无并发控制**：缺少 rate limiting, bulkhead pattern（虽然代码存在）

### 风险评估
| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 并行导致 RPC 限流 | 中 | 高 | 添加 Bulkhead 限制并发数 |
| 多 agent 输出混乱 | 高 | 中 | 前端添加 agent 标签区分 |
| 错误处理复杂化 | 中 | 中 | 使用 Promise.allSettled |
| 调试困难 | 中 | 低 | 添加分布式追踪（trace ID） |

---

## 📚 参考资料

- OpenAI Swarm: https://github.com/openai/swarm
- Microsoft AutoGen: https://github.com/microsoft/autogen
- LangGraph: https://github.com/langchain-ai/langgraph
- CrewAI: https://github.com/joaomdmoura/crewAI
- 项目现有实现：
  - `lib/agent/pipeline/workflow-engine.ts`
  - `lib/agent/recovery/saga-orchestrator.ts`
  - `lib/agent/event-bus.ts`

---

**生成时间**: 2026-05-10  
**作者**: Claude Sonnet 4.6 + Research Agent  
**状态**: 待审阅
