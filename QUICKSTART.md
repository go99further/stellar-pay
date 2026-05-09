# 🚀 快速开始指南

## ✅ 已完成的工作

### Phase 1: 核心交易流程 ✅
- ConfirmationCard 组件（美观的交易确认 UI）
- ToolCallStatus 组件（12 种工具状态可视化）
- 历史对话持久化（localStorage）
- `/api/agent/confirm` 端点

### DeepSeek API 集成 ✅
- OpenAI 适配器（格式转换）
- 自动提供商检测
- 成本降低 10-20 倍

## 📝 设置步骤

### 1. 获取 DeepSeek API Key

访问 https://platform.deepseek.com/
1. 注册账号
2. 创建 API Key
3. 复制 Key（格式：`sk-...`）

### 2. 配置环境变量

```bash
# 编辑 .env.local
echo 'DEEPSEEK_API_KEY=sk-your-key-here' >> .env.local
```

### 3. 启动开发服务器

```bash
npm run dev
```

服务器将在 http://localhost:3000 启动

### 4. 测试 Multi-Agent 功能

打开浏览器访问 http://localhost:3000/agent

## 🧪 测试场景

### 场景 1: Analytics Agent（只读查询）
```
输入: "当前池子的 TKNA 和 TKNB 储备量是多少？"

预期流程:
1. Router 分类为 "analytics"
2. 显示 "📊 Fetching pool reserves..."
3. 返回储备量数据
```

### 场景 2: Trading Agent - 模拟交易
```
输入: "模拟用 10 TKNA 换 TKNB"

预期流程:
1. Router 分类为 "trading"
2. 显示 "🔄 Simulating swap..."
3. 返回预估输出、滑点、价格影响
```

### 场景 3: Trading Agent - 完整交易流程
```
输入: "用 10 TKNA 换 TKNB，滑点不超过 1%"

预期流程:
1. 显示 "🔄 Simulating swap..."
2. 显示 "🔨 Building swap transaction..."
3. 弹出 ConfirmationCard（显示详细信息）
   - Selling: 10 TKNA
   - Minimum Received: ~9.97 TKNB
   - Price Impact: 0.X%
   - Slippage Tolerance: 1%
4. 点击 "Sign & Submit"
5. Freighter 钱包弹出签名请求
6. 签名后提交到 Stellar 网络
7. 显示交易哈希和 Stellar Expert 链接
```

### 场景 4: Security Agent - 风险分析
```
输入: "这个池子现在安全吗？有没有异常活动？"

预期流程:
1. Router 分类为 "security"
2. 显示 "🔍 Analyzing liquidity depth..."
3. 显示 "🚨 Scanning for anomalies..."
4. 返回风险评估报告（low/medium/high）
```

### 场景 5: 历史持久化
```
操作步骤:
1. 进行 2-3 次对话
2. 刷新页面（Cmd+R 或 F5）
3. ✅ 验证对话历史恢复
4. 点击右上角 "Clear" 按钮
5. ✅ 验证历史清空
```

## 🎯 验收标准

Phase 1 测试通过的标志：

- ✅ Router 正确分类意图（analytics/trading/security/clarify）
- ✅ 工具调用状态实时显示（图标 + 动画 + 状态）
- ✅ ConfirmationCard 显示完整交易信息
- ✅ 历史对话在刷新后恢复（但 pendingXdr 不恢复）
- ✅ 所有 Agent 都能正常响应
- ✅ DeepSeek API 正常工作

## 🔧 自动化测试

运行集成测试脚本：

```bash
node scripts/test-phase1.js
```

预期输出：
```
🚀 Starting Phase 1 Integration Tests
============================================================

🔍 Test 1: Health Check
✅ Health check passed
   Latest ledger: 2466XXX

🔍 Test 2: Router Agent - Intent Classification
✅ "What's the current TKNA price?" → analytics
✅ "Swap 100 TKNA for TKNB" → trading
✅ "Is this pool safe?" → security

🔍 Test 3: Analytics Agent - Pool Stats Query
✅ Analytics agent called get_pool_stats and returned text
   Tools called: get_pool_stats

🔍 Test 4: Trading Agent - Swap Simulation
✅ Trading agent called simulate_swap
   Tools called: simulate_swap

🔍 Test 5: Security Agent - Risk Analysis
✅ Security agent called risk analysis tools
   Tools called: scan_recent_anomalies, analyze_liquidity_depth

============================================================

📊 Test Results:
   Passed: 5/5
   Failed: 0/5

✅ All tests passed! Ready for Phase 2 implementation.
```

## 📚 相关文档

- [DEEPSEEK_SETUP.md](./DEEPSEEK_SETUP.md) - DeepSeek API 详细设置
- [PHASE1_COMPLETE.md](./PHASE1_COMPLETE.md) - Phase 1 完成清单
- [AGENT_ARCHITECTURE.md](./AGENT_ARCHITECTURE.md) - 完整架构文档

## 🐛 常见问题

### Q1: "DEEPSEEK_API_KEY is not set"
**A**: 检查 `.env.local` 文件是否存在且包含正确的 Key

```bash
cat .env.local | grep DEEPSEEK
```

### Q2: 工具调用没有显示状态
**A**: 确保使用的是最新代码，清除浏览器缓存后重试

### Q3: Freighter 钱包未弹出
**A**: 
1. 确保已安装 Freighter 扩展
2. 点击页面右上角 "Connect Wallet"
3. 在 Freighter 中授权连接

### Q4: 交易失败
**A**: 检查：
1. 钱包是否有足够的 XLM（用于手续费）
2. 钱包是否有足够的 TKNA/TKNB
3. 滑点设置是否合理

## 🎉 下一步

测试通过后，我们将实现 Phase 2 的高级特性：

1. **多轮上下文理解** - "再换 50 TKNA" 能引用上文
2. **批量操作支持** - "先换 100 TKNA，然后添加流动性"
3. **智能滑点建议** - 根据池子深度自动推荐滑点
4. **交易历史记录** - 显示用户的历史交易
5. **价格预警** - 价格变动超过阈值时提醒

---

**准备好了吗？设置好 DeepSeek API Key 后告诉我，我们马上开始测试！** 🚀
