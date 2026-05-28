<script setup lang="ts">
import type { DbDialect, QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { t } from '../i18n'
import type { EditChanges } from '../editable'
import { type ExportFormat, exportRows, toCSV, toJSON } from '../io'
import Modal from './Modal.vue'

const client = useDataClient()

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
  /** 用于 SQL 导出时的标识符引用 */
  dialect?: DbDialect
  /** 可服务端筛选（浏览单表时）：列头出现漏斗，生成 WHERE 重查 */
  filterable?: boolean
}>()
const emit = defineEmits<{
  changePage: [number]
  changePageSize: [number]
  commit: [EditChanges]
  filter: [string]
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

// ── 客户端排序（仅只读浏览时；编辑态依赖行索引对齐，故禁用）──
const sortCol = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')
// ── 单元格 / 行 查看器 ──（col 为 null = 看整行）
const viewer = ref<{ row: number; col: string | null } | null>(null)
// ── 筛选 / 列显隐 / 复制（均只读态）──
const filterText = ref('')
const hiddenCols = ref<Set<string>>(new Set())
const showColsMenu = ref(false)
const showCopyMenu = ref(false)
const viewMode = ref<'grid' | 'json'>('grid') // 只读态：网格 / JSON 视图
const freezeFirst = ref(false) // 冻结首数据列
const showSummary = ref(false) // 汇总行
// 列宽（px，按列名）
const colWidths = ref<Record<string, number>>({})
// 服务端列筛选：列名 → 条件串（如 "= 5"）
const colFilters = ref<Record<string, string>>({})

function startResize(col: string, e: MouseEvent): void {
  const th = (e.target as HTMLElement).closest('th') as HTMLElement | null
  const startX = e.clientX
  const startW = th?.offsetWidth ?? 120
  const onMove = (ev: MouseEvent): void => {
    colWidths.value = { ...colWidths.value, [col]: Math.max(48, startW + (ev.clientX - startX)) }
  }
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const columnNames = computed(() => props.result?.columns.map((c) => c.name) ?? [])
// 列顺序（按列名；拖拽列头可重排）；结果变更时重置
const colOrder = ref<string[]>([])
const dragCol = ref<string | null>(null)
/** 渲染用的可见列（应用自定义顺序 + 剔除隐藏列）；整行查看器仍展示全部列。 */
const visibleColumns = computed(() => {
  const cols = props.result?.columns ?? []
  const byName = new Map(cols.map((c) => [c.name, c]))
  const ordered = colOrder.value.map((n) => byName.get(n)).filter((c): c is (typeof cols)[number] => !!c)
  for (const c of cols) if (!colOrder.value.includes(c.name)) ordered.push(c)
  return ordered.filter((c) => !hiddenCols.value.has(c.name))
})
function onColDrop(target: string): void {
  const from = dragCol.value
  dragCol.value = null
  if (!from || from === target) return
  const order = colOrder.value.length ? [...colOrder.value] : columnNames.value.slice()
  const fi = order.indexOf(from)
  const ti = order.indexOf(target)
  if (fi < 0 || ti < 0) return
  order.splice(fi, 1)
  order.splice(ti, 0, from)
  colOrder.value = order
}

function toggleCol(name: string): void {
  const s = new Set(hiddenCols.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  hiddenCols.value = s
}

/** 复制选中行（无选中则全部当前视图行）为 CSV / JSON。 */
function copyRows(format: 'csv' | 'json'): void {
  showCopyMenu.value = false
  const cols = columnNames.value
  const idx = [...selected.value].filter((k) => k[0] === 'r').map((k) => Number(k.slice(1)))
  const rows = (idx.length ? idx.sort((a, b) => a - b).map((i) => viewRows.value[i]) : viewRows.value).filter(
    Boolean,
  ) as Row[]
  copyText(format === 'csv' ? toCSV(cols, rows) : toJSON(rows))
}

/** 实际渲染的行：编辑态用 localRows（保持索引对齐）；只读态可按列排序。 */
const viewRows = computed<Row[]>(() => {
  const base = (props.editable ? localRows.value : (props.result?.rows ?? [])) as Row[]
  if (props.editable) return base // 编辑态不筛选/排序，保持行索引对齐
  let rows = base
  const f = filterText.value.trim().toLowerCase()
  if (f) rows = rows.filter((r) => columnNames.value.some((c) => fmt(r[c]).toLowerCase().includes(f)))
  if (sortCol.value) {
    const col = sortCol.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => cmp(a[col], b[col]) * dir)
  }
  return rows
})

// ── 大结果集虚拟滚动：超过阈值只渲染可视窗口 + 上下占位，保留真实行索引 ──
const VIRT_THRESHOLD = 150
const gridScrollEl = ref<HTMLElement>()
const scrollTop = ref(0)
const viewportH = ref(480)
const rowH = ref(27) // 实测行高（保证占位高度与渲染行一致，避免滚动错位）

const virtual = computed(() => viewRows.value.length > VIRT_THRESHOLD)
const winStart = computed(() =>
  virtual.value ? Math.max(0, Math.floor(scrollTop.value / rowH.value) - 8) : 0,
)
const winEnd = computed(() => {
  if (!virtual.value) return viewRows.value.length
  const visible = Math.ceil(viewportH.value / rowH.value) + 16
  return Math.min(viewRows.value.length, winStart.value + visible)
})
const windowRows = computed(() => {
  const out: { row: Row; i: number }[] = []
  for (let i = winStart.value; i < winEnd.value; i++) out.push({ row: viewRows.value[i], i })
  return out
})
const padTop = computed(() => winStart.value * rowH.value)
const padBottom = computed(() => Math.max(0, (viewRows.value.length - winEnd.value) * rowH.value))

let rafPending = false
function onGridScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    scrollTop.value = el.scrollTop
    viewportH.value = el.clientHeight
    rafPending = false
  })
}
// 实测一行高度（首个数据行），用于精确占位
function measureRowH(): void {
  const row = gridScrollEl.value?.querySelector('tr[data-row]') as HTMLElement | null
  if (row?.offsetHeight) rowH.value = row.offsetHeight
  viewportH.value = gridScrollEl.value?.clientHeight ?? viewportH.value
}
watch(
  () => [props.result, viewRows.value.length],
  () => {
    scrollTop.value = 0
    if (gridScrollEl.value) gridScrollEl.value.scrollTop = 0
    void Promise.resolve().then(measureRowH)
  },
  { flush: 'post' },
)

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function toggleSort(col: string): void {
  if (props.editable) return // 编辑态不排序
  if (sortCol.value !== col) {
    sortCol.value = col
    sortDir.value = 'asc'
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
  } else {
    sortCol.value = null
  }
}

