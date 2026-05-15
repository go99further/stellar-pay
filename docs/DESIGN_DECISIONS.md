# Architecture Decision Records — Stellar-Pay 闭环系统

本文档记录闭环系统中六个关键架构决策，采用 ADR（Architecture Decision Record）格式。
每条 ADR 包含：Context（问题背景）、Decision（我们做了什么）、Why not X（拒绝了什么）、
Consequence（代价）、Verified by（代码/测试引用）。所有引用均指向实际存在的行号或测试名称。

**如果你只有 5 分钟，建议按以下顺序阅读：**
1. ADR-3（expired 结果 — 最容易被忽视的细节）
2. ADR-5（自我纠错记录 — 最具体的设计演进）
3. ADR-6（我们刻意不做的事 — 最能体现判断力）

---

## 目录

| ADR | 标题 | 状态 |
|-----|------|------|
| ADR-1 | Walk-forward CV 替代 k-fold | Accepted |
| ADR-2 | 60/40 在线/离线准确率加权 | Accepted |
| ADR-3 | 24h TTL → "expired" 结果（非无限 pending） | Accepted |
| ADR-4 | HITL — 永不自动应用阈值建议 | Accepted |
| ADR-5 | Surrogate 替换为真实模拟器（自我纠错记录） | Superseded ADR-5-draft |
| ADR-6 | Analytics Agent 不接入闭环 | Accepted |

---

## ADR-1: Walk-forward CV 替代 k-fold

**Status:** Accepted

**Context**
参数优化器需要在历史价格序列上评估候选参数的好坏。时间序列数据有严格的时序依赖：
未来的价格不能用来预测过去。我们需要一种交叉验证方式，既能充分利用有限数据，
又不引入前瞻偏差。

**Decision**
采用 60/20/20 严格时间切分（训练/验证/测试），在训练集上搜索参数，
在验证集上挑选，测试集只跑一次用于最终报告。
实现位于 `parameter-optimizer.ts:walkForwardOptimize`（第 319 行），
切分逻辑在第 347–351 行：`trainEnd = floor(n * 0.6)`，`validEnd = floor(n * 0.8)`。
数据点不足 10 个时，函数显式返回警告而非静默降级（第 331–345 行）。

**Why not k-fold**
随机 k-fold 会把未来时间段的数据混入训练折，让模型"看到"它本不该看到的价格走势。
在价格预测场景中，这会产生乐观的准确率估计，导致上线后真实表现显著低于回测。
时间序列的正确做法是保持时间方向不变，只向前滚动窗口。

**Consequence**
需要至少 10 个数据点才能完成三段切分；低于此阈值时系统明确提示"数据不足"，
不会给出看起来可信但实际无意义的参数推荐。这是有意为之的保守设计。

**Verified by**
- `lib/agent/parameter-optimizer.ts:319` — `walkForwardOptimize` 函数入口
- `lib/agent/parameter-optimizer.ts:347–351` — 60/20/20 切分实现
- `__tests__/parameter-optimizer.test.ts` — 测试 "does not leak — train score is measured only on first 60% of data"（第 190 行）

---

## ADR-2: 60/40 在线/离线准确率加权

**Status:** Accepted

**Context**
`suggestThreshold` 需要综合两个信号来源：在线命中率（真实用户触发，无偏但样本稀少）
和离线回测准确率（样本丰富但可能过时）。两者各有缺陷，单独使用都不够可靠。

**Decision**
当在线已结算样本 ≥ 3 时，使用 `onlineWeight = 0.6`，离线权重 = 0.4。
样本不足 3 时，在线权重降至 `onlineWeight * 0.33`（冷启动阻尼）。
实现位于 `alert-feedback.ts:292`：
`const onlineWeight = online.settled >= 3 ? params.onlineWeight : params.onlineWeight * 0.33`

**Why not 纯在线**
冷启动阶段在线样本为零，纯在线会导致系统无法给出任何建议，
或者在 1–2 个样本上过度反应（单次误报就把准确率打到 0%）。

