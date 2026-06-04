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

/**
 * Reciprocal Rank Fusion:把多路检索(向量 / 词法)的排名融合成一份。
 * score = Σ 1/(k0 + rank);只看名次不看原始分,天然把量纲不同的两路拉到一起。
 * 向量管语义、词法管精确名字/ID,融合后两边的强项都保留。
 */
export function rrfFuse(lists: Scored[][], k0 = 60, topK = 10): Scored[] {
  const acc = new Map<string, Scored>()
  for (const list of lists) {
    list.forEach((s, rank) => {
      const add = 1 / (k0 + rank + 1)
      const prev = acc.get(s.chunk.id)
      if (prev) prev.score += add
      else acc.set(s.chunk.id, { chunk: s.chunk, score: add })
    })
  }
  return [...acc.values()].sort((a, b) => b.score - a.score).slice(0, topK)
}

/** 相关度地板:丢掉低于「最高分 × ratio」的命中(至少留 1 个),少塞噪音、省 token。 */
export function applyFloor(hits: Scored[], ratio = 0.35): Scored[] {
  if (hits.length <= 1) return hits
  const floor = hits[0].score * ratio
  return hits.filter((h, i) => i === 0 || h.score >= floor)
}

/** 分词:小写,按非字母数字切;CJK 逐字。 */
export function tokenize(s: string): string[] {
  const lower = (s ?? '').toLowerCase()
  const out: string[] = []
  for (const m of lower.matchAll(/[a-z0-9_]+|[一-鿿]/g)) out.push(m[0])
  return out
}

/**
 * 词法检索(BM25)。IDF 自动压低「每张表都有」的词(id/numeric/varchar…),只让区分度高的词加分;
 * 标题(表名)token 复制一份做加权。取 top-K(score>0)。
 */
export function lexicalSearch(
  query: string,
  chunks: RagChunk[],
  k: number,
  opts: { k1?: number; b?: number } = {},
): Scored[] {
  const qTerms = [...new Set(tokenize(query))]
  if (!qTerms.length || !chunks.length) return []
  const k1 = opts.k1 ?? 1.5
  const b = opts.b ?? 0.75

  // 文档 = 标题 token 复制一份(加权)+ 正文 token
  const docs = chunks.map((c) => [...tokenize(c.title), ...tokenize(c.title), ...tokenize(c.text)])
  const N = docs.length
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, N)
  const idf = (t: string): number => {
    const n = df.get(t) ?? 0
    return Math.log(1 + (N - n + 0.5) / (n + 0.5))
  }

  return chunks
    .map((chunk, i) => {
      const d = docs[i]
      const tf = new Map<string, number>()
      for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
      let score = 0
      for (const q of qTerms) {
        const f = tf.get(q) ?? 0
        if (!f) continue
        score += idf(q) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)))
      }
      return { chunk, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