// ── 导出 ──
const showExport = ref(false)
// 导出菜单用 fixed 定位（锚定按钮上方），避免被 .statusbar 的 overflow 裁掉
const exportMenuPos = ref<{ right: number; bottom: number } | null>(null)
function toggleExport(e: MouseEvent): void {
  if (showExport.value) {
    showExport.value = false
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  exportMenuPos.value = {
    right: Math.round(window.innerWidth - r.right),
    bottom: Math.round(window.innerHeight - r.top + 4),
  }
  showExport.value = true
}
async function doExport(format: ExportFormat): Promise<void> {
  showExport.value = false
  const cols = columnNames.value
  if (!cols.length) return
  const rows = ((props.editable ? localRows.value : props.result?.rows) ?? []) as Row[]
  let tableRef = 'table_name'
  if (format === 'sql') {
    const n = window.prompt(t('grid.exportPrompt'), 'table_name')
    if (!n || !n.trim()) return
    tableRef = props.dialect != null ? quoteId(props.dialect, n.trim()) : n.trim()
  }
  const content = exportRows(format, cols, rows, { dialect: props.dialect, tableRef })
  const ext = format
  await client.files.saveText({
    defaultName: `export.${ext}`,
    content,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  })
}

function resetEdits(): void {
  const rows = props.result?.rows ?? []
  localRows.value = JSON.parse(JSON.stringify(rows)) as Row[]
  original.value = JSON.parse(JSON.stringify(rows)) as Row[]
  deleted.value = rows.map(() => false)
  inserts.value = []
  editing.value = null
  selected.value = new Set()
  lastClick.value = null
  sortCol.value = null
  viewer.value = null
  filterText.value = ''
  hiddenCols.value = new Set()
  showColsMenu.value = false
  showCopyMenu.value = false
  colWidths.value = {}
  colOrder.value = (props.result?.columns ?? []).map((c) => c.name)
  colFilters.value = {}
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
  for (const k of insIdx.sort((a, b) => b - a)) inserts.value.splice(k, 1)
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

// ── 查看器 ──
// 只读态双击单元格 → 看单元格；编辑态双击 → 进入编辑
function onCellDblClick(area: 'r' | 'n', index: number, col: string): void {
  if (props.editable) startEdit(area, index, col)
  else viewer.value = { row: index, col }
}
function openRow(index: number): void {
  viewer.value = { row: index, col: null }
}
function moveViewer(delta: number): void {
  if (!viewer.value) return
  const n = viewer.value.row + delta
  if (n >= 0 && n < viewRows.value.length) viewer.value = { ...viewer.value, row: n }
}
/** 大文本/JSON 美化显示。 */
function pretty(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  const s = String(v)
  if (/^\s*[[{]/.test(s)) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      /* 非 JSON，原样 */
    }
  }
  return s
}
const viewerRow = computed<Row | null>(() =>
  viewer.value ? (viewRows.value[viewer.value.row] ?? null) : null,
)
function copyText(text: string): void {
  void navigator.clipboard?.writeText(text)
}

// ── 服务端列筛选（生成 WHERE，由 QueryPane 重查）──
function filterCol(col: string): void {
  const cur = colFilters.value[col] ?? ''
  const input = window.prompt(
    t('grid.filterPrompt', { col }),
    cur,
  )
  if (input === null) return
  const next = { ...colFilters.value }
  if (input.trim()) next[col] = input.trim()
  else delete next[col]
  colFilters.value = next
  const q = (s: string) => (props.dialect != null ? quoteId(props.dialect, s) : `"${s}"`)
  emit(
    'filter',
    Object.entries(colFilters.value)
      .map(([c, cond]) => `${q(c)} ${cond}`)
      .join(' AND '),
  )
}

// ── 大文本/JSON 单元格编辑器 ──
const editBuf = ref('')
function openCellEditor(rowIndex: number, col: string): void {
  const v = localRows.value[rowIndex]?.[col]
  editBuf.value = v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
  viewer.value = { row: rowIndex, col }
}
function applyCellEdit(): void {
  if (!viewer.value?.col) return
  const r = localRows.value[viewer.value.row]
  if (r) r[viewer.value.col] = editBuf.value
  editing.value = null
  viewer.value = null
}
// 把当前查看的单元格设为 NULL（编辑态）
function setCellNull(): void {
  if (!viewer.value?.col) return
  const r = localRows.value[viewer.value.row]
  if (r) r[viewer.value.col] = null
  editing.value = null
  viewer.value = null
}
// 复制当前单元格值为 SQL 字面量
function copyCellAsSql(): void {
  if (!viewer.value?.col) return
  const v = viewerRow.value?.[viewer.value.col]
  copyText(sqlLiteral(v))
}
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}

// 汇总行：数值列给 Σ求和/ø均值，其余给非空计数
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const summaryRow = computed<Record<string, string>>(() => {
  if (!showSummary.value) return {}
  const out: Record<string, string> = {}
  for (const c of visibleColumns.value) {
    const vals = viewRows.value.map((r) => r[c.name]).filter((v) => v !== null && v !== undefined)
    const nums = vals.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    if (vals.length > 0 && nums.length === vals.length) {
      const sum = nums.reduce((a, b) => a + b, 0)
      out[c.name] = `Σ${fmtNum(sum)} ø${fmtNum(sum / nums.length)}`
    } else {
      out[c.name] = String(vals.length)
    }
  }
  return out
})
</script>

<template>
  <div class="grid-wrap">
    <div v-if="running" class="grid-msg">{{ t('grid.running') }}</div>
    <div v-else-if="error" class="grid-err">✗ {{ error }}</div>
    <div v-else-if="!result" class="grid-msg">{{ t('grid.empty') }}</div>
    <template v-else>
      <div v-if="editable && result.columns.length" class="edit-tools">
        <button :title="t('grid.addRow')" @click="addRow">＋</button>
        <button :title="t('grid.delRow')" :disabled="!selected.size" @click="deleteSelected">－</button>
        <button class="ok" :title="t('grid.commitTitle')" :disabled="!dirty" @click="commit">✓ {{ t('grid.commit') }}</button>
        <button :title="t('grid.revert')" :disabled="!dirty" @click="resetEdits">↺</button>
        <span v-if="dirty" class="chg">{{ t('grid.changes', { n: changeCount }) }}</span>
        <span v-if="selected.size" class="chg muted">{{ t('grid.selectedRows', { n: selected.size }) }}</span>
        <span class="hint">{{ t('grid.editHint') }}</span>
      </div>

      <div v-if="!editable && result.columns.length" class="view-tools">
        <input v-model="filterText" class="filter" :placeholder="t('grid.filterPh')" />
        <span v-if="selected.size" class="chg muted">{{ t('grid.selectedRows', { n: selected.size }) }}</span>
        <span class="grow" />
        <div class="menu-box">
          <button @click.stop="showCopyMenu = !showCopyMenu">{{ t('grid.copy') }}</button>
          <template v-if="showCopyMenu">
            <div class="exp-overlay" @click="showCopyMenu = false" />
            <div class="exp-menu" @click.stop>
              <button @click="copyRows('csv')">{{ selected.size ? t('grid.selRows') : t('grid.all') }} → CSV</button>
              <button @click="copyRows('json')">{{ selected.size ? t('grid.selRows') : t('grid.all') }} → JSON</button>
            </div>
          </template>
        </div>
        <div class="menu-box">
          <button @click.stop="showColsMenu = !showColsMenu">{{ t('grid.cols') }}</button>
          <template v-if="showColsMenu">
            <div class="exp-overlay" @click="showColsMenu = false" />
            <div class="exp-menu cols-menu" @click.stop>
              <label v-for="c in result.columns" :key="c.name" class="col-item">
                <input
                  type="checkbox"
                  :checked="!hiddenCols.has(c.name)"
                  @change="toggleCol(c.name)"
                />
                {{ c.name }}
              </label>
            </div>
          </template>
        </div>
        <button
          class="vm"
          :class="{ on: viewMode === 'json' }"
          :title="t('grid.viewJson')"
          @click="viewMode = viewMode === 'json' ? 'grid' : 'json'"
        >
          {{ viewMode === 'json' ? t('grid.viewGrid') : t('grid.viewJson') }}
        </button>
        <button class="vm" :class="{ on: freezeFirst }" :title="t('grid.freeze')" @click="freezeFirst = !freezeFirst">❄</button>
        <button class="vm" :class="{ on: showSummary }" :title="t('grid.summaryTitle')" @click="showSummary = !showSummary">Σ {{ t('grid.summary') }}</button>
        <span class="hint">{{ t('grid.sortHint') }}</span>
      </div>

      <pre v-if="viewMode === 'json' && !editable && result.columns.length" class="json-view">{{ JSON.stringify(viewRows, null, 2) }}</pre>

      <div v-else-if="result.columns.length" ref="gridScrollEl" class="grid-scroll" :class="{ 'freeze-1': freezeFirst }" @scroll="onGridScroll">
        <table>
          <thead>
            <tr>
              <th class="rownum">#</th>
              <th
                v-for="c in visibleColumns"
                :key="c.name"
                :class="{ sortable: !editable, dragging: dragCol === c.name }"
                :style="colWidths[c.name] ? { width: `${colWidths[c.name]}px` } : undefined"
                draggable="true"
                @click="toggleSort(c.name)"
                @dragstart="dragCol = c.name"
                @dragover.prevent
                @drop="onColDrop(c.name)"
                @dragend="dragCol = null"
              >
                {{ c.name }}<span class="th-type">{{ c.dataType }}</span>
                <span v-if="sortCol === c.name" class="sort-ind">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                <button
                  v-if="filterable"
                  class="funnel"
                  :class="{ on: colFilters[c.name] }"
                  :title="t('grid.filterColTitle')"
                  @click.stop="filterCol(c.name)"
                >
                  ⏷
                </button>
                <span
                  class="col-resize"
                  :title="t('grid.resizeColTitle')"
                  @mousedown.stop.prevent="startResize(c.name, $event)"
                  @click.stop
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="padTop" class="spacer"><td :colspan="visibleColumns.length + 1" :style="{ height: padTop + 'px' }" /></tr>
            <tr
              v-for="{ row, i } in windowRows"
              :key="'r' + i"
              data-row
              :class="{ selected: isSel('r', i), deleted: editable && deleted[i] }"
              @click="onRowClick('r', i, $event)"
            >
              <td class="rownum" :title="t('grid.viewRowTitle')" @click.stop="openRow(i)">{{ i + 1 }}</td>
              <td
                v-for="c in visibleColumns"
                :key="c.name"
                :class="{
                  nullcell: isNull(row[c.name]),
                  modified: isModified(i, c.name),
                  editing: isEditing('r', i, c.name),
                }"
                @dblclick="onCellDblClick('r', i, c.name)"
              >
                <span v-if="editable && isEditing('r', i, c.name)" class="edit-cell">
                  <input
                    v-model="localRows[i][c.name]"
                    autofocus
                    @blur="editing = null"
                    @keyup.enter="editing = null"
                    @click.stop
                  />
                  <button
                    class="expand"
                    :title="t('grid.cellEditorTitle')"
                    @mousedown.prevent.stop="openCellEditor(i, c.name)"
                  >
                    ⤢
                  </button>
                </span>
                <template v-else>{{ fmt(row[c.name]) }}</template>
              </td>
            </tr>
            <tr v-if="padBottom" class="spacer"><td :colspan="visibleColumns.length + 1" :style="{ height: padBottom + 'px' }" /></tr>
            <tr
              v-for="(row, k) in inserts"
              :key="'n' + k"
              class="newrow"
              :class="{ selected: isSel('n', k) }"
              @click="onRowClick('n', k, $event)"
            >
              <td class="rownum">+</td>
              <td
                v-for="c in visibleColumns"
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
          <tfoot v-if="showSummary">
            <tr class="summary">
              <td class="rownum">Σ</td>
              <td v-for="c in visibleColumns" :key="c.name">{{ summaryRow[c.name] }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-else class="grid-msg">{{ t('grid.execOk') }}</div>

      <div class="statusbar">
        <template v-if="pageable && result.columns.length">
          <button :disabled="(page ?? 0) <= 0" @click="emit('changePage', (page ?? 0) - 1)">{{ t('grid.prevPage') }}</button>
          <span class="pg-info">{{ t('grid.pageInfo', { n: (page ?? 0) + 1 }) }}</span>
          <button :disabled="!hasMore" @click="emit('changePage', (page ?? 0) + 1)">{{ t('grid.nextPage') }}</button>
          <span class="sep" />
          <label>{{ t('grid.perPage') }}</label>
          <select
            class="pgsize"
            :value="pageSize"
            @change="emit('changePageSize', Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
          </select>
          <span class="sep" />
          <label>{{ t('grid.jumpTo') }}</label>
          <input v-model="jumpTo" class="jump" type="number" min="1" @keyup.enter="doJump" />
          <button @click="doJump">{{ t('grid.jump') }}</button>
        </template>

        <span class="meta">
          <template v-if="result.columns.length">{{ t('grid.rowCount', { n: result.rowCount }) }}</template>
          <template v-else>{{ t('grid.affected', { n: result.affectedRows ?? 0 }) }}</template>
          · {{ result.executionTimeMs }} ms
          <span v-if="result.truncated" class="trunc">{{ t('grid.truncated') }}</span>
        </span>

        <div v-if="result.columns.length" class="export-box">
          <button class="exp-btn" :title="t('grid.exportTitle')" @click.stop="toggleExport">{{ t('grid.export') }}</button>
          <template v-if="showExport">
            <div class="exp-overlay" @click="showExport = false" />
            <div
              class="exp-menu fixed"
              :style="
                exportMenuPos
                  ? { right: exportMenuPos.right + 'px', bottom: exportMenuPos.bottom + 'px' }
                  : undefined
              "
              @click.stop
            >
              <button @click="doExport('csv')">CSV</button>
              <button @click="doExport('json')">JSON</button>
              <button @click="doExport('sql')">SQL INSERT</button>
            </div>
          </template>
        </div>
      </div>

      <Modal
        v-if="viewer"
        :title="viewer.col ? t('grid.cellTitle', { col: viewer.col }) : t('grid.rowTitle', { n: viewer.row + 1 })"
        @close="viewer = null"
      >
        <template v-if="viewer.col">
          <textarea v-if="editable" v-model="editBuf" class="cell-edit" spellcheck="false" />
          <pre v-else class="cell-view">{{ pretty(viewerRow?.[viewer.col]) }}</pre>
          <div class="viewer-actions">
            <button v-if="editable" class="primary" @click="applyCellEdit">{{ t('grid.apply') }}</button>
            <button v-if="editable" @click="setCellNull">{{ t('grid.setNull') }}</button>
            <button @click="copyText(editable ? editBuf : pretty(viewerRow?.[viewer.col]))">{{ t('common.copy') }}</button>
            <button @click="copyCellAsSql">{{ t('grid.copyAsSql') }}</button>
          </div>
        </template>
        <template v-else-if="viewerRow">
          <table class="row-detail">
            <tbody>
              <tr v-for="c in result.columns" :key="c.name">
                <th>{{ c.name }}</th>
                <td :class="{ nullcell: isNull(viewerRow[c.name]) }">{{ fmt(viewerRow[c.name]) }}</td>
              </tr>
            </tbody>
          </table>
          <div class="viewer-actions">
            <button :disabled="viewer.row <= 0" @click="moveViewer(-1)">{{ t('grid.prevRow') }}</button>
            <button :disabled="viewer.row >= viewRows.length - 1" @click="moveViewer(1)">{{ t('grid.nextRow') }}</button>
            <button @click="copyText(JSON.stringify(viewerRow, null, 2))">{{ t('grid.copyJson') }}</button>
          </div>
        </template>
      </Modal>
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
/* 冻结首列：行号列吸附左侧不随横向滚动 */
.grid-scroll.freeze-1 td.rownum,
.grid-scroll.freeze-1 th.rownum {
  position: sticky;
  left: 0;
  z-index: 2;
}
.json-view {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre;
}
.view-tools .vm {
  font-size: 11px;
  padding: 2px 8px;
}
.view-tools .vm.on {
  background: var(--accent, #7c6cff);
  color: #fff;
}
tfoot tr.summary td {
  position: sticky;
  bottom: 0;
  background: var(--panel);
  border-top: 2px solid var(--border);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
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
tr.spacer td {
  padding: 0;
  border: none;
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
.export-box {
  position: relative;
}
.exp-overlay {
  position: fixed;
  inset: 0;
  z-index: 10;
}
.exp-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  z-index: 20;
}
/* 导出菜单：脱离 statusbar 的 overflow 裁剪，定位到视口（坐标由 JS 锚定按钮上方） */
.exp-menu.fixed {
  position: fixed;
  bottom: auto;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 130px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.exp-menu button {
  border: none;
  border-radius: 0;
  text-align: left;
  padding: 7px 12px;
}
.exp-menu button:hover {
  background: var(--accent);
  color: #fff;
}
th.sortable {
  cursor: pointer;
  user-select: none;
}
thead th.dragging {
  opacity: 0.4;
}
th.sortable:hover {
  color: var(--text);
}
.funnel {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}
.funnel.on {
  color: var(--accent);
}
.sort-ind {
  margin-left: 4px;
  font-size: 9px;
  color: var(--accent);
}
.col-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
}
.col-resize:hover {
  background: var(--accent);
  opacity: 0.5;
}
td.rownum {
  cursor: pointer;
}
td.rownum:hover {
  color: var(--accent);
}
.edit-cell {
  display: flex;
  align-items: center;
  width: 100%;
}
.edit-cell input {
  flex: 1;
  min-width: 0;
}
.edit-cell .expand {
  flex: none;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  padding: 0 3px;
}
.edit-cell .expand:hover {
  color: var(--accent);
}
.cell-edit {
  width: 100%;
  min-height: 40vh;
  max-height: 60vh;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  resize: vertical;
}
.cell-view {
  margin: 0;
  max-height: 50vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
.row-detail {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.row-detail th {
  text-align: right;
  color: var(--muted);
  font-weight: 500;
  padding: 4px 10px;
  white-space: nowrap;
  vertical-align: top;
  width: 1%;
  border-bottom: 1px solid var(--border);
}
.row-detail td {
  padding: 4px 10px;
  word-break: break-word;
  border-bottom: 1px solid var(--border);
}
.row-detail td.nullcell {
  color: var(--muted);
  font-style: italic;
}
.viewer-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  justify-content: flex-end;
}
.viewer-actions button {
  padding: 5px 14px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.viewer-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.view-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  font-size: 12px;
  flex-wrap: wrap;
}
.view-tools .filter {
  width: 200px;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.view-tools .grow {
  flex: 1;
}
.view-tools .hint {
  color: var(--muted);
  flex-basis: 100%;
}
.menu-box {
  position: relative;
}
.menu-box .exp-menu {
  top: calc(100% + 4px);
  bottom: auto;
}
.menu-box > button {
  padding: 4px 10px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
}
.cols-menu {
  max-height: 260px;
  overflow-y: auto;
  padding: 4px 0;
}
.col-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}
.col-item:hover {
  background: var(--bg);
}
</style>
