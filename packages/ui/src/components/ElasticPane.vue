<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Elasticsearch index 查询面板。
 *
 * 最小可用形态：在顶部选 op（search / count / getMapping），中部 textarea 写 Query DSL，
 * 下部展示结果。search 默认表格视图（取 hits.hits[0]._source 的字段当列 + _id 列），
 * 可切换 raw JSON 视图。
 *
 * 命令通道：client.connections.executeCommand(conn.id, { op, args: { index, body }, ... })。
 * ES 驱动会从 args.index 或 context.collection 拿到目标索引，这里两路都填以兼容。
 */
import type { CommandResult, ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { reportError } from '../errorReporter'

type EsOp = 'search' | 'count' | 'getMapping'

const props = defineProps<{
  conn: ConnectionConfig
  index: string
}>()

const client = useDataClient()

const DEFAULT_DSL = `{
  "query": { "match_all": {} },
  "size": 100
}`

const queryText = ref<string>(DEFAULT_DSL)
const op = ref<EsOp>('search')
const view = ref<'table' | 'raw'>('table')

const running = ref(false)
/** docs.count（顶部显示）；null = 未取。 */
const docsCount = ref<number | null>(null)
/** search 结果命中文档；mapping 模式下未使用。 */
const hits = ref<Record<string, unknown>[]>([])
/** mapping / count 等非 search 结果的原始 JSON 视图。 */
const rawResult = ref<unknown>(null)
const totalHits = ref<number | null>(null)
const tookMs = ref<number | null>(null)
const lastOp = ref<EsOp | null>(null)

/** hits[0]._source 字段并集；保留首次出现顺序，外加 _id 列固定在最前。 */
const columns = computed<string[]>(() => {
  const set = new Set<string>()
  for (const h of hits.value) {
    const src = (h._source ?? {}) as Record<string, unknown>
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) set.add(k)
    }
  }
  return ['_id', ...set]
})

const rawJson = computed<string>(() => {
  const target = lastOp.value === 'search' ? hits.value : rawResult.value
  try {
    return JSON.stringify(target, null, 2)
  } catch {
    return String(target)
  }
})

/** 单元格渲染：原子量直接 String；对象/数组 JSON 截断到 120 字符。 */
function renderCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

/** 取 hit 中给定列的值；_id 走 hit._id，其它走 hit._source[col]。 */
function cellOf(hit: Record<string, unknown>, col: string): unknown {
  if (col === '_id') return hit._id
  const src = (hit._source ?? {}) as Record<string, unknown>
  return src[col]
}

/** 解析 textarea 中的 DSL，失败 toast 并返回 null。 */
function parseBody(): unknown | null {
  const text = queryText.value.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch (e) {
    reportError(e, { tag: 'elastic-query-json' })
    return null
  }
}

async function execute(): Promise<void> {
  const cur = op.value
  let body: unknown = {}
  // search / count 走 textarea 里的 DSL；getMapping 不需要 body。
  if (cur === 'search' || cur === 'count') {
    const parsed = parseBody()
    if (parsed === null) return
    body = parsed
  }
  running.value = true
  try {
    const res: CommandResult = await client.connections.executeCommand(props.conn.id, {
      op: cur,
      args: { index: props.index, body },
      context: { collection: props.index },
      maxRows: 500,
    })
    lastOp.value = cur
    tookMs.value = res.executionTimeMs
    const data = res.data as Record<string, unknown> | unknown[]
    if (cur === 'search') {
      // ES 形状：{ hits: { hits: [...], total: { value: N } }, took }
      const top = (data ?? {}) as { hits?: { hits?: unknown[]; total?: unknown }; took?: number }
      const arr = Array.isArray(top.hits?.hits) ? (top.hits!.hits as Record<string, unknown>[]) : []
      hits.value = arr
      // total 既可能是 { value: N }（>=7.0），也可能是 number（早期）。
      const total = top.hits?.total as unknown
      if (total && typeof total === 'object' && 'value' in (total as object)) {
        totalHits.value = Number((total as { value: unknown }).value)
      } else if (typeof total === 'number') {
        totalHits.value = total
      } else {
        totalHits.value = arr.length
      }
      rawResult.value = data
    } else if (cur === 'count') {
      // ES count: { count: N, _shards: {...} }
      const c = (data as { count?: number })?.count
      rawResult.value = data
      hits.value = []
      totalHits.value = typeof c === 'number' ? c : null
      if (typeof c === 'number') docsCount.value = c
    } else {
      // getMapping: { <index>: { mappings: {...} } }
      rawResult.value = data
      hits.value = []
      totalHits.value = null
    }
  } catch (e) {
    reportError(e, { tag: 'elastic-execute' })
  } finally {
    running.value = false
  }
}

