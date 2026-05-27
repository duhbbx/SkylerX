<script setup lang="ts">
import {
  type ConnectionConfig,
  MetaNodeKind,
  type QueryHistoryEntry,
  type QueryResult,
} from '@db-tool/shared-types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { isConnectionError } from '../connError'
import { type TableContext, explainSql } from '../ddl'
import { type EditChanges, buildEditDml, parseEditableTable } from '../editable'
import { type Suggestion } from '../monaco-setup'
import { settings } from '../settings'
import { addSnippet, snippets } from '../snippets'
import { splitStatements } from '../sqlSplit'
import { type SqlLanguage, format as sqlFormat } from 'sql-formatter'
import { type PlanNode, parsePgPlan, planQuery } from '../plan'
import HistoryPanel from './HistoryPanel.vue'
import Modal from './Modal.vue'
import PlanPanel from './PlanPanel.vue'
import ResultGrid from './ResultGrid.vue'
import SnippetsPanel from './SnippetsPanel.vue'
import SqlEditor from './SqlEditor.vue'

const client = useDataClient()

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
  /** 初始草稿 SQL（只填入编辑器、不执行；如「查看定义」） */
  initialSql?: string
  /** 初始库/schema 上下文（新建查询时按触发节点预选；找不到则用默认库） */
  initialCtx?: TableContext
}>()

const emit = defineEmits<{ connError: [string, string] }>()

const sql = ref('SELECT 1;')
const editorRef = ref<InstanceType<typeof SqlEditor> | null>(null)
const tabs = ref<ResultTab[]>([])
const activeTab = ref(0)
const showHistory = ref(false)
const showSnippets = ref(false)
const showPlan = ref(false)
const planData = ref<{ tree: PlanNode | null; text: string | null } | null>(null)
const history = ref<QueryHistoryEntry[]>([])
const running = ref(false)
const pageSize = ref(settings.pageSize) // 新查询的默认每页行数（取自设置）
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
    const top = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Connection,
      path: [],
    })
    if (!top.length) return
    if (top[0].kind === MetaNodeKind.Schema) {
      // Oracle / 达梦：顶层即 schema
      topKind.value = 'schema'
      schemaOptions.value = top.map((n) => n.name)
      // 预选触发节点的 schema（命中才选，否则留默认）
      const s = props.initialCtx?.schema
      if (s && schemaOptions.value.includes(s)) selectedSchema.value = s
    } else {
      topKind.value = 'database'
      dbOptions.value = top.map((n) => n.name)
      // 预选触发节点的库；命中则进一步加载并预选其 schema
      const db = props.initialCtx?.database
      if (db && dbOptions.value.includes(db)) {
        selectedDb.value = db
        await loadSchemaOptions(db)
        const s = props.initialCtx?.schema
        if (s && schemaOptions.value.includes(s)) selectedSchema.value = s
      }
    }
  } catch {
    // 连接不可达等：保持空，查询用默认上下文
  }
}

/** 加载某库下的 schema 下拉（PG / SQLServer 才有 schema 子层）。 */
async function loadSchemaOptions(db: string): Promise<void> {
  schemaOptions.value = []
  if (!db) return
  try {
    const sub = await client.connections.metadata(props.conn.id, {
      parentKind: MetaNodeKind.Database,
      path: [db],
    })
    if (sub[0]?.kind === MetaNodeKind.Schema) schemaOptions.value = sub.map((n) => n.name)
  } catch {
    /* ignore */
  }
}

async function onDbChange(): Promise<void> {
  selectedSchema.value = ''
  await loadSchemaOptions(selectedDb.value)
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
  'INNER JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET',
  'HAVING', 'AS', 'ON', 'USING', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'EXISTS',
  'LIKE', 'BETWEEN', 'DISTINCT', 'UNION', 'UNION ALL', 'ASC', 'DESC', 'VALUES', 'SET',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
]
const MYSQL_FAM = ['mysql', 'mariadb', 'oceanbase']
const PG_FAM = ['postgresql', 'kingbase']
const ORA_FAM = ['oracle', 'dm']

