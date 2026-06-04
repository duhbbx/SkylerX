/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 检索。向量检索(余弦)+ 词法检索(词频/重叠,兜底)。纯函数,可单测。
 */
import type { RagChunk } from './corpus'

export interface Scored {
  chunk: RagChunk
  score: number
}

/** 余弦相似度。 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 向量检索:query 向量对每个 chunk 向量算余弦,取 top-K。 */
export function vectorSearch(
  queryVec: ArrayLike<number>,
  items: Array<{ chunk: RagChunk; vec: ArrayLike<number> }>,
  k: number,
): Scored[] {
  return items
    .map((it) => ({ chunk: it.chunk, score: cosine(queryVec, it.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/** 分词:小写,按非字母数字切;CJK 逐字。 */
export function tokenize(s: string): string[] {
  const lower = (s ?? '').toLowerCase()
  const out: string[] = []
  for (const m of lower.matchAll(/[a-z0-9_]+|[一-鿿]/g)) out.push(m[0])
  return out
}

/** 词法检索:query 词在 chunk(标题加权)里的命中量,取 top-K(score>0)。 */
export function lexicalSearch(query: string, chunks: RagChunk[], k: number): Scored[] {
  const qTokens = [...new Set(tokenize(query))]
  if (!qTokens.length) return []
  return chunks
    .map((chunk) => {
      const title = tokenize(chunk.title)
      const body = tokenize(chunk.text)
      const titleSet = new Set(title)
      const bodyCount = new Map<string, number>()
      for (const t of body) bodyCount.set(t, (bodyCount.get(t) ?? 0) + 1)
      let score = 0
      for (const q of qTokens) {
        if (titleSet.has(q)) score += 3 // 表名/标题命中权重高
        score += Math.min(3, bodyCount.get(q) ?? 0) // 正文 TF 封顶
      }
      return { chunk, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
