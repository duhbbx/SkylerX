<script setup lang="ts">
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

const keys = ref<KeyItem[]>([])
const cursor = ref<string>('0')
const loadingKeys = ref(false)
const finished = ref(false)
const match = ref<string>('*')
const selected = ref<KeyItem | null>(null)

const SCAN_COUNT = 500
const TYPE_BATCH_LIMIT = 100

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
  loading: boolean
  error: string | null
}
const valueState = ref<ValueState | null>(null)

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
 * 然后批量并发 TYPE（限 100 条）。
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

    // 批量 TYPE，限 TYPE_BATCH_LIMIT 条够用
    const slice = newItems.slice(0, TYPE_BATCH_LIMIT)
    await Promise.all(
      slice.map(async (it) => {
        try {
          const r = await call('TYPE', [it.name])
          it.type = String(r.data ?? 'none') as RedisType
        } catch {
          it.type = 'none'
        }
      }),
    )

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
    }
    // stream / 其它类型暂留空
  } catch (e) {
    if (valueState.value) valueState.value.error = e instanceof Error ? e.message : String(e)
  } finally {
    if (valueState.value) valueState.value.loading = false
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
          </div>
          <div v-if="valueState.loading" class="empty">加载中…</div>
          <div v-else-if="valueState.error" class="err-banner">✗ {{ valueState.error }}</div>
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
            <div v-else class="empty">类型「{{ selectedType }}」尚未支持可视化</div>
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
</style>
