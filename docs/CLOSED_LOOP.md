# Data Closed-Loop Architecture

> 让 Agent 自己学着调阈值，而不是靠人拍脑袋。

## 问题

Security Agent 的检测器（price_impact / liquidity_flow / sandwich）使用硬编码阈值。
部署后没有人知道这些阈值对不对——误报了没人统计，漏报了没人发现。
这是一个**开环系统**：fire and forget。

## 解法：4 层数据闭环

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Layer 1: 在线统计 (alert-feedback.ts)                         │
│   ─────────────────────────────────────                         │
│   触发 → pending → 30s 后结算 → hit/miss → 在线命中率           │
│                                                                 │
│   Layer 2: 多检测器结算 (security-feedback.ts)                  │
│   ─────────────────────────────────────────────                 │
│   price_impact:   用户交易后 → |实际-预测|/预测 ≤ 20%?          │
│   liquidity_flow: 1 小时后 → TVL 跌了 5%+?                     │
│   sandwich:       10 ledger 后 → 嫌疑地址获利了?                │
│   24h 未结算 → expired（不计入 precision，报 expirationRate）   │
│                                                                 │
│   Layer 3: 参数优化 (parameter-optimizer.ts)                    │
│   ─────────────────────────────────────────                     │
│   Monte Carlo 500 iter + walk-forward 60/20/20                  │
│   输出：推荐值 + IQR 置信区间                                   │
│   例：onlineWeight = 0.62 [0.55, 0.68]                          │
│                                                                 │
│   Layer 4: HITL 调参桥接 (alert-feedback-tuning.ts)             │
│   ─────────────────────────────────────────────────             │
│   优化器输出 → 建议卡 → 用户点 Apply → 持久化新参数             │
│   永不自动生效                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 文件地图（按阅读顺序）

| 文件 | 行数 | 职责 |
|------|------|------|
| `lib/agent/alert-feedback.ts` | 345 | Layer 1: 价格警报的 trigger → settle → suggest |
| `lib/agent/security-feedback.ts` | 547 | Layer 2: 三个检测器各自的结算规则 + stats |
| `lib/agent/parameter-optimizer.ts` | ~200 | Layer 3: 通用蒙特卡洛 + 网格搜索框架 |
| `lib/agent/alert-feedback-tuning.ts` | ~325 | Layer 4: 桥接优化器 → 建议引擎参数 |

## 系统级不变量（全部 enforced + tested）

这三条不变量贯穿所有 4 层，是系统的安全保证：

### 1. 禁止前瞻偏差（No Future Leak）

```typescript
// alert-feedback.ts:147, security-feedback.ts:174
if (observedAt <= rec.triggeredAt) return rec;  // 拒收同时或更早的价格
```

结算只用"触发之后的第一笔观察到的价格"。不用未来 N 笔平均。
测试：`__tests__/alert-feedback.test.ts:89` — "does not settle from stale observation"

### 2. 结算幂等（Idempotent Settlement）

```typescript
// alert-feedback.ts:146, security-feedback.ts:171
if (rec.outcome !== "pending") return rec;  // 已结算的不再动
```

一旦标记为 hit/miss/confirmed/false_positive，后续价格变化不会改写历史。
测试：`__tests__/alert-feedback.test.ts:98` — "only settles each pending record once"

### 3. HITL 不自动改（Human-in-the-Loop）

```typescript
// alert-feedback.ts:230 注释
// The function never mutates the alert; it only proposes a new target price
// which the UI must surface for HITL confirmation.
```

`suggestThreshold` 和 `suggestSecurityThresholds` 只返回建议对象，不修改任何状态。
用户在 UI 上点 "Apply" 才执行"删旧建新"。
测试：`__tests__/alert-feedback.test.ts:171` — "never mutates the underlying alert object"

## Layer 2 结算规则详解

| 检测器 | 结算时机 | 判定 confirmed | 判定 false_positive |
|--------|---------|---------------|-------------------|
| price_impact | 用户实际交易后 | \|实际滑点 - 预测\| / 预测 ≤ 20% | > 20% |
| liquidity_flow | 触发 1 小时后 | currentTvl < tvlAtTrigger × 0.95 | TVL 稳定或上升 |
| sandwich | 触发 10 ledger 后 | 嫌疑地址有反向 round-trip 且获利 | 无后续操作 |
| 全部 | 24h 仍 pending | — | 标 expired，不计入 precision |

接入点：
- `settleByTvlChange` + `expirePending` → `hooks/usePriceAlerts.ts` 30s 轮询
- `settleByExecutedSwap` → `app/agent/page.tsx` handleSign 回调

## Layer 3 参数优化器

替代"拍脑袋"的硬编码阈值。核心属性：

- **Mulberry32 种子化 PRNG** → 同种子同结果，CI 可复现
- **Walk-forward 60/20/20** → 训练集找参数、验证集挑选、测试集只跑一次
- **Top-5% 中位数 + IQR** → 输出 "0.62 [0.55–0.68]" 而不是 "0.6 我觉得"
- **过拟合检测** → trainScore vs testScore 差距过大时标 `overfitFlag`

## 自我审查记录

开发完成后 review 发现 3 个问题，已修复：

| Issue | 类型 | 问题 | 修复 commit |
|-------|------|------|------------|
| #1 | Bug | Security settler 写了没接入前端轮询 | `9d76add` |
| #2 | Tradeoff | 参数优化器 simulator 是 surrogate 不是真逻辑 | `bccf363` |
| #3 | Metric 缺失 | expired 记录让 precision 虚高 | `9d76add` |

## 指标定义

```typescript
// SecurityStats (security-feedback.ts)
{
  precision,            // confirmed / (confirmed + falsePositives)
  expirationRate,       // expired / total — >30% 时 precision 不可信
  effectiveSampleRate,  // (confirmed + falsePositives) / total
  confidence,           // ≥5 settled = high, 3-4 = medium, <3 = low
}
```

## 与 V2 回测的关系

`alert-backtest-v2.ts` 是离线回测（用历史数据验证检测器）。
数据闭环是在线学习（用真实触发结果持续更新统计）。
两者在 `suggestThreshold` 里加权合并：

```
combinedAccuracy = onlineHitRate × onlineWeight + offlineAccuracy × (1 - onlineWeight)
```

onlineWeight 的值由 Layer 3 参数优化器数据驱动确定。
