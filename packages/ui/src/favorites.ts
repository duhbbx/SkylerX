import type { DbDialect } from '@db-tool/shared-types'
import { reactive, watch } from 'vue'

/** 一条收藏：指向某连接下的一个对象（表/视图），用于快速跳转/预览。 */
export interface Favorite {
  /** 稳定主键：`${connId}|${sqlName}` */
  id: string
  connId: string
  connName: string
  dialect: DbDialect
  /** 所在库/schema（reveal 时定位用） */
  schema: string
  /** 对象名 */
  name: string
  /** 限定名（preview 时直接用） */
  sqlName: string
  /** 'table' | 'view' */
  kind: string
  createdAt: number
}

const KEY = 'skylerx.favorites'

function load(): Favorite[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Favorite[]) : []
  } catch {
    return []
  }
}

/** 全局收藏夹，localStorage 持久化。 */
export const favorites = reactive<Favorite[]>(load())

watch(
  favorites,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(favorites))
    } catch {
      /* 忽略持久化失败 */
    }
  },
  { deep: true },
)

function favId(connId: string, sqlName: string): string {
  return `${connId}|${sqlName}`
}

export function isFavorite(connId: string, sqlName: string): boolean {
  const id = favId(connId, sqlName)
  return favorites.some((f) => f.id === id)
}

/** 切换收藏：已收藏则移除，否则加入。返回切换后是否为收藏。 */
export function toggleFavorite(fav: Omit<Favorite, 'id' | 'createdAt'>): boolean {
  const id = favId(fav.connId, fav.sqlName)
  const i = favorites.findIndex((f) => f.id === id)
  if (i >= 0) {
    favorites.splice(i, 1)
    return false
  }
  favorites.unshift({ ...fav, id, createdAt: Date.now() })
  return true
}

export function removeFavorite(id: string): void {
  const i = favorites.findIndex((f) => f.id === id)
  if (i >= 0) favorites.splice(i, 1)
}
