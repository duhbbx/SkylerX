<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MongoDB 集合浏览器 + 查询编辑器。
 *
 * 最小可用形态：filter / limit / skip → executeCommand({ op: 'find', ... })。
 * 结果默认表格视图（第一层字段为列），可切换到 raw JSON。
 *
 * 表格视图支持双击 cell inline 编辑 → 攒到 dirty 集合 → 顶部「提交修改」一次循环 updateOne。
 */
import type { CommandResult, ConnectionConfig } from '@db-tool/shared-types'
import { computed, nextTick, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'

type Doc = Record<string, unknown>

/** dot-path 操作集合：set 写入 / unset 删除字段。 */
type DiffOps = { set: Record<string, unknown>; unset: Record<string, true> }

/** Mongo ObjectId 的十六进制串形态 — 24 位小写 hex（驱动 toString 出来就是这个）。 */
const HEX24 = /^[0-9a-f]{24}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  )
}

/**
 * 把任何 24-hex 字符串 wrap 成 `{ $oid: "..." }` marker，递归处理对象 / 数组。
 *
 * 用于回写：UI 层无法持有真 BSON ObjectId，只能用约定 marker 把"这串其实是 ObjectId"
 * 的信号传给驱动层。已是 marker 形态（只有 `$oid` 一个键）的原样保留，避免双层包裹。
 *
 * TODO: 驱动层 (mongo.ts) 需配合识别 `{ $oid: "..." }` → `new ObjectId(...)`。
 *       目前驱动只对键名 `_id` 做了 24-hex → ObjectId 的自动 wrap；非 `_id` 字段
 *       的引用 ObjectId（例如 `userId`、`refId`）必须依赖 `$oid` marker 才能正确还原。
 */
function wrapOidStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return HEX24.test(value) ? { $oid: value } : value
  }
  if (Array.isArray(value)) return value.map(wrapOidStrings)
  if (isPlainObject(value)) {
    // 已是 marker 形态：原样保留（不要把 hex 串再包一层）
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === '$oid' && typeof value.$oid === 'string') {
      return value
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = wrapOidStrings(v)
    return out
  }
  return value
}

/**
 * 在 `path` 下深 diff `oldV` → `newV`，把变化压成 dot-path 形态的 $set / $unset。
 *
 * 规则：
 *  - 任一方不是 plain object（含 primitive / array / null / 类型不同）→ 整字段 set，
 *    数组不展开避免索引错位。
 *  - 两侧都是 plain object → 取 key 并集：仅 new 有 → 递归；仅 old 有 → $unset；
 *    两侧都有 → 递归；两侧 JSON 等价则跳过。
 *  - 空对象 `{}` 视作合法值，按整字段写入。
 */
function diffToOps(path: string, oldV: unknown, newV: unknown, ops: DiffOps): void {
  if (!isPlainObject(oldV) || !isPlainObject(newV)) {
    if (newV === undefined) {
      ops.unset[path] = true
    } else {
      // 同值短路：避免对未变化的叶子重复 set（递归到 primitive 时也会走这里）。
      try {
        if (JSON.stringify(oldV) === JSON.stringify(newV)) return
      } catch {
        /* circular / unserializable → 落到下面整字段 set */
      }
      ops.set[path] = newV
    }
    return
  }
  // 两侧都是 plain object：空对象按整字段写入（避免空 $set 段）。
  const oldKeys = Object.keys(oldV)
  const newKeys = Object.keys(newV)
  if (newKeys.length === 0 && oldKeys.length === 0) return
  const seen = new Set<string>()
  for (const k of newKeys) {
    seen.add(k)
    const sub = path ? `${path}.${k}` : k
    if (k in oldV) {
      diffToOps(sub, oldV[k], newV[k], ops)
    } else {
      // 新增 key：递归会把整子树压成 set / 嵌套的 set。
      diffToOps(sub, undefined, newV[k], ops)
    }
  }
  for (const k of oldKeys) {
    if (seen.has(k)) continue
    const sub = path ? `${path}.${k}` : k
    ops.unset[sub] = true
  }
}

const props = defineProps<{
  conn: ConnectionConfig
  database: string
  collection: string
}>()

const client = useDataClient()

const filterText = ref('{}')
const limit = ref(50)
const skip = ref(0)
const view = ref<'table' | 'raw'>('table')

