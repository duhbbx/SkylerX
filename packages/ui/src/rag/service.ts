/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 编排:语料 → (尝试 embedding) → 存索引;问题 → 检索 top-K → 上下文。
 * embedding 拿不到(无 key / provider 不支持 / 报错)时整链退化为词法检索,功能不挂。
 */
import { embedTexts } from '../ai'
import type { RagChunk } from './corpus'
import { type Scored, lexicalSearch, vectorSearch } from './retrieve'
import { type RagIndex, decodeVec, encodeVec, saveIndex } from './store'

/** 构建索引:能向量化就向量,否则词法。 */
export async function buildIndex(
  key: string,
  chunks: RagChunk[],
  opts: { signal?: AbortSignal; nowMs: number } = { nowMs: 0 },
): Promise<RagIndex> {
  let mode: RagIndex['mode'] = 'lexical'
  let vectors: string[] | undefined
  try {
    const vecs = await embedTexts(
      chunks.map((c) => c.text),
      opts.signal,
    )
    if (vecs.length === chunks.length && vecs.length > 0) {
      vectors = vecs.map(encodeVec)
      mode = 'vector'
    }
  } catch {
    /* 退化词法 */
  }
  const idx: RagIndex = { key, builtAt: opts.nowMs, mode, chunks, vectors }
  saveIndex(idx)
  return idx
}

/** 检索 top-K:向量索引先 embed 查询再余弦;失败或词法索引走词法。 */
export async function searchIndex(
  idx: RagIndex,
  query: string,
  k: number,
  opts: { signal?: AbortSignal } = {},
): Promise<{ hits: Scored[]; mode: RagIndex['mode'] }> {
  if (idx.mode === 'vector' && idx.vectors?.length === idx.chunks.length) {
    try {
      const [qv] = await embedTexts([query], opts.signal)
      if (qv) {
        const vecs = idx.vectors
        const items = idx.chunks.map((chunk, i) => ({ chunk, vec: decodeVec(vecs[i]) }))
        return { hits: vectorSearch(qv, items, k), mode: 'vector' }
      }
    } catch {
      /* 退化词法 */
    }
  }
  return { hits: lexicalSearch(query, idx.chunks, k), mode: 'lexical' }
}

/** 把命中 chunk 拼成给 AI 的上下文。 */
export function formatContext(hits: Scored[]): string {
  return hits.map((h) => `### ${h.chunk.title}\n${h.chunk.text}`).join('\n\n')
}
