<script setup lang="ts">
import {
  type ConnectionConfig,
  MetaNodeKind,
  type QueryHistoryEntry,
  type QueryResult,
} from '@db-tool/shared-types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isConnectionError } from '../connError'
import { type EditChanges, buildEditDml, parseEditableTable } from '../editable'
import { type Suggestion } from '../monaco-setup'
import { splitStatements } from '../sqlSplit'
import HistoryPanel from './HistoryPanel.vue'
import ResultGrid from './ResultGrid.vue'
import SqlEditor from './SqlEditor.vue'

const PAGINATABLE = ['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlserver']
function isSelect(s: string): boolean {
  return /^\s*(select|with)\b/i.test(s)
}

interface ResultTab {
  id: number
  sql: string
  result: QueryResult | null
  error: string | null
  pageable: boolean
  page: number
  pageSize: number
  loading: boolean
  /** 可编辑时的目标表引用（简单单表 SELECT *），否则 null */
  editTable: string | null
}

const props = defineProps<{
  conn: ConnectionConfig
  /** 外部（双击表）注入的待执行 SQL；seq 变化即触发一次执行 */
  pending: { sql: string; seq: number } | null
}>()

const emit = defineEmits<{ connError: [string, string] }>()

const sql = ref('SELECT 1;')
const tabs = ref<ResultTab[]>([])
const activeTab = ref(0)
const showHistory = ref(false)
const history = ref<QueryHistoryEntry[]>([])
const running = ref(false)
const pageSize = ref(200) // 新查询的默认每页行数
let tabSeq = 0
let runToken = 0 // 软取消令牌：停止后丢弃在途结果

const cur = computed<ResultTab | undefined>(() => tabs.value[activeTab.value])
const paginatable = PAGINATABLE.includes(props.conn.dialect)

// ── 编辑器 / 结果区 高度可拖拽 ──
const paneEl = ref<HTMLElement>()
const editorHeight = ref(240)
let dragStartY = 0
let dragStartH = 0

function onSplitDown(e: PointerEvent): void {
  dragStartY = e.clientY
  dragStartH = editorHeight.value
  window.addEventListener('pointermove', onSplitMove)
  window.addEventListener('pointerup', onSplitUp)
  e.preventDefault()
}
function onSplitMove(e: PointerEvent): void {
  const paneH = paneEl.value?.clientHeight ?? 600
  const next = dragStartH + (e.clientY - dragStartY)
  editorHeight.value = Math.max(100, Math.min(next, paneH - 160))
}
function onSplitUp(): void {
  window.removeEventListener('pointermove', onSplitMove)
  window.removeEventListener('pointerup', onSplitUp)
}
onBeforeUnmount(onSplitUp)

// ── 执行上下文：database / schema 切换器（按方言自适应）──
const topKind = ref<'database' | 'schema' | null>(null)
const dbOptions = ref<string[]>([])
const schemaOptions = ref<string[]>([])
const selectedDb = ref('')
const selectedSchema = ref('')

async function loadContext(): Promise<void> {
  try {
    const top = await window.api.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Connection,
      path: [],
    })
    if (!top.length) return
    if (top[0].kind === MetaNodeKind.Schema) {
      // Oracle / 达梦：顶层即 schema
      topKind.value = 'schema'
      schemaOptions.value = top.map((n) => n.name)
    } else {
      topKind.value = 'database'
      dbOptions.value = top.map((n) => n.name)
    }
  } catch {
    // 连接不可达等：保持空，查询用默认上下文
  }
}

async function onDbChange(): Promise<void> {
  selectedSchema.value = ''
  schemaOptions.value = []
  if (!selectedDb.value) return
  try {
    const sub = await window.api.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Database,
      path: [selectedDb.value],
    })
    // 有 schema 子层（PG / SQLServer）才填充 schema 下拉
    if (sub[0]?.kind === MetaNodeKind.Schema) schemaOptions.value = sub.map((n) => n.name)
  } catch {
    /* ignore */
  }
}

function execOptions(): { database?: string; schema?: string } {
  return {
    database: topKind.value === 'database' ? selectedDb.value || undefined : undefined,
    schema: selectedSchema.value || undefined,
  }
}

// ── SQL 自动补全（关键字 + 表名 + FROM/JOIN 引用表的列）──
const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'JOIN', 'LEFT JOIN',
  'INNER JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'HAVING', 'AS', 'ON', 'AND', 'OR',
  'NOT', 'NULL', 'IS NULL', 'IN', 'LIKE', 'BETWEEN', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN',
  'MAX', 'VALUES', 'SET', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CASE', 'WHEN', 'THEN', 'END',
]
const MYSQL_FAM = ['mysql', 'mariadb', 'oceanbase']
const PG_FAM = ['postgresql', 'kingbase']
const ORA_FAM = ['oracle', 'dm']