const COMMON_FUNCS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST', 'UPPER', 'LOWER',
  'TRIM', 'LENGTH', 'SUBSTRING', 'REPLACE', 'ROUND', 'ABS',
]
const FAM_FUNCS: Record<string, string[]> = {
  mysql: ['CONCAT', 'IFNULL', 'IF', 'DATE_FORMAT', 'NOW', 'CURDATE', 'GROUP_CONCAT', 'UNIX_TIMESTAMP', 'JSON_EXTRACT'],
  pg: ['STRING_AGG', 'ARRAY_AGG', 'TO_CHAR', 'TO_DATE', 'NOW', 'DATE_TRUNC', 'GENERATE_SERIES', 'JSONB_BUILD_OBJECT'],
  oracle: ['NVL', 'NVL2', 'DECODE', 'TO_CHAR', 'TO_DATE', 'SYSDATE', 'SUBSTR', 'INSTR', 'LISTAGG'],
  sqlserver: ['ISNULL', 'GETDATE', 'CONVERT', 'DATEADD', 'DATEDIFF', 'LEN', 'CHARINDEX', 'STRING_AGG'],
}
function dialectFuncs(): string[] {
  const d = props.conn.dialect
  const fam = MYSQL_FAM.includes(d)
    ? 'mysql'
    : PG_FAM.includes(d)
      ? 'pg'
      : ORA_FAM.includes(d)
        ? 'oracle'
        : d === 'sqlserver'
          ? 'sqlserver'
          : ''
  return [...COMMON_FUNCS, ...(FAM_FUNCS[fam] ?? [])]
}

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
    const nodes = await client.connections.metadata(props.conn.id, {
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
    const nodes = await client.connections.metadata(props.conn.id, {
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

/** 把 from/join 里的「表 [as] 别名」解析成 别名/表名 → 表名。 */
function resolveAlias(text: string, alias: string): string | null {
  const re = /\b(?:from|join)\s+([`"[]?[\w$.]+[`"\]]?)(?:\s+as)?(?:\s+([a-z_]\w*))?/gi
  for (const m of text.matchAll(re)) {
    const tbl = m[1].replace(/[`"[\]]/g, '')
    const tname = tbl.split('.').pop() ?? tbl
    if (m[2] === alias || tname === alias) return tname
  }
  return null
}

async function completion(ctx: {
  text: string
  word: string
  before: string
}): Promise<Suggestion[]> {
  // 限定列：「别名. / 表名.」→ 只补该表的列
  const dot = /([\w$]+)\s*\.\s*\w*$/.exec(ctx.before)
  if (dot) {
    const table = resolveAlias(ctx.text, dot[1]) ?? dot[1]
    return (await loadColumns(table)).map((c) => ({ label: c, kind: 'column' as const, detail: table }))
  }
  const out: Suggestion[] = KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const }))
  for (const fn of dialectFuncs()) out.push({ label: fn, insertText: `${fn}()`, kind: 'function', detail: '函数' })
  for (const s of snippets) out.push({ label: s.name, insertText: s.sql, kind: 'snippet', detail: '片段' })
  for (const t of await loadTables()) out.push({ label: t, kind: 'table', detail: '表' })
  for (const t of parseFromTables(ctx.text)) {
    for (const c of await loadColumns(t)) out.push({ label: c, kind: 'column', detail: t })
  }
  return out
}

async function loadHistory(): Promise<void> {
  history.value = await client.connections.history(props.conn.id)
}

/** 高危语句检测：DROP/TRUNCATE、以及无 WHERE 的 DELETE/UPDATE。返回提示文案。 */
function dangerOf(sql: string): string | null {
  const s = sql.trim()
  if (/^drop\s+(table|database|schema|view)/i.test(s)) return `DROP：${s.slice(0, 60)}`
  if (/^truncate\b/i.test(s)) return `TRUNCATE：${s.slice(0, 60)}`
  if (/^delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s)) return `DELETE 无 WHERE：${s.slice(0, 60)}`
  if (/^update\b/i.test(s) && !/\bwhere\b/i.test(s)) return `UPDATE 无 WHERE：${s.slice(0, 60)}`
  return null
}

// ── 查询参数化（:name 占位）──
const pendingParams = ref<{ names: string[]; values: Record<string, string>; source: string } | null>(
  null,
)
function paramNames(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<![:\w]):(\w+)/g)].map((m) => m[1]))]
}
function paramLiteral(v: string): string {
  const t = v.trim()
  if (t === '') return 'NULL'
  if (/^-?\d+(\.\d+)?$/.test(t)) return t // 数字原样
  if (/^(NULL|TRUE|FALSE)$/i.test(t)) return t.toUpperCase()
  return `'${t.replace(/'/g, "''")}'`
}
function substituteParams(text: string, values: Record<string, string>): string {
  return text.replace(/(?<![:\w]):(\w+)/g, (m, n: string) => (n in values ? paramLiteral(values[n]) : m))
}
function submitParams(): void {
  const p = pendingParams.value
  if (!p) return
  const resolved = substituteParams(p.source, p.values)
  pendingParams.value = null
  void execSql(resolved)
}

// 用户触发的执行：有选区则只跑选中语句，否则跑整个编辑器内容
function run(): void {
  const selected = editorRef.value?.getSelectedText()?.trim()
  runText(selected || sql.value)
}

function runText(text: string): void {
  const names = paramNames(text)
  if (names.length) {
    pendingParams.value = { names, values: Object.fromEntries(names.map((n) => [n, ''])), source: text }
    return
  }
  void execSql(text)
}

async function execSql(text: string): Promise<void> {
  const statements = splitStatements(text)
  if (!statements.length) return
  const dangers = statements.map(dangerOf).filter(Boolean) as string[]
  if (dangers.length && !window.confirm(`⚠️ 检测到高危操作：\n\n${dangers.join('\n')}\n\n确定执行？`)) return
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
        tab.result = await client.connections.execute(props.conn.id, stmt, [], opts)
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

/** 解释执行计划：PG→JSON 节点树、MySQL→TREE 文本，渲染在「计划」面板；其余回退表格 EXPLAIN。 */
async function explain(): Promise<void> {
  const selected = editorRef.value?.getSelectedText()?.trim()
  const statements = splitStatements(selected || sql.value)
  if (!statements.length) return
  const stmt = statements[0]
  const pq = planQuery(props.conn.dialect, stmt)
  running.value = true
  try {
    if (pq) {
      const r = await client.connections.execute(props.conn.id, pq.sql, [], execOptions())
      const val = String(Object.values(r.rows[0] ?? {})[0] ?? '')
      planData.value =
        pq.format === 'pg-json'
          ? { tree: parsePgPlan(val), text: null }
          : { tree: null, text: val }
      showHistory.value = false
      showSnippets.value = false
      showPlan.value = true
      return
    }
    // 回退：其余方言用普通 EXPLAIN，结果进结果页
    const ex = explainSql(props.conn.dialect, stmt)
    if (!ex) {
      window.alert('当前数据库方言暂不支持「解释」')
      return
    }
    const tab: ResultTab = {
      id: ++tabSeq,
      sql: ex,
      result: await client.connections.execute(props.conn.id, ex, [], execOptions()),
      error: null,
      pageable: false,
      page: 0,
      pageSize: pageSize.value,
      loading: false,
      editTable: null,
    }
    tabs.value = [tab]
    activeTab.value = 0
    showPlan.value = false
  } catch (e) {
    window.alert(`解释失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
  }
}

/** 取消：服务端取消正在执行的查询（MySQL KILL QUERY / PG pg_cancel_backend）+ 渲染端放弃在途结果。 */
function cancel(): void {
  void client.connections.cancel(props.conn.id)
  runToken++
  running.value = false
}

function clearEditor(): void {
  sql.value = ''
}

/** 方言 → sql-formatter 语言。 */
function fmtLang(d: string): SqlLanguage {
  if (['mysql', 'mariadb', 'oceanbase'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase'].includes(d)) return 'postgresql'
  if (d === 'sqlserver') return 'transactsql'
  if (['oracle', 'dm'].includes(d)) return 'plsql'
  return 'sql'
}
function formatSql(): void {
  if (!sql.value.trim()) return
  try {
    sql.value = sqlFormat(sql.value, {
      language: fmtLang(props.conn.dialect),
      keywordCase: settings.keywordCase,
    })
  } catch {
    /* 格式化失败（语法不完整）则保持原样 */
  }
}

// ── 分页 ──
async function gotoPage(tab: ResultTab | undefined, page: number): Promise<void> {
  if (!tab || !tab.pageable || page < 0 || tab.loading) return
  tab.loading = true
  try {
    tab.result = await client.connections.execute(props.conn.id, tab.sql, [], {
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

// 列筛选 → 重建单表查询并从第 0 页重查
function applyServerFilter(tab: ResultTab | undefined, where: string): void {
  if (!tab?.editTable) return
  tab.sql = where ? `SELECT * FROM ${tab.editTable} WHERE ${where}` : `SELECT * FROM ${tab.editTable}`
  void gotoPage(tab, 0)
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
    await client.connections.executeBatch(props.conn.id, stmts, execOptions())
    await gotoPage(tab, tab.page) // 刷新当前页（结果变更会重置网格编辑态）
    await loadHistory()
  } catch (e) {
    window.alert(`提交失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function openHistory(): Promise<void> {
  await loadHistory()
  showSnippets.value = false
  showPlan.value = false
  showHistory.value = true
}

function onPickHistory(picked: string): void {
  sql.value = picked
  showHistory.value = false
}

async function onClearHistory(): Promise<void> {
  await client.connections.historyClear(props.conn.id)
  await loadHistory()
}

// ── SQL 片段 ──
function openSnippets(): void {
  showHistory.value = false
  showPlan.value = false
  showSnippets.value = true
}
function openPlan(): void {
  showHistory.value = false
  showSnippets.value = false
  showPlan.value = true
}
function onPickSnippet(picked: string): void {
  sql.value = picked
  showSnippets.value = false
}
function saveSnippet(sqlText: string): void {
  const text = sqlText.trim()
  if (!text) return
  const name = window.prompt('片段名称', text.slice(0, 40))
  if (name === null) return
  addSnippet(name, text)
}
// 工具栏「存为片段」：有选区则存选中语句，否则存整个编辑器内容
function saveCurrentSnippet(): void {
  const selected = editorRef.value?.getSelectedText()?.trim()
  saveSnippet(selected || sql.value)
}

function selectTab(i: number): void {
  showHistory.value = false
  showSnippets.value = false
  showPlan.value = false
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
  } else if (props.initialSql) {
    sql.value = props.initialSql // 草稿：只填入，不执行
  }
})
</script>

<template>
  <div ref="paneEl" class="pane">
    <div class="toolbar">
      <button class="primary" :disabled="running" title="执行（选中则只跑选区） ⌘/Ctrl+Enter" @click="run">
        ▶ 执行
      </button>
      <button :disabled="running" title="解释执行计划 (EXPLAIN)" @click="explain">解释</button>
      <button title="格式化 SQL" @click="formatSql">格式化</button>
      <button :disabled="!running" @click="cancel">■ 停止</button>
      <button class="ghost" @click="clearEditor">清空</button>
      <button class="ghost" title="把选中语句（无选区则全部）存为片段" @click="saveCurrentSnippet">
        存为片段
      </button>

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

      <span class="hint">⌘/Ctrl+Enter 执行（选中则只跑选区）</span>
      <span class="conn-tag">{{ conn.name || '(未命名)' }} · {{ conn.dialect }}</span>
    </div>

    <div class="editor" :style="{ height: editorHeight + 'px' }">
      <SqlEditor ref="editorRef" v-model="sql" :completion="completion" @run="run" @format="formatSql" />
    </div>

    <div class="splitter" title="拖拽调整高度" @pointerdown="onSplitDown"></div>

    <div class="result-tabs">
      <button
        v-for="(t, i) in tabs"
        :key="t.id"
        class="rtab"
        :class="{ active: !showHistory && !showSnippets && !showPlan && activeTab === i }"
        @click="selectTab(i)"
      >
        结果 {{ i + 1 }}<span v-if="t.error" class="err-dot">!</span>
      </button>
      <button v-if="planData" class="rtab" :class="{ active: showPlan }" @click="openPlan">计划</button>
      <button class="rtab" :class="{ active: showHistory }" @click="openHistory">历史</button>
      <button class="rtab" :class="{ active: showSnippets }" @click="openSnippets">片段</button>
    </div>

    <div class="result">
      <HistoryPanel
        v-if="showHistory"
        :entries="history"
        @pick="onPickHistory"
        @clear="onClearHistory"
        @save-snippet="saveSnippet"
      />
      <SnippetsPanel v-else-if="showSnippets" @pick="onPickSnippet" />
      <PlanPanel v-else-if="showPlan" :tree="planData?.tree ?? null" :text="planData?.text ?? null" />
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
        :filterable="!!cur?.editTable"
        @change-page="(p) => gotoPage(cur, p)"
        @change-page-size="(s) => changePageSize(cur, s)"
        @commit="onCommit"
        @filter="(w) => applyServerFilter(cur, w)"
      />
    </div>

    <Modal v-if="pendingParams" title="填写查询参数" @close="pendingParams = null">
      <div class="params">
        <label v-for="n in pendingParams.names" :key="n" class="prow">
          <span class="pname">:{{ n }}</span>
          <input
            v-model="pendingParams.values[n]"
            placeholder="数字原样 · 文本自动加引号 · 留空=NULL"
            @keyup.enter="submitParams"
          />
        </label>
        <div class="pactions">
          <button class="ghost" @click="pendingParams = null">取消</button>
          <button class="primary" @click="submitParams">执行</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.params {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.prow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.prow .pname {
  width: 120px;
  font-family: ui-monospace, monospace;
  color: var(--accent);
}
.prow input {
  flex: 1;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.pactions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
.pactions button {
  padding: 6px 16px;
}
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
