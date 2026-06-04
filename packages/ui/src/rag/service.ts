/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 编排:语料 → (尝试 embedding) → 存索引;问题 → 检索 top-K → 上下文。
 * embedding 拿不到(无 key / provider 不支持 / 报错)时整链退化为词法检索,功能不挂。
 */
import { embedTexts } from '../ai'
import { type RagChunk, fingerprint } from './corpus'
import { type Scored, lexicalSearch, vectorSearch } from './retrieve'
import { type RagIndex, decodeVec, encodeVec, saveIndex } from './store'

/** 一次 embedding 请求的最大 input 条数,避免大库单请求超 provider batch/token 上限。 */
const EMBED_BATCH = 64

/** 分批 embedding:大库拆成多次请求,任一批失败则整体抛出(交由上层退化词法)。 */
async function embedBatched(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const part = await embedTexts(texts.slice(i, i + EMBED_BATCH), signal)
    out.push(...part)
    onProgress?.(Math.min(i + EMBED_BATCH, texts.length), texts.length)
  }
  return out
}

/** 构建索引:能向量化就向量(分批),否则词法。记指纹供陈旧检测。 */
export async function buildIndex(
  key: string,
  chunks: RagChunk[],
  opts: {
    signal?: AbortSignal
    nowMs: number
    onProgress?: (done: number, total: number) => void
  } = { nowMs: 0 },
): Promise<RagIndex> {
  let mode: RagIndex['mode'] = 'lexical'
  let vectors: string[] | undefined
  try {
    const vecs = await embedBatched(
      chunks.map((c) => c.text),
      opts.onProgress,
      opts.signal,
    )
    if (vecs.length === chunks.length && vecs.length > 0) {
      vectors = vecs.map(encodeVec)
      mode = 'vector'
    }
  } catch {
    /* 退化词法 */
  }
  const idx: RagIndex = {
    key,
    builtAt: opts.nowMs,
    mode,
    chunks,
    vectors,
    fingerprint: fingerprint(chunks),
  }
  saveIndex(idx)
  return idx
}

/** 陈旧检测:重新 introspect 出的 chunk 指纹与索引记录的不一致,即结构已变、应重建。 */
export function isStale(idx: RagIndex, currentChunks: RagChunk[]): boolean {
  if (!idx.fingerprint) return false // 老索引无指纹,不误报
  return idx.fingerprint !== fingerprint(currentChunks)
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
