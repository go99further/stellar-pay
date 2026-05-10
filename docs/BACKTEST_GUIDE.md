# 警报回测系统 - 数据闭环指南

## 概述

警报回测系统通过历史交易数据验证价格警报的准确性，形成完整的数据闭环：

```
历史交易 → 提取价格 → 模拟触发 → 统计准确率 → 优化警报
    ↑                                              ↓
    └──────────────── 反馈循环 ────────────────────┘
```

## 核心功能

### 1. 数据提取
从 `TransactionHistory` 自动提取价格序列：
- **Swap 交易**: `price = amountOut / amountIn`
- **Liquidity 操作**: `price = amountB / amountA`
- 按时间排序，支持 50 条历史记录

### 2. 回测引擎
模拟价格变化，检查警报触发：
- **触发检测**: 价格达到阈值时标记触发
- **准确性验证**: 检查触发后价格是否朝预期方向变化
- **延迟计算**: 从触发到最佳交易点的时间差

### 3. 统计指标
- **命中率**: 准确触发 / 总触发次数
- **误报率**: 错误触发 / 总触发次数
- **平均延迟**: 触发到最佳交易点的平均时间
- **收益模拟**: 按警报交易 vs 买入持有的收益对比

## 使用方法

### 在 UI 中使用

1. **生成历史数据**
   - 执行几笔 swap 交易（至少 5 笔）
   - 交易会自动保存到 `TransactionHistory`

2. **设置价格警报**
   - 打开 "Price Alerts" 面板
   - 创建 1-2 个警报（例如：突破 1.2，跌破 0.9）

3. **运行回测**
   - 点击 "📊 Backtest" 按钮
   - 查看回测结果面板

4. **分析结果**
   - 查看准确率、误报率
   - 查看收益模拟（按警报交易 vs 不设警报）
   - 根据建议调整警报阈值

### 编程方式使用

```typescript
import { backtestAlerts, generateBacktestReport } from "@/lib/agent/alert-backtest";
import { getAlerts } from "@/lib/agent/price-alerts";

// 获取当前警报
const alerts = getAlerts();

// 运行回测
const result = backtestAlerts(alerts);

// 生成报告
const report = generateBacktestReport(result);
console.log(report);

// 访问详细数据
console.log("准确率:", (result.accurateAlerts / result.triggeredAlerts * 100).toFixed(1) + "%");
console.log("收益改进:", result.profitSimulation.improvement + "%");
```

## 回测结果解读

### 准确率指标

| 准确率 | 评级 | 建议 |
|--------|------|------|
| ≥ 80% | 优秀 | 保持当前设置 |
| 50-80% | 一般 | 调整阈值，减少误报 |
| < 50% | 较差 | 重新设计警报策略 |

### 收益模拟

- **正值**: 警报系统有效，能提升收益
- **负值**: 警报系统无效，建议调整或禁用
- **接近 0**: 警报系统中性，可能需要更多数据

### 常见警告

#### ⚠️ "历史数据中未触发任何警报"
**原因**: 警报阈值设置过高/过低，历史价格未达到
**解决**: 
- 降低/提高警报阈值
- 等待更多交易数据
- 查看历史价格范围，设置合理阈值

#### ⚠️ "所有触发均为误报"
**原因**: 警报条件与市场趋势不匹配
**解决**:
- 反转警报条件（above ↔ below）
- 调整阈值到更显著的价格点
- 考虑使用移动平均等更复杂的策略

## 数据闭环示例

### 场景：优化突破警报

**初始设置**:
```
Alert: TKNA/TKNB 突破 1.1 (买入信号)
```

**回测结果**:
```
准确率: 40% (2/5 触发)
收益改进: -3%
```

**分析**: 1.1 阈值太低，频繁误报

**优化**:
```
Alert: TKNA/TKNB 突破 1.2 (买入信号)
```

**新回测结果**:
```
准确率: 85% (6/7 触发)
收益改进: +8%
```

**结论**: 提高阈值后，准确率和收益显著提升

## 技术实现

### 价格提取算法