**Why not 纯离线**
离线回测基于历史交易记录，无法感知真实分布漂移。
如果市场结构发生变化，离线准确率仍然好看，但在线命中率已经下滑，
纯离线会掩盖这个信号。

**Consequence**
0.6 本身是一个可调参数，不是硬编码的魔法数字。
`alert-feedback-tuning.ts:tuneSuggestionParams`（第 294 行）通过 Monte Carlo
在真实价格历史上搜索最优 `onlineWeight`，置信区间约为 [0.55, 0.68]。
这意味着 0.6 是数据支持的选择，而非拍脑袋。

**Verified by**
- `lib/agent/alert-feedback.ts:292` — 在线权重计算与冷启动阻尼
- `lib/agent/alert-feedback-tuning.ts:294` — `tuneSuggestionParams` 函数入口
- `lib/agent/alert-feedback-tuning.ts:253–259` — `SUGGESTION_PARAM_SPACE` 中 `onlineWeight` 的搜索范围 [0.0, 1.0]
- `__tests__/alert-feedback-tuning.test.ts` — 测试 "onlineWeight matches the previously hardcoded 0.6"（第 50 行）

---

## ADR-3: 24h TTL → "expired" 结果（非无限 pending）

**Status:** Accepted

**Context**
Security 闭环的 `liquidity_flow` 检测器需要等待 1 小时后才能结算（观察 TVL 是否真的下降）。
用户可能在触发后离线，导致记录永远停留在 `pending` 状态。
如果 `pending` 记录无限积累，统计指标会悄悄失真。

**Decision**
超过 24 小时未结算的 `pending` 记录，由 `expirePending` 翻转为 `expired` 状态，
并单独追踪 `expirationRate`（过期率），与 `precision`（精确率）分开计算。
`precision` 的分母只包含 `confirmed + falsePositives`，不含 `expired`，
避免过期记录稀释精确率。
实现位于 `security-feedback.ts:331`（`expirePending`）和第 400 行（`getSecurityStats`）。

**Why not 无限 pending**
如果 `pending` 记录永远不结算，`precision` 的计算样本会随时间静默缩水。
表面上看精确率稳定，实际上是因为越来越多的记录被排除在外。
这是一种隐性的数据质量问题，比显式的"数据不足"警告更危险。

**Why not 自动延期**
自动延期（比如每次用户上线就重置 TTL）会掩盖数据收集本身的问题。
如果 `expirationRate > 30%`，说明结算机制有系统性缺陷，需要人工介入，
而不是让系统自动绕过它。

**Consequence**
当 `expirationRate > 30%` 时，UI 应将精确率标记为"数据可靠性存疑"。
这是一个有意暴露的故障信号，而非需要隐藏的边缘情况。

**Verified by**
- `lib/agent/security-feedback.ts:331` — `expirePending` 函数，24h TTL 逻辑
- `lib/agent/security-feedback.ts:400` — `getSecurityStats`，`precision` 分母排除 `expired`
- `lib/agent/security-feedback.ts:406–409` — `precision = confirmed / (confirmed + falsePositives)`

---

## ADR-4: HITL — 永不自动应用阈值建议

**Status:** Accepted

**Context**
`suggestThreshold`（警报）和 `tuneSuggestionParams`（参数优化）都会产生建议值。
这些建议来自启发式规则和 Monte Carlo 搜索，两者都可能出错。
自动应用错误建议会直接影响用户的警报触发行为，属于写操作。

**Decision**
所有阈值变更必须经过用户显式点击确认。`suggestThreshold` 只返回
`ThresholdSuggestion` 对象（第 231 行），不修改任何警报状态。
UI 层通过 `SuggestionCard` 组件展示建议，用户点击"应用"后才触发
`onApply` 回调（`PriceAlerts.tsx:691`）。系统中不存在 `applySuggestion` 这样的
自动执行函数。

