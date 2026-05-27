<script setup lang="ts">
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import type { EditChanges } from '../editable'

type Row = Record<string, unknown>

const props = defineProps<{
  result: QueryResult | null
  error: string | null
  running: boolean
  pageable?: boolean
  page?: number
  pageSize?: number
  hasMore?: boolean
  editable?: boolean
}>()
const emit = defineEmits<{
  changePage: [number]
  changePageSize: [number]
  commit: [EditChanges]
}>()

const PAGE_SIZES = [100, 200, 500, 1000]
const jumpTo = ref('')

// ── 编辑态 ──
const localRows = ref<Row[]>([])
const original = ref<Row[]>([])
const deleted = ref<boolean[]>([])
const inserts = ref<Row[]>([])
const editing = ref<{ area: 'r' | 'n'; index: number; col: string } | null>(null)
const selected = ref<Set<string>>(new Set())
const lastClick = ref<{ area: 'r' | 'n'; index: number } | null>(null)

const columnNames = computed(() => props.result?.columns.map((c) => c.name) ?? [])

function resetEdits(): void {
  const rows = props.result?.rows ?? []
  localRows.value = JSON.parse(JSON.stringify(rows)) as Row[]
  original.value = JSON.parse(JSON.stringify(rows)) as Row[]
  deleted.value = rows.map(() => false)
  inserts.value = []
  editing.value = null
  selected.value = new Set()
  lastClick.value = null
}
watch(() => props.result, resetEdits, { immediate: true })

function isModified(i: number, col: string): boolean {
  return props.editable && localRows.value[i]?.[col] !== original.value[i]?.[col]
}

const dirty = computed(() => {
  if (!props.editable) return false
  if (inserts.value.length || deleted.value.some(Boolean)) return true
  return localRows.value.some((r, i) => columnNames.value.some((c) => r[c] !== original.value[i]?.[c]))
})

const changeCount = computed(() => {
  let n = inserts.value.length + deleted.value.filter(Boolean).length
  localRows.value.forEach((r, i) => {
    if (deleted.value[i]) return
    if (columnNames.value.some((c) => r[c] !== original.value[i]?.[c])) n++
  })
  return n
})

// 行选择（单击=单选，⌘/Ctrl=切换，Shift=区间）
function isSel(area: 'r' | 'n', index: number): boolean {
  return selected.value.has(area + index)
}
function onRowClick(area: 'r' | 'n', index: number, e: MouseEvent): void {
  if (!props.editable) return
  const key = area + index
  if (e.metaKey || e.ctrlKey) {
    const s = new Set(selected.value)
    if (s.has(key)) s.delete(key)
    else s.add(key)
    selected.value = s
  } else if (e.shiftKey && lastClick.value?.area === area) {
    const s = new Set(selected.value)
    const lo = Math.min(lastClick.value.index, index)
    const hi = Math.max(lastClick.value.index, index)
    for (let i = lo; i <= hi; i++) s.add(area + i)
    selected.value = s
  } else {
    selected.value = new Set([key])
  }
  lastClick.value = { area, index }
}

function addRow(): void {
  const row: Row = {}
  for (const c of columnNames.value) row[c] = ''
  inserts.value.push(row)
}
function deleteSelected(): void {
  const insIdx: number[] = []
  for (const key of selected.value) {
    const i = Number(key.slice(1))
    if (key[0] === 'r') deleted.value[i] = true
    else insIdx.push(i)
  }
  insIdx.sort((a, b) => b - a).forEach((k) => inserts.value.splice(k, 1))
  selected.value = new Set()
}

function startEdit(area: 'r' | 'n', index: number, col: string): void {
  if (!props.editable) return
  if (area === 'r' && deleted.value[index]) return
  editing.value = { area, index, col }
}
function isEditing(area: 'r' | 'n', index: number, col: string): boolean {
  const e = editing.value
  return !!e && e.area === area && e.index === index && e.col === col
}

function commit(): void {
  const updates: EditChanges['updates'] = []
  const deletes: Row[] = []
  localRows.value.forEach((r, i) => {
    if (deleted.value[i]) {
      deletes.push(original.value[i])
      return
    }
    const changed: Record<string, unknown> = {}
    for (const c of columnNames.value) if (r[c] !== original.value[i]?.[c]) changed[c] = r[c]
    if (Object.keys(changed).length) updates.push({ original: original.value[i], changed })
  })
  emit('commit', { updates, deletes, inserts: inserts.value.map((r) => ({ ...r })) })
}

function doJump(): void {
  const n = Number.parseInt(jumpTo.value, 10)
  if (Number.isFinite(n) && n >= 1) emit('changePage', n - 1)
  jumpTo.value = ''
}

