# Interview Preparation — Stellar-Pay Multi-Agent DeFi DApp

**Audience:** Web3 Agent role technical interviewer, likely with quant/audit background.
**Format:** Oral presentation, no slides. GitHub link + Vercel demo as evidence.
**Demo URL:** https://stellar-pay-dapp-five.vercel.app/loop

---

## 核心数字（背熟，每个都有出处）

| 指标 | 数值 | 类型 | 出处 |
|---|---|---|---|
| Router 准确率 | 83–90%（区间） | 软数字（LLM 随机性） | `data/benchmark-report.json` |
| Tool Precision | **100%** | 硬数字（确定性） | benchmark 所有跑次 |
| Safety Reject Rate | **100%**（4/4） | 硬数字（确定性） | benchmark 所有跑次 |
| L1 单 Agent ToolRecall | **100%** | 硬数字 | benchmark L1 子集 |
| L3 多 Agent ToolRecall | 62.5% | 软数字（已知短板） | benchmark L3 子集 |
| 调优 vs 默认 | Cohen's d=1.14, p<0.001 | 统计显著 | `/loop/methods` 实测 |
| 端到端 P50 | 11s（含 testnet RPC） | 实测 | benchmark runner |
| Router P50 | 2.4–3.0s | 实测 | benchmark runner |
| 测试覆盖 | 902/902 | 确定性 | `npm test` |
| 检测器数量 | 6 | 确定性 | 代码 |
| price_impact precision | 86% | 软数字（demo seed） | `/loop` dashboard |

**软数字 vs 硬数字的区别：**
- 硬数字：每次跑都一样，不依赖 LLM 随机性
- 软数字：n=30 时 95% CI = ±10.7%，单次跑分不稳定

---

## 8 分钟口述脚本

### 0:00–0:30 — 开场钩子

> "我做了一个 Stellar 上的 multi-agent DApp，4 个 sub-agent 处理意图分类、查询、交易、安全检测。今天重点讲的不是 agent 本身，是 **agent 自己学着调阈值**——4 层数据闭环。"

### 0:30–1:30 — 为什么用 AI（检测器是规则，AI 是决策层）

> "6 个风险检测器全是规则驱动的纯函数——if 数字 > 阈值就报警。检测器本身不需要 AI。
>
> AI 的价值在三个地方：
> 1. **工具选择**——'池子安全吗'和'我想换 500 TKNA 安全吗'需要调的工具完全不同，Router 理解意图后按需调用
> 2. **跨工具综合推理**——滑点 2% + 流动性流出 18% 单独看不致命，组合起来意味着'实际滑点可能远超预期'
> 3. **Agentic Loop**——Agent 看到第一轮结果后自主决定要不要再查，用户只说一句话 Agent 可能跑 2-3 轮"

### 1:30–3:00 — 4 层数据闭环（指着 /loop 页面）

> "Layer 1：每次检测器报警后，用下一笔真实数据验证报得对不对，累计命中率。
>
> Layer 2：6 个检测器各有自己的结算规则——price_impact 用实际成交滑点验证，liquidity_flow 等 1 小时看 TVL，sandwich 追踪嫌疑地址获利。
>
> Layer 3：Monte Carlo 在 3,589 个真实价格点上跑 500 次，walk-forward CV 防过拟合。
>
> Layer 4：优化器只建议，用户点 Apply 才生效——HITL 不变量。"

### 3:00–4:30 — 统计验证（指着 /loop/methods）

> "方法对比：30 次重复实验 × 4 方法，标准化 budget=500。
>
> 核心结论：**任何调优方法都显著优于硬编码默认参数**（Cohen's d=1.14，large effect，p<0.001）。
>
> 反直觉发现：在 5 维参数空间下，Grid Search 比 Monte Carlo 更好——低维空间穷举覆盖赢过随机采样。这和 HPO 文献一致，写在 ADR-8 里。"

### 4:30–5:30 — Benchmark 量化（30 条实测）

> "我有 30 条标注 benchmark，分 3 个难度等级。
>
> 硬数字（每次跑都一样）：Tool Precision 100%、Safety Reject 100%、L1 ToolRecall 100%。
>
> 软数字（n=30 置信区间 ±10.7%）：Router 准确率 83–90% 区间。
>
> 我做了 ablation study 隔离 prompt 修复的贡献——保持数据集不变只改 prompt，Router 从 80% 升到 86.7%；标注规范化再贡献 +3.3pp。
>
> 还有一个负面结果：L3 多 Agent 协同 ToolRecall 62.5%，三组测试都一样——prompt 修复完全没改善这个，说明问题在 dispatcher 层。"

### 5:30–6:30 — 自我审查（最有差异化的部分）

> "自己 review 时发现并修了 6 个问题，每个有 commit 记录：
>
> 1. Security settler 写了没接入轮询（commit 9d76add）
> 2. Surrogate simulator 重构成真跑（commit bccf363）
> 3. Expired 记录让 precision 虚高，加了 expirationRate
> 4. Selection bias——next-1-tick 系统性偏低，加了 K-tick averaging
> 5. IQR 不是 CI——重命名 + JSDoc 注明
> 6. Imbalance 的 confirmed/false_positive 标反了
>
> 还有一个主动撤回的 claim：之前说'Safety 从 75% 提升到 100% 是 prompt 修复的功劳'——ablation 显示 baseline 就是 100%，那个 75% 是单次测试误差。"

### 6:30–7:30 — 局限主动披露