const running = ref(false)
/** 用户编辑的副本（双向绑定的数据源）。 */
const rows = ref<Doc[]>([])
/** find 拉回时深拷贝保存的原始快照，用于生成 $set 子集 / 撤销。 */
const originals = ref<Map<string, Doc>>(new Map())
/** dirty[docId] = 改过的一级字段名集合。 */
const dirty = ref<Map<string, Set<string>>>(new Map())
const meta = ref<{ executionTimeMs: number; truncated: boolean } | null>(null)
const committing = ref(false)

/** 当前正在 inline 编辑的 cell。 */
const editing = ref<{ docId: string; col: string } | null>(null)
const editBuf = ref('')
const editorRef = ref<HTMLTextAreaElement | null>(null)
/** v-for 里的 :ref 必须用函数形式，否则会被收成数组。 */
function bindEditor(el: Element | { $el?: Element } | null): void {
  if (el && (el as HTMLTextAreaElement).tagName === 'TEXTAREA') {
    editorRef.value = el as HTMLTextAreaElement
  }
}

/** 行集第一层字段并集（保留首次出现顺序）。 */
const columns = computed<string[]>(() => {
  const set = new Set<string>()
  for (const r of rows.value) {
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r)) set.add(k)
    }
  }
  return [...set]
})

const rawJson = computed(() => {
  try {
    return JSON.stringify(rows.value, null, 2)
  } catch {
    return String(rows.value)
  }
})

const dirtyCount = computed(() => dirty.value.size)
const canCommit = computed(() => dirtyCount.value > 0 && !committing.value && !running.value)

/** doc 主键 key：String(_id) — find 结果 _id 经 IPC 已 JSON 化，通常是字符串。 */
function docKey(doc: Doc): string {
  return String(doc._id)
}

/**
 * 把单元格内的值压成短字符串：原子量直接 String；对象 JSON 截断到 120 字符。
 *
 * 特殊处理：
 *  - `_id` 列且值是 24-hex 字符串 → 展示为 `ObjectId("...")`，提示用户这是 BSON ObjectId
 *    （IPC 序列化后变成了字符串）。
 *  - 已是 `{ $oid: "..." }` marker 形态的对象（任何列）→ 也展示为 `ObjectId("...")`。
 */
function renderCell(v: unknown, col?: string): string {
  if (v == null) return ''
  if (typeof v === 'string') {
    if (col === '_id' && HEX24.test(v)) return `ObjectId("${v}")`
    return v
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (isPlainObject(v)) {
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '$oid' && typeof v.$oid === 'string') {
      return `ObjectId("${v.$oid}")`
    }
  }
  let s: string
  try {
    s = JSON.stringify(v)
  } catch {
    s = String(v)
  }
  return s.length > 120 ? `${s.slice(0, 117)}…` : s
}

/** 该 cell 是否已被编辑过（与 originals 不一致）。 */
function isDirtyCell(doc: Doc, col: string): boolean {
  const set = dirty.value.get(docKey(doc))
  return !!set && set.has(col)
}

function isEditing(doc: Doc, col: string): boolean {
  const e = editing.value
  return !!e && e.docId === docKey(doc) && e.col === col
}