function isNull(v: unknown): boolean {
  return v === null || v === undefined
}
function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<template>
  <div class="grid-wrap">
    <div v-if="running" class="grid-msg">执行中…</div>
    <div v-else-if="error" class="grid-err">✗ {{ error }}</div>
    <div v-else-if="!result" class="grid-msg">在上方输入 SQL，⌘/Ctrl+Enter 或点「运行」执行</div>
    <template v-else>
      <div v-if="editable && result.columns.length" class="edit-tools">
        <button title="新增行" @click="addRow">＋</button>
        <button title="删除选中行" :disabled="!selected.size" @click="deleteSelected">－</button>
        <button class="ok" title="提交修改" :disabled="!dirty" @click="commit">✓ 提交</button>
        <button title="还原" :disabled="!dirty" @click="resetEdits">↺</button>
        <span v-if="dirty" class="chg">{{ changeCount }} 项改动</span>
        <span v-if="selected.size" class="chg muted">已选 {{ selected.size }} 行</span>
        <span class="hint">双击单元格编辑 · 单击选行（⌘/Shift 多选）</span>
      </div>

      <div v-if="result.columns.length" class="grid-scroll">
        <table>
          <thead>
            <tr>
              <th class="rownum">#</th>
              <th v-for="c in result.columns" :key="c.name">
                {{ c.name }}<span class="th-type">{{ c.dataType }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in (editable ? localRows : result.rows)"
              :key="'r' + i"
              :class="{ selected: isSel('r', i), deleted: editable && deleted[i] }"
              @click="onRowClick('r', i, $event)"
            >
              <td class="rownum">{{ i + 1 }}</td>
              <td
                v-for="c in result.columns"
                :key="c.name"
                :class="{
                  nullcell: isNull(row[c.name]),
                  modified: isModified(i, c.name),
                  editing: isEditing('r', i, c.name),
                }"
                @dblclick="startEdit('r', i, c.name)"
              >
                <input
                  v-if="editable && isEditing('r', i, c.name)"
                  v-model="localRows[i][c.name]"
                  autofocus
                  @blur="editing = null"
                  @keyup.enter="editing = null"
                  @click.stop
                />
                <template v-else>{{ fmt(row[c.name]) }}</template>
              </td>
            </tr>
            <tr
              v-for="(row, k) in inserts"
              :key="'n' + k"
              class="newrow"
              :class="{ selected: isSel('n', k) }"
              @click="onRowClick('n', k, $event)"
            >
              <td class="rownum">+</td>
              <td
                v-for="c in result.columns"
                :key="c.name"
                :class="{ editing: isEditing('n', k, c.name) }"
                @dblclick="startEdit('n', k, c.name)"
              >
                <input
                  v-if="isEditing('n', k, c.name)"
                  v-model="inserts[k][c.name]"
                  autofocus
                  @blur="editing = null"
                  @keyup.enter="editing = null"
                  @click.stop
                />
                <template v-else>{{ row[c.name] === '' ? '' : fmt(row[c.name]) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="grid-msg">执行成功</div>

      <div class="statusbar">
        <template v-if="pageable && result.columns.length">
          <button :disabled="(page ?? 0) <= 0" @click="emit('changePage', (page ?? 0) - 1)">‹ 上一页</button>
          <span class="pg-info">第 {{ (page ?? 0) + 1 }} 页</span>
          <button :disabled="!hasMore" @click="emit('changePage', (page ?? 0) + 1)">下一页 ›</button>
          <span class="sep" />
          <label>每页</label>
          <select
            class="pgsize"
            :value="pageSize"
            @change="emit('changePageSize', Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
          <span class="sep" />
          <label>跳至</label>
          <input v-model="jumpTo" class="jump" type="number" min="1" @keyup.enter="doJump" />
          <button @click="doJump">跳转</button>
        </template>

        <span class="meta">
          <template v-if="result.columns.length">{{ result.rowCount }} 行</template>
          <template v-else>影响 {{ result.affectedRows ?? 0 }} 行</template>
          · {{ result.executionTimeMs }} ms
          <span v-if="result.truncated" class="trunc">（已截断）</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.grid-wrap {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.grid-msg {
  padding: 16px;
  color: var(--muted);
}
.grid-err {
  padding: 16px;
  color: var(--err);
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.grid-meta {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.trunc {
  color: #e0a020;
}
.edit-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
}
.edit-tools button {
  min-width: 28px;
  padding: 3px 8px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.edit-tools button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.edit-tools button.ok {
  color: var(--ok);
  border-color: var(--ok);
}
.edit-tools .chg {
  font-size: 12px;
  color: var(--accent);
}
.edit-tools .chg.muted {
  color: var(--muted);
}
.edit-tools .hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
}
.grid-scroll {
  flex: 1;
  overflow: auto;
}
table {
  border-collapse: collapse;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}
th,
td {
  border: 1px solid var(--border);
  padding: 4px 10px;
  text-align: left;
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
td.editing {
  padding: 0;
}
thead th {
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
.th-type {
  color: var(--muted);
  font-weight: 400;
  margin-left: 6px;
  font-size: 11px;
}
.rownum {
  color: var(--muted);
  background: var(--panel);
  text-align: right;
  user-select: none;
}
.nullcell {
  color: var(--muted);
  font-style: italic;
}
.modified {
  background: rgba(124, 108, 255, 0.18);
}
tbody tr.selected td {
  background: rgba(124, 108, 255, 0.22);
}
tbody tr.selected td.rownum {
  background: rgba(124, 108, 255, 0.3);
}
tr.deleted td {
  text-decoration: line-through;
  opacity: 0.5;
}
tr.newrow td {
  background: rgba(76, 175, 80, 0.1);
}
td input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border: none;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
  padding: 4px 10px;
}
.statusbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--border);
  background: var(--panel);
  font-size: 12px;
  color: var(--muted);
  flex: none;
  overflow-x: auto;
  white-space: nowrap;
}
.statusbar > * {
  flex: 0 0 auto;
}
.statusbar button {
  padding: 3px 10px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.statusbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.statusbar .pgsize {
  width: auto;
  padding: 3px 24px 3px 8px;
  font-size: 12px;
}
.statusbar .jump {
  width: 60px;
  padding: 3px 6px;
  font-size: 12px;
}
.statusbar .sep {
  width: 1px;
  height: 16px;
  background: var(--border);
}
.pg-info {
  color: var(--text);
}
.statusbar .meta {
  margin-left: auto;
  color: var(--muted);
}
.statusbar .meta .trunc {
  color: #e0a020;
}
</style>
