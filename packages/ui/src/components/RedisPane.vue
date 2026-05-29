<script setup lang="ts">/*
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
import { toast } from '../dialog'

const props = defineProps<{
  conn: ConnectionConfig
  dbIndex: number
}>()

const client = useDataClient()

type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'none' | string

interface KeyItem {
  name: string
  type: RedisType | null // null = 还在查询中 / 未查
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
      const r = await call('HGETALL', [k.name])
      // Redis HGETALL 可能返回 Record 或扁平 array；两种都兼容
      let map: Record<string, string> = {}
      if (Array.isArray(r.data)) {
        const a = r.data as unknown[]
        for (let i = 0; i + 1 < a.length; i += 2) map[String(a[i])] = String(a[i + 1] ?? '')
      } else if (r.data && typeof r.data === 'object') {
        map = Object.fromEntries(
          Object.entries(r.data as Record<string, unknown>).map(([kk, vv]) => [
            kk,
            String(vv ?? ''),
          ]),
        )
      }
      if (valueState.value) valueState.value.hash = map
    } else if (typ === 'list') {
      const r = await call('LRANGE', [k.name, '0', '-1'])
      if (valueState.value) valueState.value.array = (r.data as unknown[]).map((x) => String(x))
    } else if (typ === 'set') {
      const r = await call('SMEMBERS', [k.name])
      if (valueState.value) valueState.value.array = (r.data as unknown[]).map((x) => String(x))
    } else if (typ === 'zset') {
      const r = await call('ZRANGE', [k.name, '0', '-1', 'WITHSCORES'])
      const a = (r.data as unknown[]) ?? []
      const pairs: { member: string; score: string }[] = []
      for (let i = 0; i + 1 < a.length; i += 2) {
        pairs.push({ member: String(a[i]), score: String(a[i + 1]) })
      }
      if (valueState.value) valueState.value.zset = pairs
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
</script>

<template>
  <div class="redis-pane">
    <div class="toolbar">
      <span class="crumb">db{{ dbIndex }}</span>
      <button class="btn" :disabled="loadingKeys" @click="resetAndLoad">刷新</button>
      <span class="spacer" />
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
        <template v-if="!keys.length">
          <div v-if="loadingKeys" class="empty">加载中…</div>
          <div v-else-if="finished" class="empty">空</div>
          <div v-else class="empty">…</div>
        </template>
        <template v-else>
          <div
            v-for="k in keys"
            :key="k.name"
            class="key-row"
            :class="{ active: selected?.name === k.name }"
            @click="selectKey(k)"
          >
            <span
              v-if="k.type"
              class="type-tag"
              :style="{ background: typeTagColor(k.type) }"
              :title="k.type"
            >{{ k.type }}</span>
            <span v-else class="type-tag dim" title="未取类型">?</span>
            <span class="key-name" :title="k.name">{{ k.name }}</span>
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
              <pre v-if="selectedType === 'string'" class="val-text">{{ stringValue }}</pre>
              <table v-else-if="selectedType === 'hash'" class="grid">
                <thead><tr><th>field</th><th>value</th></tr></thead>
                <tbody>
                  <tr v-for="[kk, vv] in hashEntries" :key="kk">
                    <td>{{ kk }}</td><td>{{ vv }}</td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="selectedType === 'list' || selectedType === 'set'" class="grid">
                <thead><tr><th style="width: 60px">#</th><th>value</th></tr></thead>
                <tbody>
                  <tr v-for="(v, i) in arrayValues" :key="i">
                    <td>{{ i }}</td><td>{{ v }}</td>
                  </tr>
                </tbody>
              </table>
              <table v-else-if="selectedType === 'zset'" class="grid">
                <thead><tr><th>member</th><th style="width: 100px">score</th></tr></thead>
                <tbody>
                  <tr v-for="(p, i) in zsetValues" :key="i">
                    <td>{{ p.member }}</td><td>{{ p.score }}</td>
                  </tr>
                </tbody>
              </table>
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
.vh-extra {
  margin-left: auto;
  display: inline-flex;
  gap: 4px;
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