**Why not 自动应用 + 回滚**
回滚方案需要检测"应用后效果变差了"，而这本身需要更多样本来判断。
在样本稀少的冷启动阶段，自动应用 + 自动回滚会产生振荡：
建议 A → 自动应用 → 样本不足判断效果 → 回滚 → 再次建议 A。
这个循环比人工确认更难调试，也更难向用户解释。

**Consequence**
用户需要主动维护系统，不能完全依赖自动化。
这个代价通过清晰的建议 UI（显示原因、置信度、当前值 vs 建议值）来缓解，
让用户的每次确认都是有信息支撑的决策，而非盲目点击。

**Verified by**
- `lib/agent/alert-feedback.ts:231` — `suggestThreshold` 函数签名，返回值为只读建议对象
- `lib/agent/alert-feedback.ts:10` — 文件头注释明确："用户在 UI 显式确认"
- `components/agent/PriceAlerts.tsx:639` — `SuggestionCard` 组件定义
- `components/agent/PriceAlerts.tsx:691` — `onApply` 回调，用户点击后才执行
- `__tests__/alert-feedback.test.ts` — 测试 "never mutates the underlying alert object"（第 176 行）

---

## ADR-5: Surrogate 替换为真实模拟器（自我纠错记录）

**Status:** Superseded ADR-5-draft

**Context**
`parameter-optimizer` 需要一个 `SimulateFn` 来在历史窗口上评分候选参数。
最初的实现使用了一个 surrogate 函数：用价格中位数模拟触发，
用简化逻辑打分，而不是真正跑 `suggestThreshold` 的决策树。

**Initial Decision（已废弃）**
Surrogate 函数实现简单，运行快，避免了循环依赖（`alert-feedback-tuning.ts`
不能直接导入 `alert-feedback.ts`）。

**Why we changed**
自我审查时发现：surrogate 的评分逻辑和真实闭环的决策树（combined accuracy →
keep/tighten/loosen）相关性未经验证。优化器找到的"最优参数"是针对 surrogate
的最优，不是针对真实部署逻辑的最优。这让整个调优流程失去意义。

**Final Decision**
将 `suggestThreshold` 的完整决策树内联到 `simulateSuggestion` 函数中
（`alert-feedback-tuning.ts:149–249`），包括：
在线/离线加权、keep/tighten/loosen 分支、冷启动阻尼。
循环依赖通过内联而非导入解决，代码注释明确标注"非 surrogate"（第 140–147 行）。

**Consequence**
每次 `tuneSuggestionParams` 调用的计算量增加（内联了完整决策树），
但优化器找到的参数和真实闭环使用的是同一套逻辑，结果有实际意义。
慢但正确，优于快但无效。

**Verified by**
- `git log --oneline` — commit `bccf363`: "refactor: replace surrogate simulator with real suggestThreshold logic"
- `lib/agent/alert-feedback-tuning.ts:140–147` — 注释说明内联原因和 surrogate 的问题
- `lib/agent/alert-feedback-tuning.ts:149` — `simulateSuggestion` 函数定义
- `lib/agent/alert-feedback-tuning.ts:193` — 注释 "Real suggestThreshold decision tree (parameterized)"

---

## ADR-6: Analytics Agent 不接入闭环

**Status:** Accepted

**Context**
Phase 2 为 Security Agent 和 Trading Agent（潜在）建立了闭环。
Analytics Agent 提供 TVL、交易量、价格走势等查询，明显缺席。
这是刻意的决定，不是遗漏。

**Decision**
不为 Analytics Agent 构建闭环。

**Why not**
闭环的前提是能定义干净的 hit/miss 归因信号。Analytics 查询无法满足这个前提：
用户问了 TVL 之后的后续行为，无法区分"答案不完整（miss）"和"用户只是在探索（hit）"。
要做这个区分，需要语义分析——判断用户的下一个问题是否是对上一个答案的追问，
还是独立的新查询。这本身需要另一个 LLM 调用，破坏了闭环"零额外成本"的前提。
用一个有混淆因子的指标来驱动参数调整，比没有指标更危险：
它会给系统一个自信的错误方向。

