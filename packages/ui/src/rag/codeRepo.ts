/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DataClient } from '@db-tool/shared-types'
import type { TableContext } from '../ddl'
import { chunkCode, parseGitignore, shouldIndexFile } from './codeScan'
import type { RagChunk } from './corpus'
import { embedBatched, formatContext, searchIndex, type RetrievalMode } from './service'
import { type RagIndex, encodeVec, loadIndex, saveIndex } from './store'

const SEP = '␟' // unit separator,容器各段之间的分隔符(不会出现在库名/路径里)

/** 由 contextOfNode 得到的容器(database/schema)拼成稳定键:PG 含两段、MySQL 一段、Oracle 一段。 */
export function containerKey(ctx: TableContext): string {
  return `${ctx.database ?? ''}${SEP}${ctx.schema ?? ''}`
}

/** RAG store 用的索引键(最终 localStorage 落在 `skylerx.rag.` + 此键)。 */
export function codeIndexKey(connId: string, container: string): string {
  return `code:${connId}${SEP}${container}`
}

type ConnLike = { extra?: Record<string, unknown> }
type RepoMap = Record<string, { path: string }>

/** 读连接上某容器绑定的代码库路径(未绑定 → undefined)。 */
export function getRepoPath(conn: ConnLike | null | undefined, container: string): string | undefined {
  const repos = conn?.extra?.codeRepos as RepoMap | undefined
  return repos?.[container]?.path || undefined
}

/**
 * 返回一个新的连接对象,在 extra.codeRepos[container] 写入/清除路径(纯函数,不改入参)。
 * 空路径 = 解除绑定(删除该 container 项;codeRepos 空了则删掉整个键)。
 */
export function setRepoPath<T extends ConnLike>(conn: T, container: string, path: string): T {
  const extra = { ...(conn.extra ?? {}) } as Record<string, unknown>
  const repos: RepoMap = { ...((extra.codeRepos as RepoMap | undefined) ?? {}) }
  const trimmed = path.trim()
  if (trimmed) repos[container] = { path: trimmed }
  else delete repos[container]
  if (Object.keys(repos).length) extra.codeRepos = repos
  else delete extra.codeRepos
  return { ...conn, extra: Object.keys(extra).length ? extra : undefined }
}

/**
 * 在连接已绑定的代码库里,为给定上下文挑出最匹配的容器键(检索侧用)。
 * 优先级:① 精确匹配 → ② 连接只绑了一个就用它 → ③ 同 database 段(先 schema 也相同、
 * 再无 schema 的库级绑定、否则同库第一个)→ 都不中返回 null。
 * 解决检索侧 currentCtx 与绑定侧 contextOfNode 容器键不完全一致时的「静默无结果」。
 */
export function resolveBoundContainer(
  conn: ConnLike | null | undefined,
  ctx: TableContext,
): string | null {
  const repos = conn?.extra?.codeRepos as RepoMap | undefined
  if (!repos) return null
  const keys = Object.keys(repos)
  if (!keys.length) return null
  const exact = containerKey(ctx)
  if (repos[exact]) return exact
  if (keys.length === 1) return keys[0]
  const wantDb = ctx.database ?? ''
  const sameDb = keys.filter((k) => k.split(SEP)[0] === wantDb)
  if (!sameDb.length) return null
  const wantSchema = ctx.schema ?? ''
  return (
    sameDb.find((k) => (k.split(SEP)[1] ?? '') === wantSchema) ??
    sameDb.find((k) => (k.split(SEP)[1] ?? '') === '') ??
    sameDb[0]
  )
}

export interface ScannedFile {
  relPath: string
  mtime: number
  size: number
}

export type CodeManifest = Record<string, { mtime: number; size: number; chunkIds: string[] }>

export interface CodeRetrievalResult {
  context: string
  mode: RetrievalMode | 'none'
  hitCount: number
  sources: string[]
}

export function assertIndexSaved(saved: boolean): void {
  if (!saved) throw new Error('CODE_INDEX_STORAGE_FULL')
}

function manifestStorageKey(connId: string, container: string): string {
  return `skylerx.rag.codemanifest:${connId}${SEP}${container}`
}
function loadManifest(connId: string, container: string): CodeManifest {
  try {
    const raw = localStorage.getItem(manifestStorageKey(connId, container))
    return raw ? (JSON.parse(raw) as CodeManifest) : {}
  } catch {
    return {}
  }
}
function saveManifest(connId: string, container: string, m: CodeManifest): void {
  try {
    localStorage.setItem(manifestStorageKey(connId, container), JSON.stringify(m))
  } catch {
    /* localStorage 满/不可用时忽略 */
  }
}

/** 上限:最多索引多少个文件(防止超大仓库把 localStorage / token 撑爆)。 */
export const MAX_FILES = 1500

/** 递归遍历仓库(经 client.files.listDir),套 .gitignore + 过滤,返回应索引文件(带 mtime/size)。超 MAX_FILES 截断。 */
export async function walkRepo(
  client: DataClient,
  root: string,
): Promise<{ files: ScannedFile[]; capped: boolean }> {
  const listDir = client.files.listDir
  const join = client.files.pathJoin
  if (!listDir || !join) throw new Error('NO_FS')
  let ig = parseGitignore('')
  try {
    const giPath = await join(root, '.gitignore')
    const text = await client.files.readText?.(giPath)
    if (text) ig = parseGitignore(text)
  } catch {
    /* 无 .gitignore */
  }
  const out: ScannedFile[] = []
  let capped = false
  const stack: string[] = ['']
  while (stack.length) {
    const rel = stack.pop() as string
    const abs = rel ? await join(root, rel) : root
    let entries: Awaited<ReturnType<NonNullable<DataClient['files']['listDir']>>>
    try {
      entries = await listDir(abs)
    } catch {
      continue
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) {
        if (!ig.ignores(childRel) && e.name !== '.git' && e.name !== 'node_modules') {
          stack.push(childRel)
        }
      } else if (shouldIndexFile(childRel, e.size, ig)) {
        if (out.length >= MAX_FILES) {
          capped = true
          continue
        }
        out.push({ relPath: childRel, mtime: e.mtime, size: e.size })
      }
    }
  }
  return { files: out, capped }
}

