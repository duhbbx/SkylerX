/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 索引持久化(localStorage,按连接+schema)。
 * 向量用 Float32 → base64 压一压(1536 维约 8KB/条),几百表能塞进 localStorage。
 * vectors 与 chunks 平行(同序);mode=lexical 时无 vectors。
 */
import type { RagChunk } from './corpus'

export interface RagIndex {
  key: string
  builtAt: number
  mode: 'vector' | 'lexical'
  chunks: RagChunk[]
  /** base64(Float32) 向量,与 chunks 同序;lexical 模式为空。 */
  vectors?: string[]
  /** 建索引时语料的指纹,用于陈旧检测(见 corpus.fingerprint)。 */
  fingerprint?: string
}

const PREFIX = 'skylerx.rag.'
type Storage = Pick<typeof globalThis.localStorage, 'getItem' | 'setItem' | 'removeItem'>
function store(s?: Storage): Storage | null {
  return s ?? (typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null)
}

export function encodeVec(v: ArrayLike<number>): string {
  const f = Float32Array.from(v as number[])
  const bytes = new Uint8Array(f.buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
export function decodeVec(b64: string): Float32Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export function saveIndex(idx: RagIndex, s?: Storage): boolean {
  try {
    store(s)?.setItem(`${PREFIX}${idx.key}`, JSON.stringify(idx))
    return true
  } catch {
    return false // quota 满
  }
}

export function loadIndex(key: string, s?: Storage): RagIndex | null {
  const raw = store(s)?.getItem(`${PREFIX}${key}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as RagIndex
  } catch {
    return null
  }
}

export function clearIndex(key: string, s?: Storage): void {
  store(s)?.removeItem(`${PREFIX}${key}`)
}
