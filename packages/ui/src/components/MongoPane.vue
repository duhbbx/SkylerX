<script setup lang="ts">
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

/** 把单元格内的值压成短字符串：原子量直接 String；对象 JSON 截断到 120 字符。 */
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
 * TODO: ObjectId 经 IPC JSON 序列化后已变为字符串（如 "65f1..."），Mongo 驱动 v6
 *       不会自动还原成 ObjectId 类型，filter `{ _id: '65f1...' }` 在 _id 是真 ObjectId
 *       的集合上匹配不上。要彻底正确，需要在驱动层把字符串形态的 24 hex 还原成 ObjectId。
 *       这里先用 _id 原值透传，字符串主键 / 数字主键的集合可以工作。
 */
async function commitEdits(): Promise<void> {
  if (dirty.value.size === 0) return
  committing.value = true
  const failures: string[] = []
  try {
    for (const [docId, fields] of dirty.value) {
      const original = originals.value.get(docId)
      const current = rows.value.find((r) => docKey(r) === docId)
      if (!original || !current) continue
      const set: Doc = {}
      for (const f of fields) set[f] = current[f]
      try {
        await client.connections.executeCommand(props.conn.id, {
          op: 'updateOne',
          args: {
            filter: { _id: original._id },
            update: { $set: set },
            options: {},
          },
          context: { database: props.database, collection: props.collection },
        })
      } catch (e) {
        failures.push(`${docId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (failures.length) {
      toast.error(`部分更新失败 (${failures.length}): ${failures[0]}`)
      // 失败保留 dirty，让用户重试
    } else {
      toast.success(`已提交 ${dirty.value.size} 条修改`)
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
                :title="isEditing(r, c) ? '' : renderCell(r[c])"
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
                <template v-else>{{ renderCell(r[c]) }}</template>
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