export interface RefreshPlan {
  unchanged: string[]
  toReindex: string[]
  deleted: string[]
}

/** 纯函数:对比 manifest 与本次扫描,得出保留/重嵌/删除。 */
export function planRefresh(manifest: CodeManifest, scanned: ScannedFile[]): RefreshPlan {
  const seen = new Set<string>()
  const unchanged: string[] = []
  const toReindex: string[] = []
  for (const f of scanned) {
    seen.add(f.relPath)
    const prev = manifest[f.relPath]
    if (prev && prev.mtime === f.mtime && prev.size === f.size) unchanged.push(f.relPath)
    else toReindex.push(f.relPath)
  }
  const deleted = Object.keys(manifest).filter((p) => !seen.has(p))
  return { unchanged, toReindex, deleted }
}

/** 增量刷新某容器代码库索引:walk → planRefresh → 重嵌变动文件、保留未变向量、删除消失文件 → 存 index + manifest。 */
export async function refreshCodeIndex(
  client: DataClient,
  connId: string,
  container: string,
  root: string,
  opts: { nowMs: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {
    nowMs: 0,
  },
): Promise<{ index: RagIndex; fileCount: number; capped: boolean; mode: 'vector' | 'lexical' }> {
  const key = codeIndexKey(connId, container)
  const { files, capped } = await walkRepo(client, root)
  const manifest = loadManifest(connId, container)
  const plan = planRefresh(manifest, files)

  const prev = loadIndex(key)
  const prevVecByChunk = new Map<string, string>()
  if (prev?.vectors) {
    prev.chunks.forEach((c, i) => {
      const v = prev.vectors?.[i]
      if (v) prevVecByChunk.set(c.id, v)
    })
  }

  const prevChunkById = new Map((prev?.chunks ?? []).map((c) => [c.id, c]))

  const nextManifest: CodeManifest = {}
  const reindexChunks: RagChunk[] = []
  const sizeByPath = new Map(files.map((f) => [f.relPath, f]))
  for (const relPath of plan.toReindex) {
    let text = ''
    try {
      const abs = await client.files.pathJoin?.(root, relPath)
      text = (abs && (await client.files.readText?.(abs))) || ''
    } catch {
      continue
    }
    const chunks = chunkCode(relPath, text)
    const sf = sizeByPath.get(relPath)
    nextManifest[relPath] = {
      mtime: sf?.mtime ?? opts.nowMs,
      size: sf?.size ?? text.length,
      chunkIds: chunks.map((c) => c.id),
    }
    reindexChunks.push(...chunks)
  }

  let reindexVecs: string[] = []
  let mode: 'vector' | 'lexical' = 'lexical'
  if (reindexChunks.length) {
    try {
      const raw = await embedBatched(
        reindexChunks.map((c) => c.text),
        opts.onProgress,
        opts.signal,
      )
      if (raw.length === reindexChunks.length) {
        reindexVecs = raw.map((v) => encodeVec(v))
        mode = 'vector'
      }
    } catch {
      reindexVecs = []
    }
  }

  const chunks: RagChunk[] = []
  const vectors: string[] = []
  let haveAllVecs = mode === 'vector' || reindexChunks.length === 0
  for (const relPath of plan.unchanged) {
    const entry = manifest[relPath]
    nextManifest[relPath] = entry
    for (const id of entry.chunkIds) {
      const chunk = prevChunkById.get(id)
      if (!chunk) continue
      chunks.push(chunk)
      const v = prevVecByChunk.get(id)
      if (v) vectors.push(v)
      else haveAllVecs = false
    }
  }
  reindexChunks.forEach((c, i) => {
    chunks.push(c)
    if (reindexVecs[i]) vectors.push(reindexVecs[i])
    else haveAllVecs = false
  })

  const index: RagIndex = {
    key,
    builtAt: opts.nowMs,
    mode: haveAllVecs && vectors.length === chunks.length ? 'vector' : 'lexical',
    chunks,
    vectors: haveAllVecs && vectors.length === chunks.length ? vectors : undefined,
  }
  assertIndexSaved(saveIndex(index))
  saveManifest(connId, container, nextManifest)
  opts.onProgress?.(chunks.length, chunks.length)
  return { index, fileCount: files.length, capped, mode: index.mode }
}

/** 检索某容器代码库 top-K 相关片段,返回上下文及检索诊断。 */
export async function retrieveCodeDetailed(
  connId: string,
  container: string,
  query: string,
  topK: number,
  signal?: AbortSignal,
): Promise<CodeRetrievalResult> {
  const idx = loadIndex(codeIndexKey(connId, container))
  if (!idx || !idx.chunks.length) {
    return { context: '', mode: 'none', hitCount: 0, sources: [] }
  }
  const { hits, mode } = await searchIndex(idx, query, topK, { signal })
  return {
    context: formatContext(hits),
    mode,
    hitCount: hits.length,
    sources: [...new Set(hits.map((hit) => hit.chunk.title))],
  }
}

/** 兼容旧调用方:只返回可注入 AI 的上下文文本。 */
export async function retrieveCode(
  connId: string,
  container: string,
  query: string,
  topK: number,
  signal?: AbortSignal,
): Promise<string> {
  return (await retrieveCodeDetailed(connId, container, query, topK, signal)).context
}
