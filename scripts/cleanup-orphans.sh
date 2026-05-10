#!/usr/bin/env bash
#
# cleanup-orphans.sh
# 删除 lib/agent/ 下未被主流程引用的孤儿文件
#
# 基于对 app/api/agent/route.ts 开始的 import 链追踪
# 所有操作用 git rm，可逆：要恢复就 `git checkout HEAD -- <path>`
#
# 用法：
#   bash scripts/cleanup-orphans.sh
#

set -e  # 任何命令失败立即停止

cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo "🗑  清理 lib/agent/ 下的孤儿文件"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📌 清理前状态:"
echo "  根目录 ts 文件: $(ls lib/agent/*.ts 2>/dev/null | wc -l | xargs)"
echo "  总测试文件: $(ls __tests__/ 2>/dev/null | wc -l | xargs)"
echo ""

# ─────────────────────────────────────────────
# 批次 1：算法数据结构（DeFi 项目用不到）
# ─────────────────────────────────────────────
echo "── 批次 1/6: 算法数据结构 ──"
git rm --ignore-unmatch \
  lib/agent/bloom-filter.ts \
  lib/agent/interval-tree.ts \
  lib/agent/trie.ts \
  lib/agent/priority-queue.ts \
  lib/agent/object-pool.ts \
  2>&1 | tail -5
echo ""

# ─────────────────────────────────────────────
# 批次 2：并发原语（JS 用不到这些）
# ─────────────────────────────────────────────
echo "── 批次 2/6: 并发原语 ──"
git rm --ignore-unmatch \
  lib/agent/semaphore.ts \
  lib/agent/sliding-window-limiter.ts \
  lib/agent/token-bucket.ts \
  lib/agent/work-queue.ts \
  2>&1 | tail -4
echo ""

# ─────────────────────────────────────────────
# 批次 3：企业级模式（过度抽象）
# ─────────────────────────────────────────────
echo "── 批次 3/6: 企业级模式（过度抽象）──"
git rm --ignore-unmatch \
  lib/agent/cqrs.ts \
  lib/agent/event-sourcing.ts \
  lib/agent/saga.ts \
  lib/agent/di-container.ts \
  lib/agent/repository.ts \
  lib/agent/specification.ts \
  lib/agent/command-bus.ts \
  lib/agent/outbox.ts \
  lib/agent/plugin-system.ts \
  2>&1 | tail -9
echo ""

# ─────────────────────────────────────────────
# 批次 4：示例/文档类（不是产品代码）
# ─────────────────────────────────────────────
echo "── 批次 4/6: 示例/文档 ──"
git rm --ignore-unmatch \
  lib/agent/PRODUCTION_PATTERNS.ts \
  lib/agent/production-patterns-example.ts \
  2>&1 | tail -2
echo ""

# ─────────────────────────────────────────────
# 批次 5：v2/冗余版本（主流程未引用）
# ─────────────────────────────────────────────
echo "── 批次 5/6: 冗余 v2 版本 ──"
git rm --ignore-unmatch \
  lib/agent/circuit-breaker.ts \
  lib/agent/circuit-breaker-v2.ts \
  lib/agent/rate-limiter.ts \
  lib/agent/rate-limiter-sliding.ts \
  lib/agent/config-manager.ts \
  lib/agent/feature-flags.ts \
  lib/agent/retry-policy.ts \
  2>&1 | tail -7
echo ""

# ─────────────────────────────────────────────
# 批次 6：其他未用的孤儿
# ─────────────────────────────────────────────
echo "── 批次 6/6: 其他孤儿 ──"
git rm --ignore-unmatch \
  lib/agent/actor.ts \
  lib/agent/bulkhead.ts \
  lib/agent/cache-aside.ts \
  lib/agent/decorators.ts \
  lib/agent/event-bus.ts \
  lib/agent/graph.ts \
  lib/agent/logger.ts \
  lib/agent/lru-cache.ts \
  lib/agent/pipeline.ts \
  lib/agent/query-builder.ts \
  lib/agent/registry.ts \
  lib/agent/scheduler.ts \
  lib/agent/slos.ts \
  lib/agent/state-machine.ts \
  lib/agent/time-series.ts \
  2>&1 | tail -15
echo ""

# ─────────────────────────────────────────────
# 对应测试文件也删
# ─────────────────────────────────────────────
echo "── 对应测试文件 ──"
git rm --ignore-unmatch \
  __tests__/bloom-filter.test.ts \
  __tests__/interval-tree.test.ts \
  __tests__/trie.test.ts \
  __tests__/priority-queue.test.ts \
  __tests__/object-pool.test.ts \
  __tests__/semaphore.test.ts \
  __tests__/sliding-window-limiter.test.ts \
  __tests__/token-bucket.test.ts \
  __tests__/work-queue.test.ts \
  __tests__/cqrs.test.ts \
  __tests__/event-sourcing.test.ts \
  __tests__/saga.test.ts \
  __tests__/di-container.test.ts \
  __tests__/repository.test.ts \
  __tests__/specification.test.ts \
  __tests__/command-bus.test.ts \
  __tests__/outbox.test.ts \
  __tests__/plugin-system.test.ts \
  __tests__/circuit-breaker.test.ts \
  __tests__/circuit-breaker-v2.test.ts \
  __tests__/rate-limiter.test.ts \
  __tests__/config-manager.test.ts \
  __tests__/config-manager-v2.test.ts \
  __tests__/feature-flags.test.ts \
  __tests__/feature-flags-v2.test.ts \
  __tests__/retry-policy.test.ts \
  __tests__/actor.test.ts \
  __tests__/bulkhead.test.ts \
  __tests__/cache-aside.test.ts \
  __tests__/decorators.test.ts \
  __tests__/event-bus.test.ts \
  __tests__/graph.test.ts \
  __tests__/lru-cache.test.ts \
  __tests__/pipeline.test.ts \
  __tests__/query-builder.test.ts \
  __tests__/registry.test.ts \
  __tests__/scheduler.test.ts \
  __tests__/slos.test.ts \
  __tests__/state-machine.test.ts \
  __tests__/time-series.test.ts \
  __tests__/connection-pool.test.ts \
  2>&1 | tail -5

echo ""
echo "════════════════════════════════════════════════════════"
echo "✅ 清理完成"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📌 清理后状态:"
echo "  根目录 ts 文件: $(ls lib/agent/*.ts 2>/dev/null | wc -l | xargs)"
echo "  总测试文件: $(ls __tests__/ 2>/dev/null | wc -l | xargs)"
echo ""
echo "📋 下一步（按顺序执行）:"
echo "  1. npx tsc --noEmit   验证没有断开的 import"
echo "  2. npm test           验证测试全绿"
echo "  3. git diff --stat    看改动总览"
echo ""
echo "⚠️  如果 tsc 报错 'Cannot find module'，说明我漏判了某个文件的依赖关系"
echo "    恢复方法: git checkout HEAD -- lib/agent/<被报错的文件>.ts"
echo ""
echo "📝 子目录清理（lib/agent/errors/ history/ learning/ ...）留到下一轮"
echo "    这些需要更仔细的追踪，不在本次清理范围内"
