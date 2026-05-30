<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis key 浏览器 + 命令执行器。
 *
 * 左侧 SCAN 迭代列表 + 搜索框（MATCH glob），右侧按类型懒取 value。
 * 顶部还有一个命令输入框：拆词 → executeCommand({ op: tokens[0], args: tokens[1..] })。
 */
import type { CommandResult, ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'

const props = defineProps<{
  conn: ConnectionConfig
  dbIndex: number
  /** 外部(如左侧树双击 key)要求选中并显示哪个 key */
  pendingKey?: string | null
}>()

const emit = defineEmits<{
  /** key 被删除后通知外层,以便刷新左侧树对应类型组节点 */
  keyDeleted: [dbIndex: number, key: string]
  /** 顶栏"跨库搜索" — 由外层弹 RedisSearchDialog */
  openSearch: []
  /** 顶栏"导入/导出" */
  openImport: []
  openExport: []
  /** 顶栏"服务器面板" */
  openServerInfo: []
  /** 顶栏"大 key 排行" */
  openBigKeys: []
  /** 顶栏"Lua/Functions" */
  openScript: []
  /** 顶栏"实时监控" */
  openMonitor: []
}>()

const client = useDataClient()

type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none' | string

interface KeyItem {
  name: string
  type: RedisType | null // null = 还在查询中 / 未查
  ttl?: number | null // -1 永不过期 / >=0 剩余秒 / -2 不存在 / null 未取
}

/**
 * 一条 stream entry：id + 多对 field/value（保留顺序）。
 *
 * 注意 XRANGE 返回顺序：从老到新。
 */
interface StreamEntry {
  id: string
  fields: [string, string][]
}

/** GEOPOS 拆解结果：成员名 + 经纬度（nil → null，例如成员不存在）。 */
interface GeoEntry {
  member: string
  lng: number | null
  lat: number | null
}

/**
 * "view as ..." 切换：HLL / Bitmap 在 TYPE 上都是 string，Geo 在 TYPE 上是 zset，
 * 仅靠 TYPE 无法区分，给用户手动指定的入口。stream 由 TYPE 自动识别，不进切换。
 */
type ExtraView = 'hll' | 'bitmap' | 'geo' | null

const keys = ref<KeyItem[]>([])
const cursor = ref<string>('0')
const loadingKeys = ref(false)
const finished = ref(false)
const match = ref<string>('*')
const selected = ref<KeyItem | null>(null)

const SCAN_COUNT = 500
// 每次 pipeline 最多放这么多个 TYPE 调用；每批 SCAN 最多返回 SCAN_COUNT=500 个 key，
// 所以一般两三块就完事。注意目前驱动未暴露真 pipeline op，这里只是“分块并发”——
// 一个 chunk 内 Promise.all，多块之间串行 await，避免一次性把所有 key 全甩出去。
const TYPE_PIPELINE_CHUNK = 200

// 右侧 value
interface ValueState {
  type: RedisType
  /** string */
  text?: string
  /** hash */
  hash?: Record<string, string>
  /** list / set */
  array?: string[]
  /** zset：[member, score] */
  zset?: { member: string; score: string }[]
  /** stream：XRANGE 拉回的最近 N 条 entry */
  stream?: StreamEntry[]
  /** HyperLogLog：PFCOUNT 估算基数 */
  hll?: number
  /** Bitmap：BITCOUNT 总数 + 局部 BITCOUNT + GETBIT 查询结果 */
  bitmap?: {
    total: number
    range: { start: number; end: number; count: number } | null
    getBit: { offset: number; bit: 0 | 1 } | null
  }
  /** Geo：成员 + 经纬度 */
  geo?: GeoEntry[]
  loading: boolean
  error: string | null
}
const valueState = ref<ValueState | null>(null)

// "view as ..." — 当前 key 上用户选的额外视图（string → HLL/Bitmap，zset → Geo）
const extraView = ref<ExtraView>(null)

// Bitmap 子查询输入：start/end byte offset；GETBIT 单 bit offset
const bitmapStart = ref<number>(0)
const bitmapEnd = ref<number>(-1)
const bitmapGetOffset = ref<number>(0)
const bitmapBusy = ref(false)

// Stream 拉取条数（XRANGE COUNT）— 给个上限避免一次性拉爆
const STREAM_COUNT = 50

// 命令执行器
const cmdText = ref('')
const cmdRunning = ref(false)
const cmdResult = ref<{ ok: boolean; output: string; ms?: number } | null>(null)

// 当前选中 key 的 TTL(秒)。-1 = 永不过期; -2 = key 不存在; null = 未取
const ttlSec = ref<number | null>(null)
// 删除 / 重命名 / TTL 操作进行中标志,禁用按钮
const keyOpBusy = ref(false)

// ── A1 行内编辑 ───────────────────────────────────────────
/** 是否处于编辑模式;每次 selectKey 重置为 false。 */
const editing = ref(false)
const editBusy = ref(false)
const editDraft = ref<{
  /** string */
  text?: string
  /** hash:[field, value] 行;允许增删行,删行用 null 标 */
  hash?: { field: string; value: string; markDeleted?: boolean; original?: string }[]
  /** list:跟显示数组同形,允许行内改,LSET 单元素;不允许增删(用现有 +/- 按钮) */
  list?: string[]
  /** set:[member, action] action='add'|'remove'|'keep' */
  set?: { member: string; action: 'add' | 'remove' | 'keep'; original?: string }[]
  /** zset:[member, score, action] */
  zset?: { member: string; score: string; action: 'add' | 'remove' | 'keep'; original?: string }[]
}>({})

// ── A2 大集合分页 ─────────────────────────────────────────
/** 单个 value 视图的分页状态。每次 selectKey 重置。 */
interface PageState {
  /** 用 *SCAN 时的 cursor;初始 '0',结束 '0' 标识 finished */
  cursor: string
  finished: boolean
  loading: boolean
  /** 视图当前已加载条数(信息显示) */
  loaded: number
  /** 用户用列表型 LRANGE 翻页时的索引位置 */
  listStart?: number
  listEnd?: number
  listLen?: number
}
const pageState = ref<PageState>({ cursor: '0', finished: true, loading: false, loaded: 0 })
/** 单页加载条数(*SCAN COUNT 暗示量)。 */
const PAGE_SIZE = 100
/** list 单页跨度。 */
const LIST_PAGE = 200

// ── A3 JSON 自动识别 ──────────────────────────────────────
type StringViewMode = 'raw' | 'json'
/** string 类型的显示模式:raw=原文;json=格式化(仅 JSON 可解析时可选) */
const stringView = ref<StringViewMode>('raw')
const parsedJson = computed<unknown | null>(() => {
  const txt = valueState.value?.text
  if (typeof txt !== 'string' || !txt.trim()) return null
  try {
    return JSON.parse(txt)
  } catch {
    return null
  }
})
const isJsonString = computed(() => parsedJson.value !== null)
const formattedJson = computed(() => {
  const v = parsedJson.value
  if (v === null) return ''
  return JSON.stringify(v, null, 2)
})

// ── A4 TTL 排序 + 批量 ────────────────────────────────────
type SortBy = 'name' | 'type' | 'ttl'
type SortDir = 'asc' | 'desc'
const sortBy = ref<SortBy>('name')
const sortDir = ref<SortDir>('asc')
const showTtlCol = ref(false) // 显示 ttl 列(需要批量拉 TTL,默认关)
const multiSel = ref<Set<string>>(new Set())
const batchBusy = ref(false)

/** 当前展示的 keys(应用排序)。 */
const displayedKeys = computed<KeyItem[]>(() => {
  const arr = [...keys.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    if (sortBy.value === 'name') return a.name.localeCompare(b.name) * dir
    if (sortBy.value === 'type') {
      const ta = a.type ?? ''
      const tb = b.type ?? ''
      return (ta.localeCompare(tb) || a.name.localeCompare(b.name)) * dir
    }
    // ttl: -1 视为 Infinity(永不过期排最后),null 视为 NaN
    const va = a.ttl == null ? Number.POSITIVE_INFINITY : a.ttl < 0 ? Number.POSITIVE_INFINITY : a.ttl
    const vb = b.ttl == null ? Number.POSITIVE_INFINITY : b.ttl < 0 ? Number.POSITIVE_INFINITY : b.ttl
    return (va - vb) * dir
  })
  return arr
})