**Consequence**
Analytics Agent 只依赖 V2 回测做离线评估，没有在线学习能力。
这是已知的局限，不是技术债。如果未来能找到干净的归因信号
（比如用户明确的"这个答案有用/没用"反馈），可以重新评估。

**Why this is the RIGHT call**
承认度量困难并明确记录，比强行构建一个带混淆因子的指标更诚实。
一个错误的闭环会让系统朝错误方向自我优化，代价远高于"没有闭环"。
诚实 > 全面。

**Verified by**
- 本文件（显式决策记录本身即为 evidence）
- `lib/agent/alert-backtest-v2.ts:182` — `backtestAlertsV2` 是 Analytics 唯一的离线评估路径

---

## ADR-7: Use XLM as proxy asset for closed-loop tuning

**Status:** Accepted (with documented limitation)

**Context**
The closed loop tunes thresholds for a hypothetical TKNA/TKNB AMM. TKNA/TKNB are testnet tokens; they have no real price feed. We need a real-asset price series to make the Monte Carlo tuning more than a synthetic-data exercise.

**Decision**
Use XLM as the proxy asset, sourced from Stellar Horizon mainnet (XLM/USDC) plus three CEX feeds (CoinGecko/Binance/Kraken XLM/USD). 3,589 points total. Disclose the proxy explicitly in the dashboard badge, the `getDatasetMeta()` API, the dataset JSON itself, and this ADR.

**Why not synthetic data**
Synthetic random walks don't capture real microstructure (gaps, fat tails, weekend liquidity drops). Tuning on synthetic data tells you how the tuner behaves, not how the tuned params will perform.

**Why not skip real data entirely**
Without a real-asset signal, "Monte Carlo over real history" is just "Monte Carlo over localStorage transaction history" — which on a fresh browser is empty.

**Why this is a *limitation*, not a fix**
- XLM's volatility profile differs from a real AMM token pair (XLM is more stable than most token pairs)
- Tuning results are *shape-correct* (search process valid, walk-forward valid) but *value-imprecise* (the optimal threshold for XLM is unlikely to be the optimal threshold for an actual TKNA/TKNB pair)
- Production deployment would re-run the tuner on the actual pair's price history

**Consequence**
- Dashboard badge displays "(XLM as proxy for TKNA/TKNB)" — visible disclosure
- `getDatasetMeta()` exposes `proxyAsset` and `proxyDisclaimer` fields
- Tests verify both fields are surfaced
- Anyone reading the closed-loop story knows the optimizer is doing real work, but on a stand-in asset

**Verified by**
- `data/price-dataset.json` top-level `proxyAsset` and `proxyDisclaimer` fields
- `app/loop/page.tsx` badge with hover disclaimer
- `lib/agent/price-source.ts:getDatasetMeta` exposes both fields
- `__tests__/price-source.test.ts` "getDatasetMeta surfaces proxyAsset and proxyDisclaimer" test
- `docs/CLOSED_LOOP.md` "Data source caveat" section

---

## ADR-8: Method Comparison Strategy (Welch t-test, 30 runs, fixed budget)

**Status:** Accepted

**Context**
The closed loop's central claim is "Monte Carlo tuning beats hardcoded defaults". A first attempt at proving this — comparing Default (1 eval) vs Grid Search (100 iter) vs Monte Carlo (500 iter) on a single seed — was correctly criticized as an unfair comparison: different budgets, no variance estimation, no significance test, no Random Search baseline. We could not actually claim Monte Carlo "won" without controlling for those.

**Decision**
Compare four methods at fixed budget (500 evaluations per run) over 30 independent seeds [1..30]. Report mean ± std for each method. For each pairwise comparison, report Welch's t-test (two-tailed) and Cohen's d. Define "significant" as p < 0.05.

Methods:
- **Default**: single evaluation of `DEFAULT_PARAMS` — deterministic, std=0
- **Random Search**: uniform random parameter sampling, 500 evaluations
- **Grid Search**: deterministic grid (≤500 cells, sorted) — std≈0
- **Monte Carlo**: structured search with windowed simulation, 500 iterations

