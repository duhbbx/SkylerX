import { reactive, watch } from 'vue'

export interface Snippet {
  id: string
  name: string
  sql: string
  /** 标签（用于归类 / 过滤） */
  tags?: string[]
  createdAt: number
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

export function addSnippet(name: string, sql: string, tags: string[] = []): void {
  const trimmed = sql.trim()
  if (!trimmed) return
  const cleanTags = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  snippets.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || trimmed.slice(0, 40),
    sql: trimmed,
    tags: cleanTags.length ? cleanTags : undefined,
    createdAt: Date.now(),
  })
}

/** 所有片段用到的标签集合（去重排序）。 */
export function allTags(): string[] {
  return [...new Set(snippets.flatMap((s) => s.tags ?? []))].sort()
}

export function removeSnippet(id: string): void {
  const i = snippets.findIndex((s) => s.id === id)
  if (i >= 0) snippets.splice(i, 1)
}