/** 批量给已加载的所有 key 拉 TTL,填到 KeyItem.ttl 上。 */
async function loadAllTtl(): Promise<void> {
  if (!keys.value.length) return
  batchBusy.value = true
  try {
    // 分块并发,避免一次性几千个 IPC
    const CHUNK = 100
    for (let i = 0; i < keys.value.length; i += CHUNK) {
      const chunk = keys.value.slice(i, i + CHUNK)
      await Promise.all(
        chunk.map(async (k) => {
          try {
            const r = await call('TTL', [k.name])
            const n = Number(r.data ?? -1)
            k.ttl = Number.isFinite(n) ? n : null
          } catch {
            k.ttl = null
          }
        }),
      )
    }
    showTtlCol.value = true
  } finally {
    batchBusy.value = false
  }
}

function toggleMulti(name: string): void {
  if (multiSel.value.has(name)) multiSel.value.delete(name)
  else multiSel.value.add(name)
  // Vue Set 修改需要触发响应
  multiSel.value = new Set(multiSel.value)
}

/** 批量给选中 key 设置 TTL。 */
async function batchSetTtl(): Promise<void> {
  if (!multiSel.value.size) {
    toast.warn('请先在左侧勾选 key')
    return
  }
  const input = await appPrompt({
    message: `批量设置 ${multiSel.value.size} 个 key 的过期秒数(-1 = PERSIST):`,
    defaultValue: '3600',
  })
  if (input == null) return
  const sec = Number.parseInt(input, 10)
  if (!Number.isFinite(sec)) {
    toast.error('请输入整数')
    return
  }
  batchBusy.value = true
  try {
    let ok = 0
    let fail = 0
    for (const name of multiSel.value) {
      try {
        if (sec < 0) await call('PERSIST', [name])
        else await call('EXPIRE', [name, String(sec)])
        // 同步 KeyItem.ttl
        const it = keys.value.find((k) => k.name === name)
        if (it) it.ttl = sec < 0 ? -1 : sec
        ok++
      } catch {
        fail++
      }
    }
    toast.success(`完成:成功 ${ok}${fail ? ` · 失败 ${fail}` : ''}`)
  } finally {
    batchBusy.value = false
  }
}

