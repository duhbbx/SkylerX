/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Notebook 模式 —— 笔记本持久化(localStorage)。
 * 一个 notebook = 有序的 cell(SQL / Markdown)+ 绑定连接。只存内容,不存运行结果。
 * storage 可注入,便于单测。
 */
export type CellKind = 'sql' | 'md'

export interface NbCell {
  id: string
  kind: CellKind
  content: string
}

export interface Notebook {
  id: string
  title: string
  connId: string
  cells: NbCell[]
  createdAt: number
  updatedAt: number
}

export interface NotebookSummary {
  id: string
  title: string
  connId: string
  cells: number
  updatedAt: number
}

const PREFIX = 'skylerx.notebook.'
type Storage = Pick<
  typeof globalThis.localStorage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>
function store(s?: Storage): Storage | null {
  return s ?? (typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null)
}

export function saveNotebook(nb: Notebook, s?: Storage): void {
  try {
    store(s)?.setItem(`${PREFIX}${nb.id}`, JSON.stringify(nb))
  } catch {
    /* quota 满:静默 */
  }
}

export function loadNotebook(id: string, s?: Storage): Notebook | null {
  const raw = store(s)?.getItem(`${PREFIX}${id}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Notebook
  } catch {
    return null
  }
}

export function deleteNotebook(id: string, s?: Storage): void {
  store(s)?.removeItem(`${PREFIX}${id}`)
}

export function listNotebooks(s?: Storage): NotebookSummary[] {
  const st = store(s)
  if (!st) return []
  const out: NotebookSummary[] = []
  for (let i = 0; i < st.length; i++) {
    const key = st.key(i)
    if (!key?.startsWith(PREFIX)) continue
    try {
      const nb = JSON.parse(st.getItem(key) ?? '') as Notebook
      out.push({
        id: nb.id,
        title: nb.title,
        connId: nb.connId,
        cells: nb.cells?.length ?? 0,
        updatedAt: nb.updatedAt,
      })
    } catch {
      /* 跳过坏数据 */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 生成 id(浏览器侧,Date.now/random 可用)。 */
export function newId(now: number, rand: number): string {
  return `${now.toString(36)}-${Math.floor(rand * 1e6).toString(36)}`
}