> "15 条已知局限写在 `docs/LIMITATIONS.md` 里。最重要的三条：
>
> L14：n=30 置信区间 ±10.7%，Router 准确率是软数字，扩展到 150 条才能缩小到 ±5.7%。
>
> L15：ablation 结果——prompt 贡献 +6.7pp，标注规范化贡献 +3.3pp，Safety 提升是测量误差。
>
> L5：数据集是 XLM 代理不是 TKNA/TKNB，形状对、数值不可移植。"

### 7:30–8:00 — 收尾

> "整套思路核心是：**audit 不是'我什么都做对了'，是'我知道什么是错的，标出来，能修的修，不能修的承认'**。
>
> 代码仓库里有 15 条 LIMITATIONS、8 条 ADR、ablation study 结果——这些本身就是 audit 思维的现实证据。"

---

## 10 个最可能的追问 + 准备好的答案

### Q1: "你的检测器都是 if-else，为什么需要 Agent？"

> "检测器是规则，AI 是决策层和表达层。AI 的价值：工具选择（按需调用不是全跑）、跨工具综合推理（因果链）、Agentic Loop（自主多轮）。眼睛不需要 AI，大脑需要。"

### Q2: "Router 准确率 83-90%，置信区间是多少？"

> "n=30，p≈0.85，95% CI = ±10.7%，区间 [74%, 97%]。这就是为什么要扩展到 150 条——把 CI 缩小到 ±5.7%。"

### Q3: "你的 ablation study 怎么做的？"

> "三组：A=原 prompt + 原 dataset，B=新 prompt + 原 dataset，C=新 prompt + 修正 dataset。B vs A 隔离 prompt 效果（+6.7pp），C vs B 隔离标注效果（+3.3pp）。Safety 100% 在三组都一样——之前说 prompt 修复了 Safety 是错的，已撤回。"

### Q4: "为什么 Welch 不用 paired t-test？"

> "不同方法用独立采样，没有自然配对；Welch 不假设方差相等——Grid std≈0，Random 高方差，Student's 会算错。"

### Q5: "Cohen's d = 1.14 是什么意思？"

> "标准化效应量。0.2=small, 0.5=medium, 0.8+=large。1.14 是 large effect——不只是统计上显著，差异大到实际有意义。"

### Q6: "你的数据集是 XLM，但检测器跑在 TKNA/TKNB 上，不是不匹配吗？"

> "对，匹配不上。XLM 是行为代理，因为 testnet 代币没真实 feed。形状对、数值不可移植——上线前要换成真实 token pair 的数据。写在 ADR-7 和 LIMITATIONS L5 里。"

### Q7: "L3 多 Agent 协同 ToolRecall 只有 62.5%，为什么？"

> "三组 ablation 测试都是 62.5%——prompt 修复完全没改善。说明问题在 dispatcher 层：复杂查询时 Agent 倾向用对话回复而不是调工具。需要 dispatcher 强制工具调用作为 follow-up，不是单个 Agent prompt 能解决的。"

### Q8: "Vercel serverless 的 rate limit 是 per-instance 的，不是全局的？"

> "对，这是 LIMITATIONS L3。已经加了 `DistributedRateLimiter` 包装，配置 Vercel KV 后变成全局状态。当前 demo 没配 KV，走 in-memory fallback——429 响应里会标明哪条路径在跑。"

### Q9: "你的 IQR 是真置信区间吗？"

> "不是。IQR 是 Monte Carlo top-5% 候选的四分位距，衡量搜索稳定性，不是估计的不确定性。真正 CI 要 bootstrap-with-replacement。字段已从 `confidenceInterval` 重命名为 `iqr`，JSDoc 注明。写在 LIMITATIONS L1 里。"

### Q10: "你的 benchmark 标注是你自己做的，有没有 inter-annotator agreement？"

> "单人标注，没有 inter-annotator agreement。这是 LIMITATIONS 里应该加的一条。生产环境应该有 2 人独立标注 + Cohen's kappa。但 demo 级别，acceptableIntents 的宽容机制是合理折中。"

---

## 红线（千万别说）

| ❌ 不要说 | ✅ 改说 |
|---|---|
| "Safety 从 75% 提升到 100%" | "Safety 在所有测试中都是 100%，之前那个 75% 是测量误差" |
| "三个修复全部生效" | "ablation 显示 prompt 修复贡献 +6.7pp，标注修复贡献 +3.3pp，L3 没改善" |
| "Router 准确率 90%" | "Router 准确率 83–90% 区间，n=30 置信区间 ±10.7%" |
| "我用了 LangChain" | "全手写 SDK，不依赖 LangChain/AutoGen" |
| "Monte Carlo 优于 Random Search" | "在 5 维空间下 MC 和 Random 无差异，Grid 反而最好" |
| "K2-audit-grade invariants" | "audit-aware invariants，unit-tested，不是 property-based test" |

---

## 面试前 checklist

- [ ] 打开 Safari → `https://stellar-pay-dapp-five.vercel.app/loop`
- [ ] 点 [加载 Demo 数据]，确认 Layer 1-2 有数据
- [ ] 点 [立即调优]，记住 baseline delta 数字
- [ ] 切到 `/loop/methods`，点 [运行对比]，记住 "Tuned vs Default" 的 p-value 和 Cohen's d
- [ ] 打开 GitHub → `docs/LIMITATIONS.md` 确认 L14/L15 在
- [ ] 对着空气讲一遍 8 分钟脚本，卡的地方标出来