async function runQuery(): Promise<void> {
  let filter: unknown = {}
  const text = filterText.value.trim()
  if (text) {
    try {
      filter = JSON.parse(text)
    } catch (e) {
      toast.error(`Filter 不是合法 JSON: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
  }
  running.value = true
  try {
    const res: CommandResult = await client.connections.executeCommand(props.conn.id, {
      op: 'find',
      args: {
        filter,
        options: {
          limit: Math.max(0, Math.floor(limit.value)),
          skip: Math.max(0, Math.floor(skip.value)),
        },
      },
      context: { database: props.database, collection: props.collection },
      maxRows: 500,
    })
    const data = Array.isArray(res.data) ? (res.data as Doc[]) : []
    // 深拷贝两份：rows 给用户改，originals 保留快照
    rows.value = JSON.parse(JSON.stringify(data)) as Doc[]
    const map = new Map<string, Doc>()
    for (const d of data) map.set(String(d._id), JSON.parse(JSON.stringify(d)) as Doc)
    originals.value = map
    dirty.value = new Map()
    editing.value = null
    meta.value = { executionTimeMs: res.executionTimeMs, truncated: !!res.truncated }
  } catch (e) {
    toast.error(`执行失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
  }
}

function refresh(): void {
  void runQuery()
}

/** 双击 cell：_id 列禁止；其它列进入 inline 编辑模式。 */
function onCellDblClick(doc: Doc, col: string): void {
  if (view.value !== 'table') return
  if (col === '_id') {
    toast.info('_id 不可改')
    return
  }
  const v = doc[col]
  editBuf.value = v === undefined ? '' : JSON.stringify(v)
  editing.value = { docId: docKey(doc), col }
  void nextTick(() => {
    editorRef.value?.focus()
    editorRef.value?.select()
  })
}

/** 确认编辑：JSON.parse 新值；失败 toast 不破坏旧值。 */
function applyEdit(): void {
  const e = editing.value
  if (!e) return
  let parsed: unknown
  try {
    parsed = JSON.parse(editBuf.value)
  } catch (err) {
    toast.error(`不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const doc = rows.value.find((r) => docKey(r) === e.docId)
  if (!doc) {
    editing.value = null
    return
  }
  const original = originals.value.get(e.docId)
  const originalVal = original ? original[e.col] : undefined
  doc[e.col] = parsed as never
  // dirty 判断：和 originals 对比（JSON 表示相等就视为没改）
  const sameAsOriginal = JSON.stringify(parsed) === JSON.stringify(originalVal)
  const fields = dirty.value.get(e.docId) ?? new Set<string>()
  if (sameAsOriginal) {
    fields.delete(e.col)
  } else {
    fields.add(e.col)
  }
  if (fields.size === 0) {
    dirty.value.delete(e.docId)
  } else {
    dirty.value.set(e.docId, fields)
  }
  // 触发响应式（Map 的 set/delete 在 Vue 3 ref 中已可观察，但显式克隆一下保险）
  dirty.value = new Map(dirty.value)
  editing.value = null
}

function cancelEdit(): void {
  editing.value = null
}

/** 撤销所有未提交修改：current = clone(originals)。 */
function revertEdits(): void {
  const restored: Doc[] = []
  for (const r of rows.value) {
    const orig = originals.value.get(docKey(r))
    restored.push(orig ? (JSON.parse(JSON.stringify(orig)) as Doc) : r)
  }
  rows.value = restored
  dirty.value = new Map()
  editing.value = null
}

/**
 * 提交修改：对每个 dirty doc 调一次 updateOne。
 *
 * ObjectId 经 IPC JSON 序列化后已变为字符串（如 "65f1..."），用户编辑也是字符串形态。
 * 这里在送出时把所有 24-hex 字符串包成 `{ $oid: "..." }` marker，由驱动层负责还原成
 * 真 BSON ObjectId（命中 `_id` 是 ObjectId 的文档必需）。
 *
 * 已知 trade-off：刚好长得像 24-hex 的纯文本字符串（极少见）会被误包成 ObjectId。
 *
 * TODO: 驱动层 (mongo.ts) 需配合识别 `{ $oid: "..." }` marker。当前驱动只对键名 `_id`
 *       做 24-hex → ObjectId 的自动 wrap；非 `_id` 字段的 ObjectId 引用，必须依赖
 *       驱动层先实现 `$oid` marker 识别才能正确写回。
 */
async function commitEdits(): Promise<void> {
  if (dirty.value.size === 0) return
  committing.value = true
  const failures: string[] = []
  let committed = 0
  try {
    for (const [docId, fields] of dirty.value) {
      const original = originals.value.get(docId)
      const current = rows.value.find((r) => docKey(r) === docId)
      if (!original || !current) continue
      // 对每个 dirty 一级字段做深 diff，合并到单文档 ops。
      const ops: DiffOps = { set: {}, unset: {} }
      for (const f of fields) {
        diffToOps(f, original[f], current[f], ops)
      }
      const hasSet = Object.keys(ops.set).length > 0
      const hasUnset = Object.keys(ops.unset).length > 0
      // 全字段被 diff 回原值 → 跳过；externally 也应被 applyEdit 清掉，这里兜底。
      if (!hasSet && !hasUnset) continue
      const update: Record<string, unknown> = {}
      // $set 里凡 24-hex 字符串 → wrap 成 $oid marker（驱动层解码）
      if (hasSet) update.$set = wrapOidStrings(ops.set) as Record<string, unknown>
      if (hasUnset) update.$unset = ops.unset
      // filter._id 同样 wrap：原始 _id 多半是 24-hex string，需要驱动还原成 ObjectId
      const filterId = wrapOidStrings(original._id)
      try {
        await client.connections.executeCommand(props.conn.id, {
          op: 'updateOne',
          args: {
            filter: { _id: filterId },
            update,
            options: {},
          },
          context: { database: props.database, collection: props.collection },
        })
        committed += 1
      } catch (e) {
        failures.push(`${docId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (failures.length) {
      toast.error(`部分更新失败 (${failures.length}): ${failures[0]}`)
      // 失败保留 dirty，让用户重试
    } else {
      toast.success(`已提交 ${committed} 条修改`)
      await runQuery()
    }
  } finally {
    committing.value = false
  }
}
</script>

<template>
  <div class="mongo-pane">
    <div class="toolbar">
      <span class="crumb">
        <span class="db">{{ database }}</span>
        <span class="sep">·</span>
        <span class="coll">{{ collection }}</span>
      </span>
      <button class="btn" :disabled="running" @click="refresh">刷新</button>
      <button
        class="btn primary"
        :disabled="!canCommit"
        :title="dirtyCount === 0 ? '没有未提交的修改' : '逐条 updateOne 提交'"
        @click="commitEdits"
      >
        {{ committing ? '提交中…' : `提交修改 (${dirtyCount})` }}
      </button>
      <button class="btn" :disabled="dirtyCount === 0 || committing" @click="revertEdits">撤销修改</button>
      <span class="spacer" />
      <span v-if="meta" class="meta">
        {{ rows.length }} 行 · {{ meta.executionTimeMs }} ms<span v-if="meta.truncated"> · 已截断</span>
      </span>
    </div>

    <div class="editor">
      <textarea
        v-model="filterText"
        class="filter"
        spellcheck="false"
        placeholder='{ "_id": "..." }'
      />
      <div class="opts">
        <label>limit
          <input v-model.number="limit" type="number" min="0" step="10" />
        </label>
        <label>skip
          <input v-model.number="skip" type="number" min="0" step="10" />
        </label>
        <button class="btn primary" :disabled="running" @click="runQuery">
          {{ running ? '执行中…' : '执行' }}
        </button>
        <span class="spacer" />
        <div class="view-toggle">
          <button :class="{ on: view === 'table' }" @click="view = 'table'">表格</button>
          <button :class="{ on: view === 'raw' }" @click="view = 'raw'">JSON</button>
        </div>
      </div>
    </div>

    <div class="result">
      <template v-if="view === 'table'">
        <div v-if="!rows.length" class="empty">无数据 — 调整 filter 后点「执行」</div>
        <table v-else class="grid">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td
                v-for="c in columns"
                :key="c"
                :class="{
                  dirty: isDirtyCell(r, c),
                  editing: isEditing(r, c),
                  idcol: c === '_id',
                }"
                :title="isEditing(r, c) ? '' : renderCell(r[c], c)"
                @dblclick="onCellDblClick(r, c)"
              >
                <span v-if="isEditing(r, c)" class="cell-edit" @click.stop>
                  <textarea
                    :ref="bindEditor"
                    v-model="editBuf"
                    class="edit-area"
                    spellcheck="false"
                    @keydown.esc.prevent="cancelEdit"
                    @keydown.enter.exact.prevent="applyEdit"
                  />
                  <span class="edit-actions">
                    <button class="ok" title="确认 (Enter)" @mousedown.prevent="applyEdit">✓</button>
                    <button title="取消 (Esc)" @mousedown.prevent="cancelEdit">✕</button>
                  </span>
                </span>
                <template v-else>{{ renderCell(r[c], c) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <pre v-else class="raw">{{ rawJson }}</pre>
    </div>
  </div>
</template>

<style scoped>
.mongo-pane {
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.crumb .db {
  color: var(--accent);
}
.crumb .sep {
  color: var(--muted);
}
.crumb .coll {
  color: var(--text);
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
.filter {
  width: 100%;
  min-height: 64px;
  resize: vertical;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: ui-monospace, monospace;
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
.opts input[type='number'] {
  width: 80px;
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
  font-family: ui-monospace, monospace;
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
.grid td.dirty {
  background: rgba(124, 108, 255, 0.18);
}
.grid td.idcol {
  color: var(--muted);
  cursor: not-allowed;
}
.grid td.editing {
  padding: 0;
  max-width: none;
  white-space: normal;
}
.cell-edit {
  display: flex;
  align-items: stretch;
  gap: 0;
}
.cell-edit .edit-area {
  flex: 1;
  min-width: 160px;
  min-height: 56px;
  padding: 4px 6px;
  border: 1px solid var(--accent);
  border-radius: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  resize: vertical;
}
.cell-edit .edit-actions {
  display: inline-flex;
  flex-direction: column;
}
.cell-edit .edit-actions button {
  flex: 1;
  border: 1px solid var(--border);
  border-left: none;
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  padding: 0 8px;
  cursor: pointer;
}
.cell-edit .edit-actions button.ok {
  color: var(--accent);
}
.cell-edit .edit-actions button:hover {
  background: rgba(124, 108, 255, 0.14);
}
.raw {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}
</style>
