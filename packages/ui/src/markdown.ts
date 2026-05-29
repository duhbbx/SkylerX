/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI 聊天里把 assistant 文本块（非 SQL 部分）渲染成 HTML 的工具。
 *
 * 之前直接 `<pre>{{content}}</pre>` 导致 **粗体** / > 引用 / 列表 全部以裸 Markdown
 * 显示。这里用 `marked` 解析；SQL 块外面已经 splitParts 切出去单独高亮，所以这里
 * 收到的字符串通常不含 ```sql 围栏，但保留 marked 默认行为以防极端情况。
 *
 * 安全性：marked 默认不会执行 script，但 v-html 仍然会把 <img onerror> 这类执行掉。
 * 因为对话内容来自我们自己的 LLM（受控 prompt + 拒答能力），加之这是桌面 app 自身
 * 渲染器（非真正网页环境，document 没有跨源），暂不引入 DOMPurify；如未来上 Web 版
 * 必须补一个 sanitize。
 */
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true, // 单换行就 <br>，更贴近 ChatGPT 风格
})

const cache = new Map<string, string>()

export function renderMarkdown(src: string): string {
  if (!src) return ''
  const hit = cache.get(src)
  if (hit !== undefined) return hit
  let html: string
  try {
    html = marked.parse(src, { async: false }) as string
  } catch {
    html = escapeHtml(src)
  }
  // 简单 LRU：超过 200 条丢最早的一条
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  cache.set(src, html)
  return html
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
