#!/usr/bin/env bash
#
# consolidate-docs.sh
# P1 文档整理：8 份 MD → 2 份（README.md + ARCHITECTURE.md）+ docs/ 归档
#
# 前提：README.md 已由 AI 重写（1 分钟看懂版）
#
# 用法：
#   bash scripts/consolidate-docs.sh
#

set -e

cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo "📝 文档整理：8 份 MD → 2 份 + docs/ 归档"
echo "════════════════════════════════════════════════════════"
echo ""

echo "📌 当前根目录 MD 文件:"
ls *.md 2>/dev/null
echo ""

# ─────────────────────────────────────────────
# Step 1: 重命名主架构文档
# ─────────────────────────────────────────────
echo "── Step 1: AGENT_ARCHITECTURE.md → ARCHITECTURE.md ──"
if [ -f "AGENT_ARCHITECTURE.md" ]; then
  git mv AGENT_ARCHITECTURE.md ARCHITECTURE.md
  echo "  ✅ 重命名完成"
else
  echo "  ⚠️ AGENT_ARCHITECTURE.md 不存在，跳过"
fi
echo ""

# ─────────────────────────────────────────────
# Step 2: 删除遗迹类文档（用 git log 代替）
# ─────────────────────────────────────────────
echo "── Step 2: 删除迭代/完成类文档（用 git log 代替）──"
git rm --ignore-unmatch \
  PHASE1_COMPLETE.md \
  ITERATION_17-20_REPORT.md \
  2>&1 | tail -2
echo ""

# ─────────────────────────────────────────────
# Step 3: 内容已合并到 README 的文档，删除
# ─────────────────────────────────────────────
echo "── Step 3: 删除已合并入 README 的文档 ──"
git rm --ignore-unmatch \
  DEEPSEEK_SETUP.md \
  QUICKSTART.md \
  2>&1 | tail -2
echo ""

# ─────────────────────────────────────────────
# Step 4: 生成产物归档到 docs/
# ─────────────────────────────────────────────
echo "── Step 4: BACKTEST_REPORT.md 归档到 docs/ ──"
mkdir -p docs
if [ -f "BACKTEST_REPORT.md" ]; then
  git mv BACKTEST_REPORT.md docs/BACKTEST_REPORT.md
  echo "  ✅ 归档完成"
else
  echo "  ⚠️ BACKTEST_REPORT.md 不存在，跳过"
fi
echo ""

# ─────────────────────────────────────────────
# 完成状态
# ─────────────────────────────────────────────
echo "════════════════════════════════════════════════════════"
echo "✅ 文档整理完成"
echo "════════════════════════════════════════════════════════"
echo ""
echo "📌 整理后的根目录 MD:"
ls *.md 2>/dev/null
echo ""
echo "📌 docs/ 目录:"
ls docs/ 2>/dev/null
echo ""
echo "🎯 预期的最终结构:"
echo "  ./"
echo "  ├── README.md          ← 对外入口（1 分钟看懂）"
echo "  ├── ARCHITECTURE.md    ← 技术架构详解"
echo "  ├── SECURITY.md        ← 安全 checklist"
echo "  └── docs/"
echo "      ├── BACKTEST_REPORT.md"
echo "      ├── BACKTEST_GUIDE.md"
echo "      └── V1_VS_V2_COMPARISON.md"
echo ""
echo "📋 下一步（按顺序执行）:"
echo "  1. 检查新 README.md 内容是否准确"
echo "  2. 检查 ARCHITECTURE.md 是否需要更新（删掉过时的文件结构图）"
echo "  3. git diff --stat 看改动总览"
echo "  4. git commit"
