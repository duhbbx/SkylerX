#!/usr/bin/env bash
# generate-release-notes.sh
#
# 用 DeepSeek (deepseek-chat / V3) 把当前 tag 的 commits 总结成中英双语 release notes.
#
# Usage:
#   bash scripts/generate-release-notes.sh <current_tag> [previous_tag]
#
# 没传 previous_tag 时,用 git describe --abbrev=0 --tags <cur>^ 推断上一个 tag.
#
# Env:
#   DEEPSEEK_API_KEY    必填. 没配/无效时降级为"裸 commit list" body,不抛错.
#   GITHUB_REPOSITORY   选填. 给 Full Changelog 链接用, 默认 'duhbbx/SkylerX'.
#
# Output:
#   stdout = Markdown body, 可直接喂给 `gh release create --notes-file -`.
#   stderr = API 调用日志 / 错误.
#
# 设计取舍:
#   - DeepSeek 而非 Anthropic/OpenAI: 用户已有 DeepSeek key, 中英双语强项, 便宜.
#   - 中文 prompt: SkylerX 主要面向中国大陆 + 海外开发者, 中文 prompt 让模型
#     能更准地从中文 commit message 提炼用户视角变化 (英文段它会自己翻译).
#   - temperature 0.3: release notes 要稳, 不要每次跑出不同结果. 不用 0 避免
#     过于死板, 0.3 留一点表达灵活度.
#   - max_tokens 2048: 一份 rc release notes 通常 <1000 token, 2048 足够 + 留 buffer.
#   - API 失败降级为 raw commit list: 保证 CI 不挂; 用户看到 raw list 就知道
#     哪里出问题, 自己手动 edit release body 补救.

set -euo pipefail

cur="${1:?missing current tag, usage: $0 <tag> [prev_tag]}"
prev="${2:-}"

if [ -z "$prev" ]; then
  # cur^ = cur 的 parent commit; describe 找它最近的 tag = 上一个 release.
  # 第一次发版时没有 prev tag, || true 兜底.
  prev=$(git describe --abbrev=0 --tags "${cur}^" 2>/dev/null || true)
fi

range="${prev:+${prev}..}${cur}"

# --no-merges 排除 merge commits (单人 repo 也可能有 GitHub 上 squash merge)
# %s = subject (commit message 第一行)
log=$(git log --no-merges --pretty=format:'- %s' "$range" 2>/dev/null || true)

if [ -z "$log" ]; then
  log="(no commits since ${prev:-initial})"
fi

repo="${GITHUB_REPOSITORY:-duhbbx/SkylerX}"

# 构造 prompt — 中文体, 输出严格 markdown 双语段
prompt=$(cat <<EOF
你是 SkylerX (跨平台桌面数据库管理工具) 的发布主理人。下面是从上一个 tag ${prev:-初始} 到 ${cur} 之间的 commit log:

${log}

请生成一份 release notes, 严格按以下格式输出 (Markdown):

## ✨ What's New
- ...

## 🐛 Fixes
- ...

## ⚡ Performance / Internals
- ...

---

## ✨ 本次更新
- ...

## 🐛 修复
- ...

## ⚡ 性能 / 内部改进
- ...

要求:
1. 英文段在前, 中文段在后, 中间用一行 --- 隔开
2. 聚合同类型 commits, 删去用户无感知的内部 commits (纯 ci/chore/test 除非影响发版)
3. 用户视角描述, 不照搬 commit message 字面, 提炼"用户能看到的变化"
4. 没有内容的小节直接省略, 不要写 "(无)" 或留空小节
5. 不要加任何前言/后言/解释, 直接输出 markdown 主体
6. 短小精炼, 每条一行, 不要 commit hash, 不要作者名
EOF
)

# DeepSeek API (OpenAI 兼容协议)
body=$(jq -nc --arg p "$prompt" '{
  model: "deepseek-chat",
  messages: [{role: "user", content: $p}],
  temperature: 0.3,
  max_tokens: 2048,
  stream: false
}')

echo "[release-notes] calling DeepSeek for $range ..." >&2

resp=$(curl -sS --max-time 60 -X POST https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY:-}" \
  -H "Content-Type: application/json" \
  -d "$body" || echo '')

content=$(printf '%s' "$resp" | jq -r '.choices[0].message.content // empty' 2>/dev/null || true)

if [ -z "$content" ]; then
  echo "[release-notes] DeepSeek API failed or empty, falling back to raw commit list" >&2
  printf '%s' "$resp" | head -c 600 >&2
  echo >&2
  content="## Changes

${log}"
fi

# 附 Full Changelog 链接
if [ -n "$prev" ]; then
  printf '%s\n\n---\n**Full Changelog**: https://github.com/%s/compare/%s...%s\n' \
    "$content" "$repo" "$prev" "$cur"
else
  printf '%s\n' "$content"
fi
