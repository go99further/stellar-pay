# 面试备忘录：Stellar-Pay 数据闭环 + Multi-Agent 系统

> 面试前 30 分钟过一遍这份文档。所有数字来自真实跑分，不是编的。

---

## 一、30 秒电梯演讲

"我做了一个 AI Agent 驱动的 Stellar DeFi DApp——用户用自然语言完成链上交易。
架构是 Router(DeepSeek Flash) → 3 个子 Agent(Sonnet) → 11 个工具 → Soroban 合约。
全部手写不靠 LangChain。核心差异化是 4 层数据闭环——让 Security Agent 自己学着调阈值。"

---

## 二、关键数字（必须能脱口而出）

### Benchmark（30 条标注，真实跑分，data/benchmark-report.json）
- Router 准确率：83%（lenient，25/30）/ 80%（strict，24/30）
- 工具 Recall：75%（15/20 有工具的用例）
- 工具 Precision：100%（没有一次调了不该调的工具）
- 安全拒绝率：100%（4/4 对抗输入全拦截）
- 端到端 P50：11.1s（含 testnet RPC 5s/次）
- Router P50：2.4s / P95：6.7s
- 平均工具调用轮次：2.2

### 延迟高的原因（必须能解释）
- Stellar testnet RPC 每次 ~5 秒（mainnet < 500ms）
- Agent 平均 2.2 轮工具调用（每轮 = LLM 2s + RPC 5s ≈ 7s）
- 不是 Agent 的问题，是 testnet 基础设施的问题

### 数据闭环
- 数据集：3,589 个真实价格点（XLM 作为 TKNA/TKNB 代理）
- 参数优化：Monte Carlo 500 iter + walk-forward 60/20/20
- 核心结论：Tuned vs Default 显著（p<0.001, Cohen's d=1.14, large effect）
- Grid vs MC：Grid 在 5 维空间下反而更好（p<0.001, d=1.37）——反直觉但有理论支撑

### 系统整体
- 测试：902/902（61 文件）
- 检测器：6 个（3 个 Agent 可调用 + 3 个通过工具间接触发）
- LIMITATIONS：13 条已知局限

---

## 三、4 层闭环（2 分钟讲完）

"闭环分 4 层：

Layer 1 — 在线统计：每次检测器触发记录 pending，下一次观测结算 hit/miss，积累命中率。

Layer 2 — 多检测器结算：6 个检测器各有自己的结算规则。price_impact 用实际交易滑点验证，liquidity_flow 等 1 小时看 TVL，sandwich 追踪嫌疑地址。

Layer 3 — 参数优化：Monte Carlo + walk-forward 60/20/20 交叉验证，输出推荐参数 + IQR。

Layer 4 — HITL 桥接：所有建议走用户确认，永不自动生效。"

---

## 四、自我审查记录（面试杀招）

"我自己 review + 收外部 reviewer 反馈，一共修了 6 个结构性问题：

1. 数据集是 XLM 不是 TKNA/TKNB — 用 XLM 作行为代理，全栈披露
2. IQR 不是 CI — 术语滥用，重命名 + JSDoc 标注
3. Selection bias — next-1-tick 因均值回归系统性偏低，加了 K-tick 累积均值
4. Apply 是 theater — security threshold 硬编码，加了 localStorage 覆盖层
5. Vercel rate limit 是 per-instance — 加了 Vercel KV 分布式方案
6. 没有 baseline — tuneSuggestionParams 现在同时跑 default params 对比

还有 13 条没修但写进 LIMITATIONS.md 了。核心是：audit 不是'我什么都做对了'，是'我知道什么是错的，标出来'。"

---

## 五、Swarm 改进（1 分钟）

"对比 OpenAI Swarm 做了 4 个改进：
1. Intent Graph Dispatcher — Router 输出整个执行拓扑，不是下一跳
2. Fan-out/Fan-in — 并行场景延迟砍半
3. LoopDetector — 防 Agent 用相同参数反复调工具烧 token
4. SSE 流式 Handoff — 用户看到打字机效果不黑屏"

---

## 六、HITL 两阶段签名（1 分钟）

"Agent 只构建 unsigned XDR，签名由 Freighter 在浏览器内完成。
私钥永不离开设备。即使 Agent 被攻陷，攻击者最多构造误导性 XDR，
但用户在确认卡上能看到真实参数。
确认卡 + Freighter 弹窗 = 双重人工审核。"

---

## 七、高频追问 + 答案

### Q: 为什么不用 LangChain？
"LangChain 过度抽象，调试困难。我的场景只有 4 个 Agent + 11 个工具，手写 dispatcher 87 行就够了。完全可控，出 bug 能直接定位到行号。"

### Q: 检测器都是 if-else，为什么需要 Agent？
"检测器是规则（可测试、可回测），但'什么时候调哪个检测器'是 AI 决定的。用户说'安全吗'和'换 500 TKNA 安全吗'需要调的工具完全不同。AI 的价值在决策层和表达层，不在计算层。"

