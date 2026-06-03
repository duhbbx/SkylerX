/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 数据迁移任务的持久化 + 历史。
 *
 * 数据搬运可能跨天,关窗口不能丢进度。这里把任务状态存到 localStorage:
 *   - 只存「轻」状态(连接 / schema / 每表 status+copied),**不存列结构**
 *     (恢复时用 introspect 重新读列,省空间也避免 quota 爆)。
 *   - 支持列出历史任务、按 id 读、删除。
 *
 * storage 可注入(默认 globalThis.localStorage),便于单测。
 */

const PREFIX = 'skylerx.migJob.'

export type MigTableStatus = 'pending' | 'running' | 'done' | 'error'

export interface MigJobTable {
  schema: string
  name: string
  status: MigTableStatus
  copied: number
  rowsOk?: boolean
  colsOk?: boolean
}

export interface MigJob {
  id: string
  createdAt: number
  updatedAt: number
  srcConnId: string
  tgtConnId: string
  srcName: string
  tgtName: string
  schemas: string[]
  tables: MigJobTable[]
}

export interface JobSummary {
  id: string
  createdAt: number
  updatedAt: number
  srcName: string
  tgtName: string
  done: number
  total: number
  copied: number
}

type Storage = Pick<
  typeof globalThis.localStorage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>

function store(s?: Storage): Storage | null {
  const st = s ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined)
  return st ?? null
}

/** 存/更新一个任务(自动刷新 updatedAt)。 */
export function saveJob(job: MigJob, s?: Storage): void {
  const st = store(s)
  if (!st) return
  job.updatedAt = job.updatedAt || job.createdAt
  st.setItem(`${PREFIX}${job.id}`, JSON.stringify(job))
}

export function loadJob(id: string, s?: Storage): MigJob | null {
  const st = store(s)
  if (!st) return null
  const raw = st.getItem(`${PREFIX}${id}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as MigJob
  } catch {
    return null
  }
}

export function deleteJob(id: string, s?: Storage): void {
  store(s)?.removeItem(`${PREFIX}${id}`)
}

/** 列出所有任务的摘要(按更新时间倒序)。 */
export function listJobs(s?: Storage): JobSummary[] {
  const st = store(s)
  if (!st) return []
  const out: JobSummary[] = []
  for (let i = 0; i < st.length; i++) {
    const key = st.key(i)
    if (!key || !key.startsWith(PREFIX)) continue
    const raw = st.getItem(key)
    if (!raw) continue
    try {
      const j = JSON.parse(raw) as MigJob
      out.push({
        id: j.id,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        srcName: j.srcName,
        tgtName: j.tgtName,
        done: j.tables.filter((t) => t.status === 'done').length,
        total: j.tables.length,
        copied: j.tables.reduce((a, t) => a + (t.copied || 0), 0),
      })
    } catch {
      /* 跳过坏数据 */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 生成任务 id(调用方在浏览器里,Date.now/random 可用)。 */
export function newJobId(now: number, rand: number): string {
  return `${now.toString(36)}-${Math.floor(rand * 1e6).toString(36)}`
}
