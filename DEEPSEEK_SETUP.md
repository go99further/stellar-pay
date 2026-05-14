# DeepSeek API 集成指南

## 🎯 为什么选择 DeepSeek？

- **成本优势**: DeepSeek API 比 Claude API 便宜约 10-20 倍
- **兼容性**: 使用 OpenAI 兼容格式，易于集成
- **性能**: V4 系列在中文和代码理解上表现优秀

## 📝 设置步骤

### 1. 获取 DeepSeek API Key

访问 [DeepSeek 开放平台](https://platform.deepseek.com/)：
1. 注册账号
2. 进入 API Keys 页面
3. 创建新的 API Key
4. 复制 Key（格式：`sk-...`）

### 2. 配置环境变量

编辑 `.env.local` 文件：

```bash
# 使用 DeepSeek（推荐）
DEEPSEEK_API_KEY=sk-your-deepseek-key-here

# 或者使用 Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
```

**注意**: 只需要设置其中一个。如果两个都设置了，系统会优先使用 DeepSeek。

### 3. 重启开发服务器

```bash
npm run dev
```

## 🔄 自动适配机制

系统会自动检测使用哪个 API，并按职责分配模型：

```typescript
// lib/agent/anthropic.ts
const USE_DEEPSEEK = Boolean(process.env.DEEPSEEK_API_KEY);

// Router 用 v4-flash（快/便宜，意图分类够用）
export const MODEL_ROUTER = USE_DEEPSEEK ? "deepseek-v4-flash" : "claude-haiku-4-5-20251001";

// Sub-agent 用 v4-pro（推理执行需要更强能力）
export const MODEL_ANALYTICS = USE_DEEPSEEK ? "deepseek-v4-pro" : "claude-sonnet-4-6";
```

可通过 `MODEL_ROUTER` / `MODEL_ANALYTICS` 环境变量覆盖默认值。

### V4 模型说明

| 模型 | 用途 | 备注 |
|---|---|---|
| `deepseek-v4-flash` | Router (意图分类) | 当前默认，快/便宜 |
| `deepseek-v4-pro` | 子 Agent (执行) | 当前默认，推理能力更强 |
| `deepseek-chat` / `deepseek-reasoner` | Legacy | **2026/07/24 弃用**，分别对应 v4-flash 的非思考与思考模式 |

## 📊 API 对比

| 特性 | DeepSeek | Anthropic Claude |
|------|----------|------------------|
| **价格** | ¥1/百万 tokens | $3/百万 tokens (Haiku) |
| **中文支持** | 优秀 | 良好 |
| **代码理解** | 优秀 | 优秀 |
| **工具调用** | 支持 | 原生支持 |
| **流式输出** | 支持 | 支持 |

## 🧪 测试

设置好 API Key 后，访问 http://localhost:3000/agent 测试：

```
输入: "当前池子的 TKNA 储备量是多少？"
预期: Router 分类为 "analytics"，Analytics Agent 返回储备量数据
```

## 🔧 技术实现

### 适配器模式

我们使用适配器模式将 OpenAI 格式转换为 Anthropic 格式：

```typescript
// lib/agent/openai-adapter.ts
export function convertAnthropicToOpenAI(
  messages: Anthropic.MessageParam[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[]

export function convertAnthropicToolsToOpenAI(
  tools: Anthropic.Tool[]
): OpenAI.Chat.Completions.ChatCompletionTool[]
```

### 流式响应转换

```typescript
export async function* streamOpenAIToAnthropic(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
): AsyncGenerator<AnthropicLikeEvent>
```

## 🚀 生产环境部署

在 Vercel 或其他平台部署时，设置环境变量：

```bash
# Vercel CLI
vercel env add DEEPSEEK_API_KEY

# 或在 Vercel Dashboard 中设置
# Settings → Environment Variables → Add
```

## 💡 最佳实践

1. **开发环境**: 使用 DeepSeek（成本低）
2. **生产环境**: 根据需求选择
   - 中文用户为主 → DeepSeek
   - 英文用户为主 → Claude
3. **监控**: 记录 API 调用次数和成本

## 🐛 故障排查

### 问题 1: "DEEPSEEK_API_KEY is not set"

**解决**: 检查 `.env.local` 文件是否存在且包含正确的 Key

```bash
cat .env.local | grep DEEPSEEK
```

### 问题 2: API 调用失败

**解决**: 检查 API Key 是否有效

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 问题 3: 工具调用不工作

**解决**: DeepSeek 的工具调用格式与 OpenAI 完全兼容，检查工具定义是否正确

## 📚 相关文档

- [DeepSeek API 文档](https://platform.deepseek.com/api-docs/)
- [OpenAI API 参考](https://platform.openai.com/docs/api-reference)
- [项目架构文档](./AGENT_ARCHITECTURE.md)