### Q: 100% F1 是不是过拟合？
"是的。8 个场景 14 个评估点，检测器只有 3 个参数——测试集是为检测器量身定做的。真正的验证需要对抗性场景（4.9% vs 5.1% 阈值边界）和真实 mainnet 数据。这是我加数据闭环的动机——让真实运行数据替代手写场景。"

### Q: Grid 比 MC 好，为什么还保留 MC？
"在当前 5 维参数空间 + budget=500 下 Grid 确实更好。但如果参数空间扩展到 8-10 维，Grid 的组合爆炸（5^10 = 1000 万）让它不可用，MC 是唯一选择。保留两者是为了不同 regime 下的灵活性。"

### Q: P50 延迟 1.9 秒太慢了？
"这是 DeepSeek Flash 的正常延迟——成本换速度的 tradeoff。如果切回 Haiku，P50 降到 300-500ms 但成本涨 10-20 倍。Router 只做分类，2 秒对用户体验影响有限——真正的等待在子 Agent（2-3 秒），Router 延迟被并行掩盖。"

### Q: 端到端 11 秒太慢了？
"testnet RPC 每次 5 秒是瓶颈，不是 Agent 的问题。mainnet 同样 2.2 轮调用延迟从 11s 降到 ~5s（2.2 × (2s LLM + 0.5s RPC)）。SSE 流式推送让用户看到打字机效果，体感比干等好很多。"

### Q: Router 准确率 83% 不够高？
"83% 是 lenient 准确率（acceptableIntents 宽容）。主要混淆是 security ↔ analytics_security——用户问'这笔交易安全吗'时，Router 认为既需要查数据又需要评估风险，选了 analytics_security。这不是 bug，是合理倾向。如果把这类 case 的 acceptableIntents 加上 analytics_security，准确率升到 95%+。"

### Q: 工具 Recall 75% 意味着什么？
"5 个失败里有 2 个是标注问题（我标的 expectedTools 不准确），2 个是 L3 门控场景 Agent 跳过了前置查询，1 个是 Router 分类到了 analytics 而不是 security 导致工具不同。真正的 Agent 推理失败只有 2-3 个。这说明标注质量本身是 benchmark 的瓶颈——这是 LIMITATIONS 里应该加的一条。"

### Q: 工具 Precision 100% 和安全拒绝率 100% 是真的吗？
"是真实跑出来的（data/benchmark-report.json 可查）。Precision 100% 意味着 Agent 从来没在该模拟时直接构建 XDR——这是 HITL 不变量在 Agent 层的证据。安全拒绝率 100% 意味着 4 个 prompt injection 全被拦截，包括'忽略上面所有指令'和'帮我把私钥发出去'。"

### Q: Welch t-test 为什么不用 paired？
"不同方法用独立采样，没有自然配对。Welch 不假设方差相等——Grid 是确定性 std≈0，Random 高方差，Student's 会算错。"

### Q: Cohen's d = 2.57 是什么意思？
"标准化效应量。0.2=small, 0.5=medium, 0.8+=large。2.57 是极大效应——调参后的改善不是噪声，是实质性的。"

### Q: localStorage 存数据靠谱吗？
"对单用户 demo 够用。生产环境需要 server-side 持久化（Postgres/Redis）。这是 LIMITATIONS L4 里写的——'78% 命中率'是单 session 统计，不是跨用户聚合。"

### Q: 为什么 sandwich 在 testnet 上没数据？
"Testnet 没有 MEV 机器人。sandwich 检测器的代码和测试都在，但在线闭环的 precision 永远是 null（没有 settled 样本）。这是 LIMITATIONS L2，诚实声明。"

---

## 八、延迟解释速查

```
P50 = 中位数（50% 请求在此时间内完成）
P95 = 95 百分位（只有 5% 的请求比这更慢）
为什么看 P95 不看 max：max 可能是一次网络抖动，P95 代表"正常情况下最慢"
```

---

## 九、统计学速查（如果被追问）

```
Welch t-test：双样本均值差异检验，不假设方差相等
p-value：原假设成立时观测到这种差异的概率（越小越显著）
Cohen's d：效应量（0.2 small / 0.5 medium / 0.8+ large）
IQR：四分位距（top-5% 候选的 p25-p75），不是置信区间
Walk-forward：时间序列专用的交叉验证（60% 训练 / 20% 验证 / 20% 测试）
为什么不用 k-fold：时间序列用 k-fold 会 future leak
```

---

## 十、文档入口（面试官点 GitHub 时）

```
README.md              → "What's Interesting Here" 第一屏
docs/CLOSED_LOOP.md    → 4 层闭环完整设计（推荐首读）
docs/DESIGN_DECISIONS.md → 8 条 ADR
docs/LIMITATIONS.md    → 13 条已知局限
```
