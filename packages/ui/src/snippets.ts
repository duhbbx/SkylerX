import { reactive, watch } from 'vue'

export interface Snippet {
  id: string
  name: string
  sql: string
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

export function addSnippet(name: string, sql: string): void {
  const trimmed = sql.trim()
  if (!trimmed) return
  snippets.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || trimmed.slice(0, 40),
    sql: trimmed,
    createdAt: Date.now(),
  })
}

export function removeSnippet(id: string): void {
  const i = snippets.findIndex((s) => s.id === id)
  if (i >= 0) snippets.splice(i, 1)
}