```typescript
function extractPrice(tx: TransactionRecord): number | null {
  if (tx.type === "swap") {
    const amountIn = parseAmount(tx.details.amountIn);
    const amountOut = parseAmount(tx.details.amountOut);
    const tokenIn = tx.details.tokenIn;
    
    // TKNA → TKNB: price = amountOut / amountIn
    // TKNB → TKNA: price = amountIn / amountOut
    return tokenIn.includes("TKNA") 
      ? amountOut / amountIn 
      : amountIn / amountOut;
  }
  // ... liquidity operations
}
```

### 准确性验证

```typescript
function isAlertAccurate(
  alert: PriceAlert,
  triggerPrice: number,
  nextPoints: PricePoint[]
): boolean {
  const avgNextPrice = 
    nextPoints.reduce((sum, p) => sum + p.price, 0) / nextPoints.length;
  
  if (alert.condition === "above") {
    // 突破后期望继续上涨
    return avgNextPrice > triggerPrice;
  } else {
    // 跌破后期望继续下跌
    return avgNextPrice < triggerPrice;
  }
}
```

### 收益模拟

```typescript
function simulateProfit(
  pricePoints: PricePoint[],
  triggeredPoints: TriggeredPoint[]
): ProfitSimulation {
  // 不设警报：买入持有
  const withoutAlert = 
    (lastPrice - firstPrice) / firstPrice * 100;
  
  // 设警报：在触发点交易
  let withAlert = 0;
  for (const triggered of triggeredPoints) {
    if (triggered.accurate) {
      // 简化模型：准确触发 = +5% 收益
      withAlert += 5;
    }
  }
  
  return {
    withAlert,
    withoutAlert,
    improvement: withAlert - withoutAlert
  };
}
```

## 限制与改进方向

### 当前限制

1. **数据量**: 最多 50 条历史记录
2. **简化模型**: 收益模拟使用固定 5% 假设
3. **单一指标**: 只考虑价格，不考虑成交量、流动性
4. **无滑点**: 假设能在触发价格成交

### 改进方向

1. **更复杂的收益模型**
   - 考虑实际滑点
   - 考虑交易手续费
   - 使用真实的后续价格变化

2. **多维度分析**
   - 加入成交量指标
   - 加入流动性深度
   - 加入时间衰减因子

3. **机器学习优化**
   - 自动调整警报阈值
   - 预测最佳触发时机
   - 多因子组合策略

4. **实时反馈**
   - 警报触发后自动跟踪后续表现
   - 动态调整准确率统计
   - 推送优化建议

## 面试要点

### 为什么需要回测？

**表面答案**: 验证警报系统是否有效

**深度答案**: 
- **数据驱动**: 用历史数据验证假设，避免主观判断
- **快速迭代**: 无需等待实时数据，立即验证策略
- **风险控制**: 在真实交易前发现问题
- **闭环优化**: 形成"数据 → 分析 → 优化 → 验证"的完整循环

### 为什么用历史交易而不是实时价格？

**表面答案**: 历史数据已经存在，不需要额外获取

**深度答案**:
- **真实性**: 历史交易是用户实际执行的，反映真实市场行为
- **完整性**: 包含价格、时间、交易类型等多维信息
- **可重现**: 回测结果可重现，便于调试和优化
- **成本**: 无需调用外部 API，零成本

### 如何处理数据不足？

**表面答案**: 提示用户执行更多交易

**深度答案**:
- **合成数据**: 基于已有数据生成模拟价格序列
- **外部数据**: 从 Stellar DEX 获取历史 OHLCV 数据
- **降级策略**: 数据不足时显示置信区间，而非绝对结论
- **增量学习**: 随着数据积累，逐步提高预测准确性

## 总结

警报回测系统通过历史数据验证警报策略，形成完整的数据闭环：

1. ✅ **自动化**: 无需手动收集数据，自动从交易历史提取
2. ✅ **可视化**: 直观显示准确率、收益模拟等关键指标
3. ✅ **可操作**: 提供具体的优化建议，而非模糊的统计数字
4. ✅ **可扩展**: 易于添加新的统计指标和优化策略

这是一个**最简单但完整**的数据闭环实现，展示了如何用最少的代码实现最大的价值。