let tableList: string[] | null = null
const colCache = new Map<string, string[]>()
watch([selectedDb, selectedSchema], () => {
  tableList = null
  colCache.clear()
})

/** 当前上下文下「表所在容器」的路径（db / db.schema / schema），用于拼元数据 scope。 */
function containerPath(): string[] | null {
  const d = props.conn.dialect
  if (MYSQL_FAM.includes(d)) {
    const db = selectedDb.value || props.conn.database
    return db ? [db] : null
  }
  if (PG_FAM.includes(d)) {
    return [props.conn.database || 'postgres', selectedSchema.value || 'public']
  }
  if (ORA_FAM.includes(d)) {
    const s = selectedSchema.value || props.conn.user
    return s ? [s] : null
  }
  if (d === 'sqlserver') {
    const db = selectedDb.value || props.conn.database
    return db ? [db, selectedSchema.value || 'dbo'] : null
  }
  return null
}

async function loadTables(): Promise<string[]> {
  if (tableList) return tableList
  const path = containerPath()
  if (!path) {
    tableList = []
    return tableList
  }
  try {
    const nodes = await window.api.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Group,
      path,
      group: 'tables',
    })
    tableList = nodes.map((n) => n.name)
  } catch {
    tableList = []
  }
  return tableList
}

async function loadColumns(table: string): Promise<string[]> {
  const cached = colCache.get(table)
  if (cached) return cached
  const path = containerPath()
  if (!path) return []
  try {
    const nodes = await window.api.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Group,
      path: [...path, table],
      group: 'columns',
    })
    const cols = nodes.map((n) => n.name)
    colCache.set(table, cols)
    return cols
  } catch {
    colCache.set(table, [])
    return []
  }
}

