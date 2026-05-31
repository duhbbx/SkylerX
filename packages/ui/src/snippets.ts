/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { reactive, watch } from 'vue'

export interface Snippet {
  id: string
  name: string
  sql: string
  /** 标签(用于归类 / 过滤) */
  tags?: string[]
  /** 限定方言(snippet 只在这些方言的连接下可见);空 = 任意 */
  dialects?: DbDialect[]
  createdAt: number
}

/**
 * 占位符模板:把 sql 里的 {{name}} 替换为给定值。
 * 不在 vars 里的占位符保持原样,提示用户填写。
 * 例子:`SELECT * FROM {{table}} WHERE id = {{id}}`
 */
export function applySnippetVars(sql: string, vars: Record<string, string>): string {
  return sql.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => {
    const v = vars[name]
    return v == null ? m : v
  })
}

/** 取 sql 里所有的 {{var}} 占位符名,去重保持出现顺序。 */
export function extractSnippetVars(sql: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const re = /\{\{\s*(\w+)\s*\}\}/g
  let m: RegExpExecArray | null
  m = re.exec(sql)
  while (m !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
    m = re.exec(sql)
  }
  return out
}

const KEY = 'skylerx.snippets'

function load(): Snippet[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Snippet[]) : []
  } catch {
    return []
  }
}

/** 全局 SQL 片段库（含收藏），localStorage 持久化。 */
export const snippets = reactive<Snippet[]>(load())

watch(
  snippets,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(snippets))
    } catch {
      /* 忽略持久化失败 */
    }
  },
  { deep: true },
)

export function addSnippet(
  name: string,
  sql: string,
  tags: string[] = [],
  dialects: DbDialect[] = [],
): void {
  const trimmed = sql.trim()
  if (!trimmed) return
  const cleanTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  snippets.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || trimmed.slice(0, 40),
    sql: trimmed,
    tags: cleanTags.length ? cleanTags : undefined,
    dialects: dialects.length ? dialects : undefined,
    createdAt: Date.now(),
  })
}

/** 返回适用于当前方言的 snippet(dialects 为空表示通用,任意方言都看得到)。 */
export function snippetsForDialect(dialect: DbDialect | null | undefined): Snippet[] {
  if (!dialect) return [...snippets]
  return snippets.filter(
    (s) => !s.dialects || s.dialects.length === 0 || s.dialects.includes(dialect),
  )
}

/** 所有片段用到的标签集合（去重排序）。 */
export function allTags(): string[] {
  return [...new Set(snippets.flatMap((s) => s.tags ?? []))].sort()
}

export function removeSnippet(id: string): void {
  const i = snippets.findIndex((s) => s.id === id)
  if (i >= 0) snippets.splice(i, 1)
}