/** 批量删除选中 key。 */
async function batchDelete(): Promise<void> {
  if (!multiSel.value.size) {
    toast.warn('请先在左侧勾选 key')
    return
  }
  if (
    !(await appConfirm({
      message: `确认删除选中的 ${multiSel.value.size} 个 key ?`,
      variant: 'danger',
    }))
  )
    return
  batchBusy.value = true
  try {
    const names = Array.from(multiSel.value)
    // UNLINK 异步删,适合批量
    await call('UNLINK', names)
    keys.value = keys.value.filter((k) => !multiSel.value.has(k.name))
    multiSel.value = new Set()
    toast.success(`已删除 ${names.length} 个 key`)
  } catch (e) {
    toast.error(`批量删除失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    batchBusy.value = false
  }
}

function call(op: string, args: unknown[] = []): Promise<CommandResult> {
  return client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { dbIndex: props.dbIndex },
  })
}

/** 重置 SCAN 游标与列表，并加载第一页。用于切换 db / 点击搜索/重置。 */
async function resetAndLoad(): Promise<void> {
  keys.value = []
  cursor.value = '0'
  finished.value = false
  selected.value = null
  valueState.value = null
  await loadMore()
}

/**
 * 迭代 SCAN 一次：
 *   SCAN <cursor> MATCH <match> COUNT 500
 * 驱动返回 [nextCursor, batch]；batch 去重后追加到 keys，
 * 然后对所有新 key 全量拉 TYPE（按 TYPE_PIPELINE_CHUNK 分块，块内并发、块间串行）。
 */
async function loadMore(): Promise<void> {
  if (loadingKeys.value || finished.value) return
  loadingKeys.value = true
  try {
    const pattern = match.value.trim() || '*'
    const res = await call('SCAN', [cursor.value, 'MATCH', pattern, 'COUNT', String(SCAN_COUNT)])
    const data = res.data as unknown
    let nextCursor = '0'
    let batch: string[] = []
    if (Array.isArray(data) && data.length >= 2) {
      nextCursor = String(data[0])
      batch = Array.isArray(data[1]) ? (data[1] as unknown[]).map((x) => String(x)) : []
    }
    // 去重
    const known = new Set(keys.value.map((k) => k.name))
    const fresh = batch.filter((name) => !known.has(name))
    const newItems: KeyItem[] = fresh.map((name) => ({ name, type: null }))
    keys.value = keys.value.concat(newItems)

    // 全量拉 TYPE：分块，块内 Promise.all 并发、块之间串行 await
    // —— 限制单个 chunk 大小，避免一次性把成百上千个 IPC 全甩出去
    for (let i = 0; i < newItems.length; i += TYPE_PIPELINE_CHUNK) {
      const chunk = newItems.slice(i, i + TYPE_PIPELINE_CHUNK)
      await Promise.all(
        chunk.map(async (it) => {
          try {
            const r = await call('TYPE', [it.name])
            it.type = String(r.data ?? 'none') as RedisType
          } catch {
            it.type = 'none'
          }
        }),
      )
    }

    cursor.value = nextCursor
    if (nextCursor === '0') finished.value = true
  } catch (e) {
    toast.error(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    loadingKeys.value = false
  }
}

function onSearch(): void {
  void resetAndLoad()
}

function onResetMatch(): void {
  match.value = '*'
  void resetAndLoad()
}

async function selectKey(k: KeyItem): Promise<void> {
  selected.value = k
  extraView.value = null
  ttlSec.value = null
  editing.value = false
  editDraft.value = {}
  stringView.value = 'raw'
  // 重置分页状态
  pageState.value = { cursor: '0', finished: true, loading: false, loaded: 0 }
  // TTL 跟 value 并发拉,失败不致命(权限受限的 Redis 也常见)
  void (async () => {
    try {
      const r = await call('TTL', [k.name])
      const n = Number(r.data ?? -1)
      ttlSec.value = Number.isFinite(n) ? n : null
      k.ttl = ttlSec.value // 同步左侧列表的 TTL,排序用
    } catch {
      ttlSec.value = null
    }
  })()
  let typ = k.type
  if (!typ) {
    try {
      const r = await call('TYPE', [k.name])
      typ = String(r.data ?? 'none') as RedisType
      k.type = typ
    } catch (e) {
      valueState.value = {
        type: 'none',
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }
      return
    }
  }
  valueState.value = { type: typ, loading: true, error: null }
  try {
    if (typ === 'string') {
      const r = await call('GET', [k.name])
      if (valueState.value) valueState.value.text = r.data == null ? '' : String(r.data)
    } else if (typ === 'hash') {
      // A2 分页:大 hash(> PAGE_SIZE field)用 HSCAN 分页;小 hash 走 HGETALL 一次拿全
      const lenRes = await call('HLEN', [k.name])
      const hlen = Number(lenRes.data ?? 0)
      if (hlen <= PAGE_SIZE) {
        const r = await call('HGETALL', [k.name])
        const map = parseHashResult(r.data)
        if (valueState.value) valueState.value.hash = map
        pageState.value = { cursor: '0', finished: true, loading: false, loaded: hlen }
      } else {
        // 用 HSCAN 拉首页
        if (valueState.value) valueState.value.hash = {}
        await loadHashPage(k.name, true)
      }
    } else if (typ === 'list') {
      const len = Number((await call('LLEN', [k.name])).data ?? 0)
      const start = 0
      const end = Math.min(LIST_PAGE - 1, len - 1)
      const r = await call('LRANGE', [k.name, String(start), String(end)])
      if (valueState.value) valueState.value.array = (r.data as unknown[]).map((x) => String(x))
      pageState.value = {
        cursor: '0',
        finished: end + 1 >= len,
        loading: false,
        loaded: end + 1,
        listStart: 0,
        listEnd: end,
        listLen: len,
      }
    } else if (typ === 'set') {
      const len = Number((await call('SCARD', [k.name])).data ?? 0)
      if (len <= PAGE_SIZE) {
        const r = await call('SMEMBERS', [k.name])
        if (valueState.value) valueState.value.array = (r.data as unknown[]).map((x) => String(x))
        pageState.value = { cursor: '0', finished: true, loading: false, loaded: len }
      } else {
        if (valueState.value) valueState.value.array = []
        await loadSetPage(k.name, true)
      }
    } else if (typ === 'zset') {
      const len = Number((await call('ZCARD', [k.name])).data ?? 0)
      if (len <= PAGE_SIZE) {
        const r = await call('ZRANGE', [k.name, '0', '-1', 'WITHSCORES'])
        if (valueState.value) valueState.value.zset = parseZsetPairs(r.data)
        pageState.value = { cursor: '0', finished: true, loading: false, loaded: len }
      } else {
        // ZSCAN 返回交错 member/score
        if (valueState.value) valueState.value.zset = []
        await loadZsetPage(k.name, true)
      }
    } else if (typ === 'stream') {
      // XRANGE key - + COUNT N — 从老到新，限 STREAM_COUNT 条
      const r = await call('XRANGE', [k.name, '-', '+', 'COUNT', String(STREAM_COUNT)])
      const raw = (r.data as unknown[]) ?? []
      const entries: StreamEntry[] = []
      for (const item of raw) {
        // 每条 entry：[id, [field, value, field, value, ...]]
        if (!Array.isArray(item) || item.length < 2) continue
        const id = String(item[0])
        const flat = Array.isArray(item[1]) ? (item[1] as unknown[]) : []
        const fields: [string, string][] = []
        for (let i = 0; i + 1 < flat.length; i += 2) {
          fields.push([String(flat[i]), String(flat[i + 1] ?? '')])
        }
        entries.push({ id, fields })
      }
      if (valueState.value) valueState.value.stream = entries
    }
    // HLL / Bitmap / Geo 不靠 TYPE 自动进入（TYPE 上分别是 string / string / zset），
    // 用户在右上 "view as ..." 切换；逻辑下沉到 loadExtraView()
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    if (valueState.value) valueState.value.loading = false
  }
}

// ── A2 大集合分页辅助 ────────────────────────────────────
function parseHashResult(data: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  if (Array.isArray(data)) {
    for (let i = 0; i + 1 < data.length; i += 2) map[String(data[i])] = String(data[i + 1] ?? '')
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) map[k] = String(v ?? '')
  }
  return map
}
function parseZsetPairs(data: unknown): { member: string; score: string }[] {
  const a = (data as unknown[]) ?? []
  const out: { member: string; score: string }[] = []
  for (let i = 0; i + 1 < a.length; i += 2) {
    out.push({ member: String(a[i]), score: String(a[i + 1]) })
  }
  return out
}
async function loadHashPage(name: string, reset: boolean): Promise<void> {
  if (pageState.value.loading) return
  if (reset) pageState.value = { cursor: '0', finished: false, loading: true, loaded: 0 }
  else pageState.value.loading = true
  try {
    const r = await call('HSCAN', [name, pageState.value.cursor, 'COUNT', String(PAGE_SIZE)])
    // HSCAN 返回 [cursor, [field, value, ...]]
    const arr = r.data as unknown[]
    const nextCursor = String(arr?.[0] ?? '0')
    const flat = Array.isArray(arr?.[1]) ? (arr[1] as unknown[]) : []
    if (valueState.value?.hash) {
      for (let i = 0; i + 1 < flat.length; i += 2) {
        valueState.value.hash[String(flat[i])] = String(flat[i + 1] ?? '')
      }
    }
    pageState.value.cursor = nextCursor
    pageState.value.finished = nextCursor === '0'
    pageState.value.loaded = Object.keys(valueState.value?.hash ?? {}).length
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    pageState.value.loading = false
  }
}
async function loadSetPage(name: string, reset: boolean): Promise<void> {
  if (pageState.value.loading) return
  if (reset) pageState.value = { cursor: '0', finished: false, loading: true, loaded: 0 }
  else pageState.value.loading = true
  try {
    const r = await call('SSCAN', [name, pageState.value.cursor, 'COUNT', String(PAGE_SIZE)])
    const arr = r.data as unknown[]
    const nextCursor = String(arr?.[0] ?? '0')
    const batch = Array.isArray(arr?.[1]) ? (arr[1] as unknown[]) : []
    if (valueState.value) {
      valueState.value.array = (valueState.value.array ?? []).concat(batch.map((x) => String(x)))
    }
    pageState.value.cursor = nextCursor
    pageState.value.finished = nextCursor === '0'
    pageState.value.loaded = valueState.value?.array?.length ?? 0
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    pageState.value.loading = false
  }
}
async function loadZsetPage(name: string, reset: boolean): Promise<void> {
  if (pageState.value.loading) return
  if (reset) pageState.value = { cursor: '0', finished: false, loading: true, loaded: 0 }
  else pageState.value.loading = true
  try {
    const r = await call('ZSCAN', [name, pageState.value.cursor, 'COUNT', String(PAGE_SIZE)])
    const arr = r.data as unknown[]
    const nextCursor = String(arr?.[0] ?? '0')
    const flat = Array.isArray(arr?.[1]) ? (arr[1] as unknown[]) : []
    if (valueState.value) {
      const more = parseZsetPairs(flat)
      valueState.value.zset = (valueState.value.zset ?? []).concat(more)
    }
    pageState.value.cursor = nextCursor
    pageState.value.finished = nextCursor === '0'
    pageState.value.loaded = valueState.value?.zset?.length ?? 0
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    pageState.value.loading = false
  }
}
async function loadListPage(name: string, dir: 'next' | 'prev'): Promise<void> {
  if (pageState.value.loading) return
  const len = pageState.value.listLen ?? 0
  let start = pageState.value.listStart ?? 0
  let end = pageState.value.listEnd ?? 0
  if (dir === 'next') {
    if (end + 1 >= len) return
    start = end + 1
    end = Math.min(start + LIST_PAGE - 1, len - 1)
  } else {
    if (start <= 0) return
    end = start - 1
    start = Math.max(0, end - LIST_PAGE + 1)
  }
  pageState.value.loading = true
  try {
    const r = await call('LRANGE', [name, String(start), String(end)])
    if (valueState.value) valueState.value.array = (r.data as unknown[]).map((x) => String(x))
    pageState.value.listStart = start
    pageState.value.listEnd = end
    pageState.value.loaded = end - start + 1
    pageState.value.finished = end + 1 >= len && start === 0
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    pageState.value.loading = false
  }
}

// 模板里要按当前 key 名分页,封装一下
function loadMorePage(): void {
  const k = selected.value
  if (!k || !valueState.value) return
  if (valueState.value.type === 'hash') void loadHashPage(k.name, false)
  else if (valueState.value.type === 'set') void loadSetPage(k.name, false)
  else if (valueState.value.type === 'zset') void loadZsetPage(k.name, false)
}

// ── A1 行内编辑 ───────────────────────────────────────────
/** 进入编辑模式:把当前 value 复制到 editDraft。 */
function enterEdit(): void {
  if (!valueState.value || !selected.value) return
  const t = valueState.value.type
  if (t === 'string') {
    editDraft.value = { text: valueState.value.text ?? '' }
  } else if (t === 'hash') {
    const rows = Object.entries(valueState.value.hash ?? {}).map(([f, v]) => ({
      field: f,
      value: v,
      original: f,
    }))
    editDraft.value = { hash: rows }
  } else if (t === 'list') {
    editDraft.value = { list: [...(valueState.value.array ?? [])] }
  } else if (t === 'set') {
    const rows = (valueState.value.array ?? []).map((m) => ({
      member: m,
      action: 'keep' as const,
      original: m,
    }))
    editDraft.value = { set: rows }
  } else if (t === 'zset') {
    const rows = (valueState.value.zset ?? []).map((p) => ({
      member: p.member,
      score: p.score,
      action: 'keep' as const,
      original: p.member,
    }))
    editDraft.value = { zset: rows }
  }
  editing.value = true
}
function cancelEdit(): void {
  editing.value = false
  editDraft.value = {}
}
function addHashEditRow(): void {
  editDraft.value.hash?.push({ field: '', value: '' })
}
function delHashEditRow(i: number): void {
  if (!editDraft.value.hash) return
  const r = editDraft.value.hash[i]
  if (r.original) r.markDeleted = !r.markDeleted // 删原有:标 mark;再点取消
  else editDraft.value.hash.splice(i, 1) // 新加未提交直接抹掉
}
function addSetMember(): void {
  editDraft.value.set?.push({ member: '', action: 'add' })
}
function delSetMember(i: number): void {
  if (!editDraft.value.set) return
  const r = editDraft.value.set[i]
  if (r.action === 'keep') r.action = 'remove'
  else if (r.action === 'remove') r.action = 'keep'
  else editDraft.value.set.splice(i, 1)
}
function addZsetMember(): void {
  editDraft.value.zset?.push({ member: '', score: '0', action: 'add' })
}
function delZsetMember(i: number): void {
  if (!editDraft.value.zset) return
  const r = editDraft.value.zset[i]
  if (r.action === 'keep') r.action = 'remove'
  else if (r.action === 'remove') r.action = 'keep'
  else editDraft.value.zset.splice(i, 1)
}
/** 保存编辑:按类型生成 diff,执行命令。 */
async function saveEdit(): Promise<void> {
  const k = selected.value
  if (!k || !valueState.value || !editing.value) return
  editBusy.value = true
  const t = valueState.value.type
  try {
    if (t === 'string') {
      await call('SET', [k.name, editDraft.value.text ?? ''])
    } else if (t === 'hash') {
      const rows = editDraft.value.hash ?? []
      const toSet: string[] = []
      const toDel: string[] = []
      for (const r of rows) {
        if (r.markDeleted && r.original) toDel.push(r.original)
        else if (r.field.trim()) {
          // 原 field 改名 → 先删旧
          if (r.original && r.original !== r.field) toDel.push(r.original)
          toSet.push(r.field, r.value)
        }
      }
      if (toDel.length) await call('HDEL', [k.name, ...toDel])
      if (toSet.length) await call('HSET', [k.name, ...toSet])
    } else if (t === 'list') {
      // 仅对改变的 index 调 LSET
      const old = valueState.value.array ?? []
      const draft = editDraft.value.list ?? []
      for (let i = 0; i < draft.length; i++) {
        if (draft[i] !== old[i]) await call('LSET', [k.name, String(i), draft[i]])
      }
    } else if (t === 'set') {
      const rows = editDraft.value.set ?? []
      const adds = rows.filter((r) => r.action === 'add' && r.member.trim()).map((r) => r.member)
      const rems = rows
        .filter((r) => r.action === 'remove' && r.original)
        .map((r) => r.original as string)
      if (adds.length) await call('SADD', [k.name, ...adds])
      if (rems.length) await call('SREM', [k.name, ...rems])
    } else if (t === 'zset') {
      const rows = editDraft.value.zset ?? []
      const addArgs: string[] = []
      const rems: string[] = []
      for (const r of rows) {
        if (r.action === 'add' && r.member.trim()) addArgs.push(r.score, r.member)
        else if (r.action === 'remove' && r.original) rems.push(r.original)
        else if (r.action === 'keep' && r.original && r.original === r.member) {
          // score 改了就 update
          const before = (valueState.value.zset ?? []).find((p) => p.member === r.original)
          if (before && before.score !== r.score) addArgs.push(r.score, r.member)
        }
      }
      if (rems.length) await call('ZREM', [k.name, ...rems])
      if (addArgs.length) await call('ZADD', [k.name, ...addArgs])
    }
    toast.success('保存成功')
    editing.value = false
    editDraft.value = {}
    // 重新拉 value
    await selectKey(k)
  } catch (e) {
    toast.error(`保存失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    editBusy.value = false
  }
}

/**
 * 切换到 extra 视图（HLL / Bitmap / Geo），按需拉数据。
 *
 * 这些视图都依赖底层类型仍然成立（HLL/Bitmap 是 string；Geo 是 zset）；
 * 错用的话 Redis 会回 WRONGTYPE，错误信息会显示在 err-banner 里。
 */
async function setExtraView(v: ExtraView): Promise<void> {
  extraView.value = v
  const k = selected.value
  if (!k || !valueState.value || !v) return
  valueState.value.loading = true
  valueState.value.error = null
  try {
    if (v === 'hll') {
      const r = await call('PFCOUNT', [k.name])
      const n = Number(r.data ?? 0)
      valueState.value.hll = Number.isFinite(n) ? n : 0
    } else if (v === 'bitmap') {
      const r = await call('BITCOUNT', [k.name])
      const total = Number(r.data ?? 0)
      valueState.value.bitmap = {
        total: Number.isFinite(total) ? total : 0,
        range: null,
        getBit: null,
      }
      // start/end 默认值复位为合理值
      bitmapStart.value = 0
      bitmapEnd.value = -1
      bitmapGetOffset.value = 0
    } else if (v === 'geo') {
      // 先拿成员列表（zset 形态），再逐个 GEOPOS。空集合直接给空数组。
      const r = await call('ZRANGE', [k.name, '0', '-1'])
      const members = ((r.data as unknown[]) ?? []).map((x) => String(x))
      const list: GeoEntry[] = []
      // GEOPOS key m1 m2 ... — 单次调用即可拿到所有；驱动 args 支持变参
      if (members.length) {
        const gr = await call('GEOPOS', [k.name, ...members])
        const arr = (gr.data as unknown[]) ?? []
        for (let i = 0; i < members.length; i++) {
          const pos = arr[i] as unknown
          if (Array.isArray(pos) && pos.length >= 2) {
            const lng = Number(pos[0])
            const lat = Number(pos[1])
            list.push({
              member: members[i],
              lng: Number.isFinite(lng) ? lng : null,
              lat: Number.isFinite(lat) ? lat : null,
            })
          } else {
            // GEOPOS 对不存在 / 非 geo 成员会返回 nil
            list.push({ member: members[i], lng: null, lat: null })
          }
        }
      }
      valueState.value.geo = list
    }
  } catch (e) {
    valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    valueState.value.loading = false
  }
}

/** 复制选中 key 名到剪贴板。 */
async function copySelectedKey(): Promise<void> {
  const k = selected.value
  if (!k) return
  try {
    await navigator.clipboard.writeText(k.name)
    toast.success(`已复制: ${k.name}`)
  } catch (e) {
    toast.error(`复制失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 删除选中 key(DEL),成功后从左侧列表移除并清空右侧。 */
async function deleteSelectedKey(): Promise<void> {
  const k = selected.value
  if (!k) return
  if (!(await appConfirm({ message: `确认删除 key "${k.name}" ?`, variant: 'danger' }))) return
  keyOpBusy.value = true
  try {
    await call('DEL', [k.name])
    // 列表里也撤掉
    keys.value = keys.value.filter((x) => x.name !== k.name)
    selected.value = null
    valueState.value = null
    ttlSec.value = null
    emit('keyDeleted', props.dbIndex, k.name)
    toast.success(`已删除: ${k.name}`)
  } catch (e) {
    toast.error(`删除失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    keyOpBusy.value = false
  }
}

/** 重命名选中 key(RENAME oldKey newKey)。 */
async function renameSelectedKey(): Promise<void> {
  const k = selected.value
  if (!k) return
  const next = await appPrompt({
    message: `重命名 key "${k.name}" 为:`,
    defaultValue: k.name,
  })
  if (!next || next === k.name) return
  keyOpBusy.value = true
  try {
    await call('RENAME', [k.name, next])
    // 同步左侧列表
    const idx = keys.value.findIndex((x) => x.name === k.name)
    if (idx >= 0) keys.value[idx] = { name: next, type: k.type }
    selected.value = keys.value[idx] ?? null
    toast.success(`已重命名为: ${next}`)
  } catch (e) {
    toast.error(`重命名失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    keyOpBusy.value = false
  }
}

/** 设置/取消 TTL。输入秒数:0 = 立即过期? 不,我们 -1 = PERSIST,> 0 = EXPIRE n。 */
async function changeTtl(): Promise<void> {
  const k = selected.value
  if (!k) return
  const cur = ttlSec.value
  const hint =
    cur != null && cur >= 0 ? `当前剩余 ${cur}s,输入新秒数(-1 = 取消过期):` : '输入过期秒数(-1 = 取消过期):'
  const input = await appPrompt({ message: hint, defaultValue: cur != null ? String(cur) : '60' })
  if (input == null) return
  const sec = Number.parseInt(input, 10)
  if (!Number.isFinite(sec)) {
    toast.error('请输入整数')
    return
  }
  keyOpBusy.value = true
  try {
    if (sec < 0) {
      await call('PERSIST', [k.name])
      ttlSec.value = -1
      toast.success('已取消过期')
    } else {
      await call('EXPIRE', [k.name, String(sec)])
      ttlSec.value = sec
      toast.success(`TTL = ${sec}s`)
    }
  } catch (e) {
    toast.error(`TTL 设置失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    keyOpBusy.value = false
  }
}

/**
 * Bitmap：BITCOUNT key start end — 给定 byte 偏移区间统计 1-bit 数。
 * Redis 默认按 BYTE 计；负数从末尾算（-1 = 最后一字节）。
 */
async function runBitmapRange(): Promise<void> {
  const k = selected.value
  if (!k || !valueState.value?.bitmap) return
  bitmapBusy.value = true
  try {
    const s = Math.trunc(bitmapStart.value)
    const e = Math.trunc(bitmapEnd.value)
    const r = await call('BITCOUNT', [k.name, String(s), String(e)])
    const count = Number(r.data ?? 0)
    valueState.value.bitmap.range = {
      start: s,
      end: e,
      count: Number.isFinite(count) ? count : 0,
    }
  } catch (err) {
    valueState.value.error = err instanceof Error ? err.message : String(err)
  } finally {
    bitmapBusy.value = false
  }
}

/** Bitmap：GETBIT key offset — 单 bit 读取。 */
async function runBitmapGetBit(): Promise<void> {
  const k = selected.value
  if (!k || !valueState.value?.bitmap) return
  bitmapBusy.value = true
  try {
    const off = Math.max(0, Math.trunc(bitmapGetOffset.value))
    const r = await call('GETBIT', [k.name, String(off)])
    const bit = Number(r.data ?? 0) === 1 ? 1 : 0
    valueState.value.bitmap.getBit = { offset: off, bit }
  } catch (err) {
    valueState.value.error = err instanceof Error ? err.message : String(err)
  } finally {
    bitmapBusy.value = false
  }
}

/** 极简命令解析：按空白拆词，引号未支持（命令面板用户用 GUI 选 key 更稳）。 */
function parseCommand(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean)
}

async function runCommand(): Promise<void> {
  const tokens = parseCommand(cmdText.value)
  if (!tokens.length) return
  const op = tokens[0].toUpperCase()
  const args = tokens.slice(1)
  cmdRunning.value = true
  cmdResult.value = null
  try {
    const r = await call(op, args)
    let out: string
    try {
      out = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2)
    } catch {
      out = String(r.data)
    }
    cmdResult.value = { ok: true, output: out, ms: r.executionTimeMs }
  } catch (e) {
    cmdResult.value = { ok: false, output: e instanceof Error ? e.message : String(e) }
  } finally {
    cmdRunning.value = false
  }
}

function typeTagColor(t: RedisType | null): string {
  switch (t) {
    case 'string':
      return '#4caf50'
    case 'hash':
      return '#7c6cff'
    case 'list':
      return '#e0a020'
    case 'set':
      return '#03a9f4'
    case 'zset':
      return '#e04050'
    case 'stream':
      return '#9c27b0'
    default:
      return '#888'
  }
}

const selectedType = computed(() => valueState.value?.type ?? null)
const hashEntries = computed<[string, string][]>(() =>
  valueState.value?.hash ? Object.entries(valueState.value.hash) : [],
)
const arrayValues = computed<string[]>(() => valueState.value?.array ?? [])
const zsetValues = computed<{ member: string; score: string }[]>(() => valueState.value?.zset ?? [])
const stringValue = computed<string>(() => valueState.value?.text ?? '')
const streamEntries = computed<StreamEntry[]>(() => valueState.value?.stream ?? [])
const geoEntries = computed<GeoEntry[]>(() => valueState.value?.geo ?? [])
const hllCount = computed<number | null>(() => valueState.value?.hll ?? null)
const bitmapState = computed(() => valueState.value?.bitmap ?? null)

/**
 * 当前底层 TYPE 上能切换的额外视图：
 *  - string → HLL / Bitmap
 *  - zset   → Geo
 *  - 其它   → 没有
 */
const extraViewOptions = computed<{ key: ExtraView; label: string }[]>(() => {
  switch (selectedType.value) {
    case 'string':
      return [
        { key: 'hll', label: 'HyperLogLog' },
        { key: 'bitmap', label: 'Bitmap' },
      ]
    case 'zset':
      return [{ key: 'geo', label: 'Geo' }]
    default:
      return []
  }
})

// 切换 dbIndex / conn 时自动刷新
watch(
  () => [props.conn.id, props.dbIndex] as const,
  () => {
    void resetAndLoad()
  },
  { immediate: true },
)

/**
 * 外部要求选中某个 key(如左侧树双击)。
 * - 若 key 已在列表里:直接 selectKey
 * - 若不在:用 SCAN MATCH=key 兜底快速插入再选(避免要等全量加载)
 */
watch(
  () => props.pendingKey,
  async (key) => {
    if (!key) return
    const existing = keys.value.find((k) => k.name === key)
    if (existing) {
      await selectKey(existing)
      return
    }
    // 不在列表:不强制全量,直接以 type:null 插入并 selectKey(内部 TYPE 拉一下)
    const item: KeyItem = { name: key, type: null }
    keys.value.unshift(item)
    await selectKey(item)
  },
  { immediate: true },
)
</script>

<template>
  <div class="redis-pane">
    <div class="toolbar">
      <span class="crumb">db{{ dbIndex }}</span>
      <button class="btn" :disabled="loadingKeys" @click="resetAndLoad">刷新</button>
      <span class="spacer" />
      <!-- A5/A6/B1+B2+B3 入口:emit 给外层 Workspace 弹对应 dialog -->
      <button class="btn" title="跨库搜索 key" @click="emit('openSearch')">🔍 搜索</button>
      <button class="btn" title="大 key 排行(MEMORY USAGE)" @click="emit('openBigKeys')">🐋 大 key</button>
      <button class="btn" title="Lua / Functions 编辑器" @click="emit('openScript')">λ 脚本</button>
      <button class="btn" title="导出当前库为 JSON" @click="emit('openExport')">⬇ 导出</button>
      <button class="btn" title="从 JSON 导入" @click="emit('openImport')">⬆ 导入</button>
      <button class="btn" title="实时监控(INFO stats 轮询)" @click="emit('openMonitor')">📊 监控</button>
      <button class="btn" title="服务器信息 / 慢日志 / 客户端 / Cluster / Sentinel" @click="emit('openServerInfo')">⚙ 服务器</button>
      <span v-if="keys.length" class="meta">{{ keys.length }} keys{{ finished ? '' : '+' }}</span>
    </div>

    <div class="search-bar">
      <input
        v-model="match"
        class="search"
        spellcheck="false"
        placeholder="MATCH 模式，如 user:*"
        @keydown.enter="onSearch"
      />
      <button class="btn" :disabled="loadingKeys" @click="onSearch">搜索</button>
      <button class="btn" :disabled="loadingKeys" @click="onResetMatch">重置</button>
    </div>

    <div class="cmd-bar">
      <input
        v-model="cmdText"
        class="cmd"
        spellcheck="false"
        placeholder="输入命令，如 SET foo bar / GET foo / DEL foo"
        @keydown.enter="runCommand"
      />
      <button class="btn primary" :disabled="cmdRunning || !cmdText.trim()" @click="runCommand">
        {{ cmdRunning ? '执行中…' : '执行' }}
      </button>
    </div>
    <div v-if="cmdResult" class="cmd-out" :class="{ err: !cmdResult.ok }">
      <span v-if="cmdResult.ms != null" class="cmd-ms">{{ cmdResult.ms }} ms</span>
      <pre>{{ cmdResult.output }}</pre>
    </div>

    <div class="body">
      <div class="keys">
        <!-- 排序 / TTL 列开关 / 多选批量操作 -->
        <div class="keys-ctrl">
          <select v-model="sortBy" class="mini-select">
            <option value="name">按名</option>
            <option value="type">按类型</option>
            <option value="ttl">按 TTL</option>
          </select>
          <button class="mini-btn" :title="sortDir === 'asc' ? '升序' : '降序'" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">
            {{ sortDir === 'asc' ? '↑' : '↓' }}
          </button>
          <button
            class="mini-btn"
            :class="{ on: showTtlCol }"
            :disabled="batchBusy"
            title="批量拉所有 key 的 TTL 显示成列(慢)"
            @click="loadAllTtl"
          >TTL</button>
          <span class="spacer" />
          <span v-if="multiSel.size" class="meta">已选 {{ multiSel.size }}</span>
        </div>
        <!-- 批量操作:仅多选时显示 -->
        <div v-if="multiSel.size" class="batch-bar">
          <button class="mini-btn" :disabled="batchBusy" @click="batchSetTtl">⏱ 批量 TTL</button>
          <button class="mini-btn danger" :disabled="batchBusy" @click="batchDelete">✕ 批量删</button>
          <button class="mini-btn" @click="multiSel = new Set()">清空选择</button>
        </div>
        <template v-if="!keys.length">
          <div v-if="loadingKeys" class="empty">加载中…</div>
          <div v-else-if="finished" class="empty">空</div>
          <div v-else class="empty">…</div>
        </template>
        <template v-else>
          <div
            v-for="k in displayedKeys"
            :key="k.name"
            class="key-row"
            :class="{ active: selected?.name === k.name, picked: multiSel.has(k.name) }"
            @click="selectKey(k)"
          >
            <input
              type="checkbox"
              class="kr-check"
              :checked="multiSel.has(k.name)"
              @click.stop
              @change="toggleMulti(k.name)"
            />
            <span
              v-if="k.type"
              class="type-tag"
              :style="{ background: typeTagColor(k.type) }"
              :title="k.type"
            >{{ k.type }}</span>
            <span v-else class="type-tag dim" title="未取类型">?</span>
            <span class="key-name" :title="k.name">{{ k.name }}</span>
            <span
              v-if="showTtlCol"
              class="kr-ttl"
              :title="k.ttl == null ? '未取' : k.ttl === -1 ? '永不过期' : `${k.ttl}s`"
            >
              {{ k.ttl == null ? '—' : k.ttl === -1 ? '∞' : `${k.ttl}s` }}
            </span>
          </div>
        </template>
        <div class="keys-footer">
          <button
            v-if="!finished"
            class="btn load-more"
            :disabled="loadingKeys || finished"
            @click="loadMore"
          >
            {{ loadingKeys ? '加载中…' : `加载更多（已 ${keys.length}）` }}
          </button>
          <span v-else class="meta done">已加载全部（{{ keys.length }}）</span>
        </div>
      </div>

      <div class="value">
        <div v-if="!selected" class="empty">选择左侧的 key 查看 value</div>
        <template v-else-if="valueState">
          <div class="value-head">
            <span class="vh-name">{{ selected.name }}</span>
            <span class="vh-type" :style="{ color: typeTagColor(selectedType) }">{{ selectedType }}</span>
            <span class="vh-ttl" :title="ttlSec == null ? '未取 TTL' : ttlSec === -1 ? '永不过期' : ttlSec === -2 ? 'key 已不存在' : `剩余 ${ttlSec}s`">
              ttl: <b>{{ ttlSec == null ? '—' : ttlSec === -1 ? '∞' : ttlSec === -2 ? 'n/a' : `${ttlSec}s` }}</b>
            </span>
            <span class="vh-ops">
              <button class="ev-btn" :disabled="keyOpBusy" title="复制 key 名" @click="copySelectedKey">⧉</button>
              <button class="ev-btn" :disabled="keyOpBusy" title="设置 TTL" @click="changeTtl">⏱</button>
              <button class="ev-btn" :disabled="keyOpBusy" title="重命名" @click="renameSelectedKey">✎</button>
              <!-- A1 编辑入口:仅基础类型支持 -->
              <button
                v-if="!editing && ['string','hash','list','set','zset'].includes(String(selectedType))"
                class="ev-btn"
                :disabled="keyOpBusy || editBusy"
                title="编辑 value"
                @click="enterEdit"
              >✎ 编辑</button>
              <template v-if="editing">
                <button class="ev-btn primary" :disabled="editBusy" title="保存" @click="saveEdit">{{ editBusy ? '保存中…' : '✓ 保存' }}</button>
                <button class="ev-btn" :disabled="editBusy" title="取消" @click="cancelEdit">⨯ 取消</button>
              </template>
              <button class="ev-btn danger" :disabled="keyOpBusy" title="删除 key" @click="deleteSelectedKey">✕</button>
            </span>
            <span v-if="extraViewOptions.length" class="vh-extra">
              <button
                class="ev-btn"
                :class="{ on: extraView === null }"
                @click="setExtraView(null)"
              >原始</button>
              <button
                v-for="opt in extraViewOptions"
                :key="String(opt.key)"
                class="ev-btn"
                :class="{ on: extraView === opt.key }"
                @click="setExtraView(opt.key)"
              >{{ opt.label }}</button>
            </span>
          </div>
          <div v-if="valueState.loading" class="empty">加载中…</div>
          <div v-else-if="valueState.error" class="err-banner">✗ {{ valueState.error }}</div>
          <template v-else>
            <!-- HLL / Bitmap / Geo：用户显式切换的视图优先 -->
            <template v-if="extraView === 'hll'">
              <div class="metric">
                <div class="metric-label">PFCOUNT — 估算基数</div>
                <div class="metric-val">{{ hllCount ?? '—' }}</div>
                <div class="metric-hint">
                  HyperLogLog 估算值，标准误差约 0.81%。键的底层 TYPE 仍是 string。
                </div>
              </div>
            </template>
            <template v-else-if="extraView === 'bitmap' && bitmapState">
              <div class="metric">
                <div class="metric-label">BITCOUNT — 总 1-bit 数</div>
                <div class="metric-val">{{ bitmapState.total }}</div>
              </div>
              <div class="bm-section">
                <div class="bm-title">区间统计 — BITCOUNT key start end</div>
                <div class="bm-row">
                  <label>start
                    <input v-model.number="bitmapStart" type="number" />
                  </label>
                  <label>end
                    <input v-model.number="bitmapEnd" type="number" />
                  </label>
                  <button class="btn" :disabled="bitmapBusy" @click="runBitmapRange">查询</button>
                  <span v-if="bitmapState.range" class="bm-out">
                    [{{ bitmapState.range.start }}..{{ bitmapState.range.end }}]
                    = <b>{{ bitmapState.range.count }}</b>
                  </span>
                </div>
                <div class="bm-hint">单位默认是 BYTE，负数从末尾算（-1 = 最后一字节）。</div>
              </div>
              <div class="bm-section">
                <div class="bm-title">单 bit 查询 — GETBIT key offset</div>
                <div class="bm-row">
                  <label>offset
                    <input v-model.number="bitmapGetOffset" type="number" min="0" />
                  </label>
                  <button class="btn" :disabled="bitmapBusy" @click="runBitmapGetBit">查询</button>
                  <span v-if="bitmapState.getBit" class="bm-out">
                    offset={{ bitmapState.getBit.offset }}
                    → bit=<b>{{ bitmapState.getBit.bit }}</b>
                  </span>
                </div>
              </div>
            </template>
            <template v-else-if="extraView === 'geo'">
              <table class="grid">
                <thead><tr><th>member</th><th style="width: 140px">latitude</th><th style="width: 140px">longitude</th></tr></thead>
                <tbody>
                  <tr v-for="(g, i) in geoEntries" :key="i">
                    <td>{{ g.member }}</td>
                    <td>{{ g.lat == null ? '—' : g.lat }}</td>
                    <td>{{ g.lng == null ? '—' : g.lng }}</td>
                  </tr>
                  <tr v-if="!geoEntries.length"><td colspan="3" class="empty-row">无成员</td></tr>
                </tbody>
              </table>
            </template>
            <!-- 默认按 TYPE 走 -->
            <template v-else>
              <!-- string:只读 raw/JSON 切换 + 编辑 textarea -->
              <template v-if="selectedType === 'string'">
                <template v-if="!editing">
                  <div v-if="isJsonString" class="json-tabs">
                    <button class="ev-btn" :class="{ on: stringView === 'raw' }" @click="stringView = 'raw'">Raw</button>
                    <button class="ev-btn" :class="{ on: stringView === 'json' }" @click="stringView = 'json'">JSON</button>
                  </div>
                  <pre v-if="stringView === 'raw' || !isJsonString" class="val-text">{{ stringValue }}</pre>
                  <pre v-else class="val-text json">{{ formattedJson }}</pre>
                </template>
                <textarea v-else v-model="editDraft.text" class="edit-text" spellcheck="false" />
              </template>

              <!-- hash:行内编辑表 + 分页 -->
              <template v-else-if="selectedType === 'hash'">
                <table v-if="!editing" class="grid">
                  <thead><tr><th>field</th><th>value</th></tr></thead>
                  <tbody>
                    <tr v-for="[kk, vv] in hashEntries" :key="kk">
                      <td>{{ kk }}</td><td>{{ vv }}</td>
                    </tr>
                  </tbody>
                </table>
                <table v-else class="grid">
                  <thead><tr><th>field</th><th>value</th><th style="width: 50px"></th></tr></thead>
                  <tbody>
                    <tr v-for="(r, i) in editDraft.hash" :key="i" :class="{ del: r.markDeleted }">
                      <td><input v-model="r.field" class="cell-ip" :disabled="r.markDeleted" /></td>
                      <td><input v-model="r.value" class="cell-ip" :disabled="r.markDeleted" /></td>
                      <td><button class="mini-btn danger" @click="delHashEditRow(i)">{{ r.markDeleted ? '↺' : '✕' }}</button></td>
                    </tr>
                    <tr><td colspan="3"><button class="add-row" @click="addHashEditRow">+ 添加 field</button></td></tr>
                  </tbody>
                </table>
                <div v-if="!editing && !pageState.finished" class="page-bar">
                  <button class="btn" :disabled="pageState.loading" @click="loadMorePage">
                    {{ pageState.loading ? '加载中…' : `加载更多(已 ${pageState.loaded} 字段)` }}
                  </button>
                </div>
              </template>

              <!-- list:行内 LSET + 翻页(prev/next) -->
              <template v-else-if="selectedType === 'list'">
                <table v-if="!editing" class="grid">
                  <thead><tr><th style="width: 60px">#</th><th>value</th></tr></thead>
                  <tbody>
                    <tr v-for="(v, i) in arrayValues" :key="i">
                      <td>{{ (pageState.listStart ?? 0) + i }}</td><td>{{ v }}</td>
                    </tr>
                  </tbody>
                </table>
                <table v-else class="grid">
                  <thead><tr><th style="width: 60px">#</th><th>value</th></tr></thead>
                  <tbody>
                    <tr v-for="(_, i) in editDraft.list" :key="i">
                      <td>{{ i }}</td>
                      <td><input v-model="editDraft.list![i]" class="cell-ip" /></td>
                    </tr>
                  </tbody>
                </table>
                <div v-if="!editing && pageState.listLen" class="page-bar">
                  <button class="btn" :disabled="pageState.loading || (pageState.listStart ?? 0) === 0" @click="loadListPage(selected!.name, 'prev')">◀ 上一页</button>
                  <span class="meta">{{ pageState.listStart }}~{{ pageState.listEnd }} / {{ pageState.listLen }}</span>
                  <button class="btn" :disabled="pageState.loading || ((pageState.listEnd ?? 0) + 1 >= (pageState.listLen ?? 0))" @click="loadListPage(selected!.name, 'next')">下一页 ▶</button>
                </div>
              </template>

              <!-- set:add/remove + 分页 -->
              <template v-else-if="selectedType === 'set'">
                <table v-if="!editing" class="grid">
                  <thead><tr><th style="width: 60px">#</th><th>member</th></tr></thead>
                  <tbody>
                    <tr v-for="(v, i) in arrayValues" :key="i"><td>{{ i }}</td><td>{{ v }}</td></tr>
                  </tbody>
                </table>
                <table v-else class="grid">
                  <thead><tr><th>member</th><th style="width: 70px">状态</th><th style="width: 50px"></th></tr></thead>
                  <tbody>
                    <tr v-for="(r, i) in editDraft.set" :key="i" :class="{ del: r.action === 'remove', add: r.action === 'add' }">
                      <td><input v-model="r.member" class="cell-ip" :disabled="r.action !== 'add'" /></td>
                      <td>{{ r.action === 'add' ? '新增' : r.action === 'remove' ? '待删' : '保留' }}</td>
                      <td><button class="mini-btn danger" @click="delSetMember(i)">{{ r.action === 'remove' ? '↺' : '✕' }}</button></td>
                    </tr>
                    <tr><td colspan="3"><button class="add-row" @click="addSetMember">+ 添加 member</button></td></tr>
                  </tbody>
                </table>
                <div v-if="!editing && !pageState.finished" class="page-bar">
                  <button class="btn" :disabled="pageState.loading" @click="loadMorePage">
                    {{ pageState.loading ? '加载中…' : `加载更多(已 ${pageState.loaded} 成员)` }}
                  </button>
                </div>
              </template>

              <!-- zset:编辑 score + 增删 + 分页 -->
              <template v-else-if="selectedType === 'zset'">
                <table v-if="!editing" class="grid">
                  <thead><tr><th>member</th><th style="width: 100px">score</th></tr></thead>
                  <tbody>
                    <tr v-for="(p, i) in zsetValues" :key="i">
                      <td>{{ p.member }}</td><td>{{ p.score }}</td>
                    </tr>
                  </tbody>
                </table>
                <table v-else class="grid">
                  <thead><tr><th>member</th><th style="width: 100px">score</th><th style="width: 70px">状态</th><th style="width: 50px"></th></tr></thead>
                  <tbody>
                    <tr v-for="(r, i) in editDraft.zset" :key="i" :class="{ del: r.action === 'remove', add: r.action === 'add' }">
                      <td><input v-model="r.member" class="cell-ip" :disabled="r.action !== 'add'" /></td>
                      <td><input v-model="r.score" class="cell-ip" :disabled="r.action === 'remove'" /></td>
                      <td>{{ r.action === 'add' ? '新增' : r.action === 'remove' ? '待删' : '保留' }}</td>
                      <td><button class="mini-btn danger" @click="delZsetMember(i)">{{ r.action === 'remove' ? '↺' : '✕' }}</button></td>
                    </tr>
                    <tr><td colspan="4"><button class="add-row" @click="addZsetMember">+ 添加 member</button></td></tr>
                  </tbody>
                </table>
                <div v-if="!editing && !pageState.finished" class="page-bar">
                  <button class="btn" :disabled="pageState.loading" @click="loadMorePage">
                    {{ pageState.loading ? '加载中…' : `加载更多(已 ${pageState.loaded} 成员)` }}
                  </button>
                </div>
              </template>

              <table v-else-if="selectedType === 'stream'" class="grid stream-grid">
                <thead><tr><th style="width: 200px">id</th><th>fields</th></tr></thead>
                <tbody>
                  <tr v-for="(e, i) in streamEntries" :key="i">
                    <td class="mono">{{ e.id }}</td>
                    <td>
                      <span v-for="([fk, fv], j) in e.fields" :key="j" class="stream-pair">
                        <span class="sp-key">{{ fk }}</span>
                        <span class="sp-eq">=</span>
                        <span class="sp-val">{{ fv }}</span>
                      </span>
                    </td>
                  </tr>
                  <tr v-if="!streamEntries.length">
                    <td colspan="2" class="empty-row">空 stream</td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty">类型「{{ selectedType }}」尚未支持可视化</div>
            </template>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.redis-pane {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.crumb {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--accent);
}
.spacer {
  flex: 1;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.btn {
  padding: 4px 12px;
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: rgba(124, 108, 255, 0.14);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  border-color: var(--accent);
  color: var(--accent);
}
.cmd-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.search {
  flex: 1;
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.keys-footer {
  padding: 8px;
  display: flex;
  justify-content: center;
  border-top: 1px solid var(--border);
}
.load-more {
  width: 100%;
  font-size: 11px;
}
.meta.done {
  font-size: 11px;
  color: var(--muted);
}
.cmd {
  flex: 1;
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.cmd-out {
  flex: none;
  max-height: 140px;
  overflow: auto;
  padding: 6px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.cmd-out.err {
  background: rgba(224, 64, 80, 0.10);
  color: var(--err, #e04050);
}
.cmd-out pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.cmd-ms {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 6px;
  font-size: 10px;
  border-radius: 3px;
  background: rgba(124, 108, 255, 0.18);
  color: var(--accent);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.keys {
  width: 260px;
  flex: none;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  background: var(--panel);
}
.key-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.key-row:hover {
  background: rgba(124, 108, 255, 0.10);
}
.key-row.active {
  background: rgba(124, 108, 255, 0.22);
}
.type-tag {
  display: inline-block;
  padding: 1px 5px;
  font-size: 10px;
  color: #fff;
  border-radius: 3px;
  flex: none;
  font-family: ui-monospace, monospace;
}
.type-tag.dim {
  background: rgba(180, 180, 180, 0.4) !important;
}
.key-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, monospace;
}
.value {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 8px 10px;
}
.value-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.vh-name {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
}
.vh-type {
  font-size: 11px;
  font-family: ui-monospace, monospace;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.err-banner {
  padding: 8px 12px;
  background: rgba(224, 64, 80, 0.10);
  border: 1px solid rgba(224, 64, 80, 0.4);
  border-radius: 6px;
  color: var(--err, #e04050);
  font-size: 12px;
}
.val-text {
  margin: 0;
  padding: 8px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.grid th,
.grid td {
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  word-break: break-all;
}
.grid th {
  background: var(--panel);
  color: var(--muted);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.grid tr:hover td {
  background: rgba(124, 108, 255, 0.08);
}
.empty-row {
  text-align: center;
  color: var(--muted);
  font-style: italic;
}
.vh-ttl {
  font-size: 11px;
  font-family: ui-monospace, monospace;
  color: var(--muted);
}
.vh-ttl b {
  color: var(--text);
}
.vh-ops {
  display: inline-flex;
  gap: 4px;
}
.vh-extra {
  margin-left: auto;
  display: inline-flex;
  gap: 4px;
}
.ev-btn.danger {
  color: #e04050;
  border-color: rgba(224, 64, 80, 0.4);
}
.ev-btn.danger:hover:not(:disabled) {
  background: rgba(224, 64, 80, 0.14);
}
.ev-btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

/* keys 列表的排序/批量条 */
.keys-ctrl,
.batch-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.batch-bar {
  background: rgba(124, 108, 255, 0.10);
}
.mini-select,
.mini-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
}
.mini-btn.on {
  background: rgba(124, 108, 255, 0.22);
  color: var(--text);
  border-color: var(--accent);
}
.mini-btn.danger {
  color: #e04050;
  border-color: rgba(224, 64, 80, 0.4);
}
.mini-btn.danger:hover:not(:disabled) {
  background: rgba(224, 64, 80, 0.14);
}

/* key 行的勾选 + TTL 列 */
.kr-check {
  flex: none;
  cursor: pointer;
}
.kr-ttl {
  font-size: 10px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
  flex: none;
  margin-left: auto;
  padding-left: 6px;
}
.key-row.picked {
  background: rgba(124, 108, 255, 0.18);
}

/* JSON 切换 tab */
.json-tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 6px;
}
.val-text.json {
  background: var(--panel);
  border: 1px solid var(--accent);
}

/* 编辑模式 */
.edit-text {
  width: 100%;
  min-height: 200px;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  resize: vertical;
}
.cell-ip {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text);
  padding: 2px 6px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.cell-ip:disabled {
  opacity: 0.6;
}
tr.del td {
  text-decoration: line-through;
  background: rgba(224, 64, 80, 0.06);
}
tr.add td {
  background: rgba(124, 108, 255, 0.10);
}
.add-row {
  width: 100%;
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--muted);
  padding: 4px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}
.add-row:hover {
  color: var(--accent);
  border-color: var(--accent);
}

/* 分页条 */
.page-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 0;
  justify-content: center;
}
.ev-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
}
.ev-btn:hover {
  background: rgba(124, 108, 255, 0.14);
}
.ev-btn.on {
  background: rgba(124, 108, 255, 0.22);
  color: var(--text);
  border-color: var(--accent);
}
.metric {
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.metric-label {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.metric-val {
  margin-top: 4px;
  font-size: 22px;
  font-family: ui-monospace, monospace;
  color: var(--accent);
  font-weight: 600;
}
.metric-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.bm-section {
  margin-bottom: 10px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.bm-title {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
  font-family: ui-monospace, monospace;
}
.bm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.bm-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.bm-row input[type='number'] {
  width: 90px;
  padding: 3px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.bm-out {
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--text);
}
.bm-out b {
  color: var(--accent);
}
.bm-hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.stream-grid .mono {
  font-family: ui-monospace, monospace;
  color: var(--accent);
  white-space: nowrap;
}
.stream-pair {
  display: inline-flex;
  align-items: center;
  margin-right: 10px;
  padding: 1px 6px;
  background: rgba(124, 108, 255, 0.10);
  border-radius: 3px;
  font-size: 11px;
}
.sp-key {
  color: var(--muted);
}
.sp-eq {
  margin: 0 3px;
  color: var(--muted);
}
.sp-val {
  color: var(--text);
}
</style>