/** 刷新 docs.count（顶部 badge）：单独一次 count 调用，不动主结果区。 */
async function refreshDocsCount(): Promise<void> {
  try {
    const res = await client.connections.executeCommand(props.conn.id, {
      op: 'count',
      args: { index: props.index, body: {} },
      context: { collection: props.index },
    })
    const c = (res.data as { count?: number })?.count
    if (typeof c === 'number') docsCount.value = c
  } catch {
    // 顶部 badge 取不到不算致命，静默
  }
}

function refresh(): void {
  void refreshDocsCount()
  void execute()
}

// 切换索引 / 连接：清空状态并刷新 docs.count
watch(
  () => [props.conn.id, props.index] as const,
  () => {
    hits.value = []
    rawResult.value = null
    totalHits.value = null
    tookMs.value = null
    docsCount.value = null
    lastOp.value = null
    queryText.value = DEFAULT_DSL
    op.value = 'search'
    void refreshDocsCount()
  },
  { immediate: true },
)
</script>

<template>
  <div class="es-pane">
    <div class="toolbar">
      <span class="crumb">{{ index }}</span>
      <button class="btn" :disabled="running" @click="refresh">刷新</button>
      <span class="spacer" />
      <span v-if="docsCount != null" class="meta">docs.count: {{ docsCount }}</span>
    </div>

    <div class="editor">
      <textarea
        v-model="queryText"
        class="query"
        spellcheck="false"
        :placeholder="DEFAULT_DSL"
      />
      <div class="opts">
        <label>op
          <select v-model="op">
            <option value="search">search</option>
            <option value="count">count</option>
            <option value="getMapping">getMapping</option>
          </select>
        </label>
        <button class="btn primary" :disabled="running" @click="execute">
          {{ running ? '执行中…' : '执行' }}
        </button>
        <span class="spacer" />
        <div class="view-toggle">
          <button :class="{ on: view === 'table' }" @click="view = 'table'">表格</button>
          <button :class="{ on: view === 'raw' }" @click="view = 'raw'">原始 JSON</button>
        </div>
      </div>
      <div v-if="totalHits != null || tookMs != null" class="meta-row">
        <span v-if="totalHits != null" class="meta">total: {{ totalHits }}</span>
        <span v-if="tookMs != null" class="meta">· {{ tookMs }} ms</span>
      </div>
    </div>

    <div class="result">
      <template v-if="view === 'table'">
        <template v-if="lastOp === 'search'">
          <div v-if="!hits.length" class="empty">0 hits</div>
          <table v-else class="grid">
            <thead>
              <tr>
                <th v-for="c in columns" :key="c">{{ c }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(h, i) in hits" :key="(h._id as string | undefined) ?? i">
                <td
                  v-for="c in columns"
                  :key="c"
                  :class="{ idcol: c === '_id' }"
                  :title="renderCell(cellOf(h, c))"
                >{{ renderCell(cellOf(h, c)) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <pre v-else-if="rawResult != null" class="raw">{{ rawJson }}</pre>
        <div v-else class="empty">点「执行」运行查询</div>
      </template>
      <pre v-else class="raw">{{ rawJson }}</pre>
    </div>
  </div>
</template>

<style scoped>
.es-pane {
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
  font-family: var(--font-mono);
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
.editor {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.query {
  width: 100%;
  min-height: 110px;
  resize: vertical;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
}
.opts {
  display: flex;
  align-items: center;
  gap: 10px;
}
.opts label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.opts select {
  padding: 4px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text);
  font-size: 12px;
}
.view-toggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.view-toggle button {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.view-toggle button.on {
  background: rgba(124, 108, 255, 0.18);
  color: var(--text);
}
.meta-row {
  display: flex;
  gap: 6px;
}
.result {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.empty {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  font-family: var(--font-mono);
}
.grid th,
.grid td {
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.grid td.idcol {
  color: var(--muted);
}
.raw {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}
</style>