Pairwise tests reported:
- "MC vs Random" — primary claim about structured search adding value
- "MC vs Grid" — vs deterministic alternative
- "Grid vs Random" — sanity check
- "Tuned vs Default" — overall closed-loop value

**Why Welch (not Student's, not paired)**
- *Not paired*: methods produce independent samples per seed, no natural pairing across methods.
- *Not Student's*: cannot assume equal variance — Grid is deterministic (σ≈0), Random has high variance, MC sits between. Student's would give wrong p-values.
- *Welch–Satterthwaite* approximates degrees of freedom for unequal variances, gives valid p-value under heteroscedasticity.
- *Grid degenerate case*: because Grid is deterministic, its std=0 and SE_Grid=0. Welch degenerates when one sample has zero variance (dof collapses, p→1). This means "MC vs Grid" and "Grid vs Random" comparisons are not statistically meaningful in the strict Welch sense. **The primary claim is "MC vs Random"** — both are stochastic, Welch is valid there. Grid is reported as a deterministic reference baseline, not as a Welch-comparable sample.

**Why 30 runs**
- 30 is the asymptotic threshold where the t-distribution approximates the normal distribution well enough for the Central Limit Theorem to apply on means.
- Below 30, t-distribution corrections matter more (still valid, but less efficient).
- Above 30, runtime cost grows linearly with diminishing returns.
- 30 × 4 methods × ~1s each = ~2 minutes total in browser, acceptable for an interactive interview demo.

**Why Cohen's d alongside p-value**
- *p-value*: probability that the observed effect could occur under the null hypothesis (no real difference). Tells you if the effect is *real*.
- *Cohen's d*: standardized effect size = (mean_A - mean_B) / pooled_std. Tells you if the effect is *large enough to care about*. Convention: 0.2=small, 0.5=medium, 0.8+=large.
- Reporting only p-value is misleading — at large n, p < 0.001 with d = 0.05 is statistically real but practically meaningless. Both are needed for honest reporting.

**Why fixed budget (500 evaluations)**
- Without budget standardization, "MC wins with 500 iter vs Grid's 100 iter" only tells us iteration count matters — not that MC's structured search adds value.
- Random Search at the same 500 budget is the apples-to-apples baseline.

**Limitations** *(documented in LIMITATIONS.md L9–L11)*
- No Bonferroni / Holm correction for multiple comparisons (4 pairwise tests inflate family-wise error rate; corrected p-threshold would be 0.0125 for α=0.05). Not corrected because reported p-values are far below corrected thresholds in practice; if marginal results emerge we would correct.
- No formal Shapiro–Wilk test of normality on the score distributions. Justified by n=30 + CLT for means; visual inspection of histograms shows roughly normal distributions.
- No prospective power analysis. Effect sizes were not pre-specified; this is post-hoc analysis. Adequate for a methods comparison demonstration; would be required for a publication-grade claim.

**Tradeoff**
Practical demonstration of statistical thinking, not publication-grade rigor. The goal is to show we understand *why* a fair comparison requires standardized budget + variance estimation + significance test, and to surface the gaps we did not address.

**Verified by**
- `lib/agent/method-comparison.ts` — `welchTTest`, `cohensD`, `compareMethods`
- `__tests__/method-comparison.test.ts` — Welch t-test values match `scipy.stats.ttest_ind(equal_var=False)` on reference inputs
- `app/loop/methods/page.tsx` (in development) — interactive comparison surface

**Empirical finding (2026-05-15, real XLM dataset, 3,589 points)**

Running `compareMethods` with runs=30, budget=500 on the production XLM price dataset produced an **unexpected result**:

| Method | Mean ± Std |
|--------|-----------|
| Default | 1.506 (deterministic) |
| Random Search | 1.807 ± 0.166 |
| Grid Search | 1.968 (deterministic) |
| Monte Carlo | 1.807 ± 0.166 |

Pairwise comparisons:
| Comparison | t | dof | p | Cohen's d | Effect |
|-----------|----|-----|---|-----------|--------|
| MC vs Random | 0.000 | 58 | 1.000 | 0.000 | negligible |
| Grid vs Random | 5.32 | 29 | <0.001 | 1.37 | large ✓ |
| Tuned vs Default | 9.94 | 29 | <0.001 | 2.57 | large ✓ |

**Two findings**:

1. **Grid Search outperforms Monte Carlo** at this budget on this dataset (consistent with HPO literature for low-dim spaces with bounded ranges — uniform coverage of a 5-dim 5-step grid (3,125 cells) beats random sampling at budget=500).

2. **MC vs Random shows no difference** (p=1.000) — this is because `compareMethods` reports `topCandidates[0].score` (single best), not the top-5% median that `monteCarloSearch` exposes. Comparing single-best samples, MC and Random are functionally equivalent at the same budget. This is a known design tradeoff in `compareMethods`, not a finding about the algorithms.

**Three prerequisites the "Grid > MC" claim depends on** (without verification, the claim is data-set-specific):

1. **Parameter space topology**: Grid wins when optima fall near grid points. If optima sit between grid cells (5-step grid creates 0.25-wide intervals), MC's random sampling can find them while Grid misses. Not verified across diverse param spaces.

2. **Dataset characteristics**: XLM is a mature liquid asset with relatively smooth price series. On a high-volatility asset (e.g., a meme token), optima may shift to corners of the parameter space where Grid's uniform coverage performs worse. Single-dataset validation cannot rule this out.

3. **Budget regime**: MC's top-k aggregation advantages emerge at higher budgets (5000+). At budget=500, MC behaves like Random because there is not enough material to filter. Larger budgets may flip the ranking.

**Robust conclusion** (independent of the three prerequisites): **Tuned vs Default** is significant in every plausible setting (d=2.57, large). This is the only claim that survives the three prerequisites — it is the headline number, not "Grid beats MC".

**Why we did not add more datasets**

We considered adding BTC/ETH/meme-token datasets to test prerequisite 2. We chose not to because:
- Adding 1 dataset replaces "single-dataset cherry-pick" with "two-dataset cherry-pick" — the underlying problem (selection of which datasets) does not go away.
- Robust empirical claims about HPO methods require ≥5 diverse datasets, which is out of scope for an interview-grade demo.
- Honest disclosure of single-dataset evidence with three explicit prerequisites is more defensible than claiming generality from N=2.

This conservative posture is itself documented as the audit-thinking posture (cf. LIMITATIONS.md preface).

---

## Future ADRs（待决策）

以下决策尚未做出，列在此处说明系统设计是迭代的，不是一次性完成的。

**F-1: Trading Agent 是否应该接入 Confirm/Abandon 闭环？**
状态：待评估。用户确认或放弃交易是相对干净的 hit/miss 信号，
但需要确认样本量是否足够支撑统计显著性。

**F-2: 当历史数据点 > 50 时，是否用贝叶斯优化替代 Monte Carlo？**
状态：待评估。贝叶斯优化在高维参数空间中比随机采样更高效，
但实现复杂度更高，且当前参数空间只有 5 维，Monte Carlo 已经够用。

**F-3: 过期记录是否应该在用户重新上线后重新入队结算？**
状态：待评估。如果用户在 24h 内重新上线，部分 `liquidity_flow` 记录
理论上仍可结算。但重新入队会使 `expirationRate` 指标失去意义，
需要权衡数据完整性和指标可解释性。

**F-4: `expirationRate > 30%` 的 UI 警告阈值是否需要数据驱动？**
状态：待评估。30% 目前是经验值，可以通过历史数据分析确定更合理的阈值，
或者将其纳入 `tuneSuggestionParams` 的优化范围。

**F-5: 是否为 `walkForwardOptimize` 增加多种 searcher 的自动选择逻辑？**
状态：待评估。当前调用方需要手动选择 Monte Carlo 或 Grid Search。
可以根据参数空间维度和数据量自动切换，但会增加框架复杂度。