function parseFromTables(text: string): string[] {
  const re = /\b(?:from|join)\s+([`"[]?[\w$.]+[`"\]]?)/gi
  const out = new Set<string>()
  let m: RegExpExecArray | null = re.exec(text)
  while (m) {
    const parts = m[1].replace(/[`"[\]]/g, '').split('.')
    const t = parts[parts.length - 1]
    if (t) out.add(t)
    m = re.exec(text)
  }
  return [...out]
}

async function completion(ctx: { text: string; word: string }): Promise<Suggestion[]> {
  const out: Suggestion[] = KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const }))
  for (const t of await loadTables()) out.push({ label: t, kind: 'table', detail: '表' })
  for (const t of parseFromTables(ctx.text)) {
    for (const c of await loadColumns(t)) out.push({ label: c, kind: 'column', detail: t })
  }
  return out
}

async function loadHistory(): Promise<void> {
  history.value = await window.api.connections.history(props.conn.id)
}

async function run(): Promise<void> {
  const statements = splitStatements(sql.value)
  if (!statements.length) return
  const token = ++runToken
  running.value = true
  showHistory.value = false
  const next: ResultTab[] = []
  try {
    for (const stmt of statements) {
      const pageable = paginatable && isSelect(stmt)
      const editTable =
        paginatable && isSelect(stmt) ? parseEditableTable(stmt) : null
      const tab: ResultTab = {
        id: ++tabSeq,
        sql: stmt,
        result: null,
        error: null,
        pageable,
        page: 0,
        pageSize: pageSize.value,
        loading: false,
        editTable,
      }
      try {
        const opts = pageable
          ? { ...execOptions(), limit: tab.pageSize, offset: 0 }
          : execOptions()
        tab.result = await window.api.connections.execute(props.conn.id, stmt, [], opts)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        tab.error = msg
        if (isConnectionError(msg)) emit('connError', props.conn.id, msg)
      }
      if (token !== runToken) return // 已被停止，丢弃结果
      next.push(tab)
    }
    tabs.value = next
    activeTab.value = 0
  } finally {
    if (token === runToken) {
      running.value = false
      await loadHistory()
    }
  }
}

/** 取消：服务端取消正在执行的查询（MySQL KILL QUERY / PG pg_cancel_backend）+ 渲染端放弃在途结果。 */
function cancel(): void {
  void window.api.connections.cancel(props.conn.id)
  runToken++
  running.value = false
}

function clearEditor(): void {
  sql.value = ''
}

// ── 分页 ──
async function gotoPage(tab: ResultTab | undefined, page: number): Promise<void> {
  if (!tab || !tab.pageable || page < 0 || tab.loading) return
  tab.loading = true
  try {
    tab.result = await window.api.connections.execute(props.conn.id, tab.sql, [], {
      ...execOptions(),
      limit: tab.pageSize,
      offset: page * tab.pageSize,
    })
    tab.page = page
    tab.error = null
  } catch (e) {
    tab.error = e instanceof Error ? e.message : String(e)
  } finally {
    tab.loading = false
  }
}

function changePageSize(tab: ResultTab | undefined, size: number): void {
  if (!tab) return
  tab.pageSize = size
  pageSize.value = size
  void gotoPage(tab, 0)
}

// 提交编辑（事务批执行 → 刷新当前页）
async function onCommit(changes: EditChanges): Promise<void> {
  const tab = cur.value
  if (!tab || !tab.editTable || !tab.result) return
  const columns = tab.result.columns.map((c) => c.name)
  const stmts = buildEditDml(props.conn.dialect, tab.editTable, columns, changes)
  if (!stmts.length) return
  try {
    await window.api.connections.executeBatch(props.conn.id, stmts, execOptions())
    await gotoPage(tab, tab.page) // 刷新当前页（结果变更会重置网格编辑态）
    await loadHistory()
  } catch (e) {
    window.alert(`提交失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function openHistory(): Promise<void> {
  await loadHistory()
  showHistory.value = true
}

function onPickHistory(picked: string): void {
  sql.value = picked
  showHistory.value = false
}

async function onClearHistory(): Promise<void> {
  await window.api.connections.historyClear(props.conn.id)
  await loadHistory()
}

function selectTab(i: number): void {
  showHistory.value = false
  activeTab.value = i
}

watch(
  () => props.pending?.seq,
  () => {
    if (props.pending) {
      sql.value = props.pending.sql
      void run()
    }
  },
)

onMounted(() => {
  void loadHistory()
  void loadContext()
  if (props.pending) {
    sql.value = props.pending.sql
    void run()
  }
})
</script>

<template>
  <div ref="paneEl" class="pane">
    <div class="toolbar">
      <button class="primary" :disabled="running" @click="run">▶ 执行</button>
      <button :disabled="!running" @click="cancel">■ 停止</button>
      <button class="ghost" @click="clearEditor">清空</button>

      <select v-if="topKind === 'database'" v-model="selectedDb" class="ctx" @change="onDbChange">
        <option value="">（默认库）</option>
        <option v-for="d in dbOptions" :key="d" :value="d">{{ d }}</option>
      </select>
      <select
        v-if="schemaOptions.length || topKind === 'schema'"
        v-model="selectedSchema"
        class="ctx"
      >
        <option value="">（默认 schema）</option>
        <option v-for="s in schemaOptions" :key="s" :value="s">{{ s }}</option>
      </select>

      <span class="hint">⌘/Ctrl+Enter 执行</span>
      <span class="conn-tag">{{ conn.name || '(未命名)' }} · {{ conn.dialect }}</span>
    </div>

    <div class="editor" :style="{ height: editorHeight + 'px' }">
      <SqlEditor v-model="sql" :completion="completion" @run="run" />
    </div>

    <div class="splitter" title="拖拽调整高度" @pointerdown="onSplitDown"></div>

    <div class="result-tabs">
      <button
        v-for="(t, i) in tabs"
        :key="t.id"
        class="rtab"
        :class="{ active: !showHistory && activeTab === i }"
        @click="selectTab(i)"
      >
        结果 {{ i + 1 }}<span v-if="t.error" class="err-dot">!</span>
      </button>
      <button class="rtab" :class="{ active: showHistory }" @click="openHistory">历史</button>
    </div>

    <div class="result">
      <HistoryPanel
        v-if="showHistory"
        :entries="history"
        @pick="onPickHistory"
        @clear="onClearHistory"
      />
      <ResultGrid
        v-else
        :result="cur?.result ?? null"
        :error="cur?.error ?? null"
        :running="running || (cur?.loading ?? false)"
        :pageable="cur?.pageable ?? false"
        :page="cur?.page ?? 0"
        :page-size="cur?.pageSize ?? 200"
        :has-more="(cur?.result?.rowCount ?? 0) === (cur?.pageSize ?? 200)"
        :editable="!!cur?.editTable"
        :dialect="conn.dialect"
        @change-page="(p) => gotoPage(cur, p)"
        @change-page-size="(s) => changePageSize(cur, s)"
        @commit="onCommit"
      />
    </div>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.toolbar .hint {
  font-size: 11px;
  color: var(--muted);
}
.toolbar .conn-tag {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.toolbar button {
  padding: 4px 12px;
  font-size: 13px;
}
.toolbar .ctx {
  width: auto;
  padding: 4px 24px 4px 8px;
  font-size: 12px;
  max-width: 180px;
  background-color: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.editor {
  flex: none;
  min-height: 100px;
}
.splitter {
  flex: none;
  height: 6px;
  cursor: row-resize;
  background: var(--border);
  transition: background 0.15s;
}
.splitter:hover {
  background: var(--accent);
}
.result-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.rtab {
  background: transparent;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: var(--muted);
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.rtab.active {
  background: var(--bg);
  color: var(--text);
}
.err-dot {
  color: var(--err);
  font-weight: 700;
  margin-left: 4px;
}
.result {
  flex: 1;
  min-height: 0;
}
</style>
