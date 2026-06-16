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
import { type Scored, applyFloor, lexicalSearch, rrfFuse, vectorSearch } from './retrieve'
import { type RagIndex, decodeVec, encodeVec, saveIndex } from './store'

/** 实际用的检索方式:hybrid(向量+词法 RRF 融合)/ lexical(纯词法兜底)。 */
export type RetrievalMode = 'hybrid' | 'lexical'

/** 一次 embedding 请求的最大 input 条数,避免大库单请求超 provider batch/token 上限。 */
const EMBED_BATCH = 64

/** 分批 embedding:大库拆成多次请求,任一批失败则整体抛出(交由上层退化词法)。 */
export async function embedBatched(
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

/**
 * 检索 top-K。向量索引可用时走**混合检索**:向量(语义)+ 词法(精确名/ID)各取候选池,
 * RRF 融合再排名;否则纯词法。两路都先过相关度地板,丢掉明显不相关的命中。
 */
export async function searchIndex(
  idx: RagIndex,
  query: string,
  k: number,
  opts: { signal?: AbortSignal; floor?: number } = {},
): Promise<{ hits: Scored[]; mode: RetrievalMode }> {
  const pool = Math.max(k * 3, 20) // 融合前每路的候选池
  if (idx.mode === 'vector' && idx.vectors?.length === idx.chunks.length) {
    try {
      const [qv] = await embedTexts([query], opts.signal)
      if (qv) {
        const vecs = idx.vectors
        const items = idx.chunks.map((chunk, i) => ({ chunk, vec: decodeVec(vecs[i]) }))
        const fused = rrfFuse(
          [vectorSearch(qv, items, pool), lexicalSearch(query, idx.chunks, pool)],
          60,
          k,
        )
        return { hits: applyFloor(fused, opts.floor), mode: 'hybrid' }
      }
    } catch {
      /* 退化词法 */
    }
  }
  return { hits: applyFloor(lexicalSearch(query, idx.chunks, k), opts.floor), mode: 'lexical' }
}

/** 把命中 chunk 拼成给 AI 的上下文。 */
export function formatContext(hits: Scored[]): string {
  return hits.map((h) => `### ${h.chunk.title}\n${h.chunk.text}`).join('\n\n')
}
