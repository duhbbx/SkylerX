<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  DbKind,
  MetaNodeKind,
  type QueryHistoryEntry,
  type QueryResult,
  dialectKind,
} from '@db-tool/shared-types'
import { type SqlLanguage, format as sqlFormat } from 'sql-formatter'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { emitChatSqlExecuted } from '../chat-bus'
import { ENV_META, connEnv, connReadOnly, initialCommitMode, isReadOnlyStatement } from '../connEnv'
import { isConnectionError } from '../connError'
import { useDataClient } from '../data-client'
import {
  type TableContext,
  existingForeignKeysQuery,
  explainSql,
  familyOf,
  incomingForeignKeysQuery,
  quoteId,
} from '../ddl'
import { alert as appAlert, confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { type EditChanges, buildEditDml, parseEditableTable } from '../editable'
import { addQueryFavorite } from '../favorites'
import { aiInlineDefaultEnabled, registerAiInlineCompletion } from '../aiInline'
import { t } from '../i18n'
import { type Suggestion, monaco } from '../monaco-setup'
import { notify } from '../notifications'
import { lintStatements } from '../sqlLint'
import { type PlanNode, parsePgPlan, planQuery } from '../plan'
import { pluginBuiltinSnippets } from '../plugins'
import { settings } from '../settings'
import { addSnippet, snippets } from '../snippets'
import { splitStatements } from '../sqlSplit'
import HistoryPanel from './HistoryPanel.vue'
import Modal from './Modal.vue'
import PlanPanel from './PlanPanel.vue'
import ResultGrid from './ResultGrid.vue'
import SnippetsPanel from './SnippetsPanel.vue'
import SqlEditor from './SqlEditor.vue'
import ThemedSelect from './ThemedSelect.vue'
import Watermark from './Watermark.vue'

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

const emit = defineEmits<{
  connError: [string, string]
  ai: [string, string, string]
  newDraft: [string, string]
  /** 结果网格里点「问 AI」：把这条 SQL + 错误 + 当前连接发给 AI 聊天面板 */
  askAiAboutError: [payload: { connId: string; connName?: string; sql: string; error: string }]
  /** A8 反向查找单元格值 */
  searchValue: [payload: { connId: string; value: string }]
}>()

const sql = ref('SELECT 1;')
const editorRef = ref<InstanceType<typeof SqlEditor> | null>(null)
const tabs = ref<ResultTab[]>([])
const activeTab = ref(0)
// 工具栏「⋯ 更多」下拉：用 fixed 定位 + Teleport 到 body，绕过 toolbar 的 overflow 裁切
// 与下方 Monaco 编辑器的 z-index 竞争。每次打开按按钮 rect 重新计算坐标。
const moreOpen = ref(false)
const moreBtn = ref<HTMLButtonElement>()
const moreMenuPos = ref<{ left: number; top: number }>({ left: 0, top: 0 })
function toggleMore(): void {
  if (moreOpen.value) {
    moreOpen.value = false
    return
  }
  const rect = moreBtn.value?.getBoundingClientRect()
  if (rect) {
    // 右对齐到按钮右边缘，菜单大致宽 180；如越界视口右侧则贴左对齐到按钮左侧
    const menuW = 200
    const right = rect.right
    moreMenuPos.value = {
      left: Math.max(8, Math.min(window.innerWidth - menuW - 8, right - menuW)),
      top: rect.bottom + 4,
    }
  }
  moreOpen.value = true
}
function onWinClickForMore(e: MouseEvent): void {
  if (!moreOpen.value) return
  const tgt = e.target as Node
  // 点击按钮自身或菜单内部不算外部点击
  if (moreBtn.value?.contains(tgt)) return
  if (document.querySelector('.more-menu')?.contains(tgt)) return
  moreOpen.value = false
}
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
// NoSQL(Redis/Mongo/ES)没有 EXPLAIN/事务概念,工具栏隐藏对应按钮(保险网,
// 正常路由下 NoSQL 走 RedisPane/MongoPane/ElasticPane,不会落到 QueryPane;
// 但万一通过插件 / 外部入口闯进来,也不出现明显悬空的按钮)。
const isSqlDialect = computed(() => dialectKind(props.conn.dialect) === DbKind.Sql)

/**
 * 外键元数据：
 * - currentFks：本表 → 父表，cellFk 用于「→ 关联行」；
 * - currentIncomingFks：子表 → 本表，反向导航 cellRevFks「← 被以下表引用」。
 * 都支持复合外键（columns/refColumns 同长度对齐）。
 */
interface FkPair {
  columns: string[]
  refTable: string
  refColumns: string[]
}
const currentFks = ref<FkPair[]>([])
const currentIncomingFks = ref<FkPair[]>([])
const fkCache = new Map<string, { out: FkPair[]; rev: FkPair[] }>()

function parseTableRef(ref: string): { schema?: string; table: string } {
  const parts = ref.split('.').map((p) => p.replace(/^["`[]/, '').replace(/["`\]]$/, ''))
  if (parts.length >= 2) return { schema: parts[parts.length - 2], table: parts[parts.length - 1] }
  return { table: parts[0] }
}

/**
 * 用户报告：「除了表之外，其他查询出来的结果集只能只读，不能 update/delete」。
 *
 * parseEditableTable 已经拦截了 JOIN / GROUP BY / 聚合 / 多表 / 子查询等复杂结构
 * （返回 null → editable=false）。剩下唯一漏的是「SELECT * FROM view」：视图名和
 * 表名长得一样，parseEditableTable 把它当真表，用户能双击改单元格、但 INSERT/UPDATE/DELETE
 * 在视图上多数会被 DB 拒绝。
 *
 * 这里通过 information_schema.tables.TABLE_TYPE 做一次异步校验（fire-and-forget），
 * 结果为 'VIEW' 就清空 editTable 让结果集变只读。information_schema 在 SQL 系方言
 * 通用（MySQL / PG / MariaDB / OB / TiDB），不通用的（SQLite / DuckDB / ClickHouse）
 * 查询会失败、catch 后保留原值，不阻断。
 */
async function verifyEditableIsTable(tab: ResultTab): Promise<void> {
  if (!tab.editTable) return
  const ref = parseTableRef(tab.editTable)
  if (!ref.table) return
  try {
    const r = await client.connections.execute(
      props.conn.id,
      `SELECT table_type FROM information_schema.tables
        WHERE table_name = ? AND (? = '' OR table_schema = ?)
        LIMIT 1`,
      [ref.table, ref.schema ?? '', ref.schema ?? ''],
    )
    const tt = (r.rows[0] as Record<string, unknown> | undefined)?.table_type
    if (typeof tt === 'string' && /view/i.test(tt)) {
      tab.editTable = null
    }
  } catch {
    /* information_schema 查不到 → 静默保留原值 */
  }
}

function parseFkRows(rows: Record<string, unknown>[], srcKey: 'reftab' | 'srctab'): FkPair[] {
  const out: FkPair[] = []
  for (const r of rows) {
    const cols = String(r.cols ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const refcols = String(r.refcols ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const tab = String(r[srcKey] ?? '')
    if (!cols.length || !refcols.length || cols.length !== refcols.length || !tab) continue
    out.push({ columns: cols, refTable: tab, refColumns: refcols })
  }
  return out
}

async function loadFks(editTable: string): Promise<void> {
  const cached = fkCache.get(editTable)
  if (cached) {
    currentFks.value = cached.out
    currentIncomingFks.value = cached.rev
    return
  }
  currentFks.value = []
  currentIncomingFks.value = []
  const fam = familyOf(props.conn.dialect)
  if (fam !== 'mysql' && fam !== 'pg') return
  const ref = parseTableRef(editTable)
  const ctx: TableContext =
    fam === 'mysql'
      ? { database: ref.schema ?? props.conn.database }
      : { schema: ref.schema ?? 'public' }
  const fwdSql = existingForeignKeysQuery(props.conn.dialect, ctx, ref.table)
  const revSql = incomingForeignKeysQuery(props.conn.dialect, ctx, ref.table)
  try {
    const out = fwdSql
      ? parseFkRows(
          (await client.connections.execute(props.conn.id, fwdSql, [], ctx)).rows as Record<
            string,
            unknown
          >[],
          'reftab',
        )
      : []
    const rev = revSql
      ? parseFkRows(
          (await client.connections.execute(props.conn.id, revSql, [], ctx)).rows as Record<
            string,
            unknown
          >[],
          'srctab',
        )
      : []
    fkCache.set(editTable, { out, rev })
    currentFks.value = out
    currentIncomingFks.value = rev
  } catch {
    /* 元数据查询失败：静默 */
  }
}

watch(
  () => cur.value?.editTable,
  (v) => {
    if (v) void loadFks(v)
    else {
      currentFks.value = []
      currentIncomingFks.value = []
    }
  },
)

/** 复合 FK 字面量构造：每列用相应方言的字面量；null 走 IS NULL。 */
function whereForFk(refColumns: string[], values: unknown[]): string {
  const fam = familyOf(props.conn.dialect)
  return refColumns
    .map((col, i) => {
      const q = quoteId(props.conn.dialect, col)
      const v = values[i]
      if (v == null) return `${q} IS NULL`
      if (typeof v === 'number') return `${q} = ${v}`
      if (typeof v === 'boolean')
        return `${q} = ${fam === 'pg' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0'}`
      return `${q} = '${String(v).replace(/'/g, "''")}'`
    })
    .join(' AND ')
}

interface FkNavigate {
  refTable: string
  refColumns: string[]
  values: unknown[]
}
/**
 * #5 展开 FK 引用列（dbgate "Expand columns from related tables"）：
 * 用户在 FK 列头点 ⊕ 触发。生成 SELECT 原表 + LEFT JOIN 父表前 3 列别名的新查询 SQL，
 * 让用户在新 tab 看到 JOIN 后的扩展列。父表用 LIMIT 0 探一次列名。
 */
async function onExpandFk(payload: {
  fkCol: string
  refTable: string
  refColumn: string
}): Promise<void> {
  if (!cur.value?.editTable) {
    toast.warn(t('query.expandFkNeedTable'))
    return
  }
  const tableRef = cur.value.editTable
  const q = (s: string) => quoteId(props.conn.dialect, s)
  let refCols: string[] = []
  try {
    const refTbl = q(payload.refTable)
    const probe = await client.connections.execute(props.conn.id, `SELECT * FROM ${refTbl} LIMIT 0`)
    refCols = probe.columns
      .slice(0, 4)
      .map((c) => c.name)
      .filter((n) => n !== payload.refColumn)
      .slice(0, 3)
  } catch {
    refCols = []
  }
  if (!refCols.length) refCols = [payload.refColumn]
  const aliasSelect = refCols
    .map((rc) => `${q(payload.refTable)}.${q(rc)} AS ${q(`${payload.refTable}_${rc}`)}`)
    .join(', ')
  const sqlOut = `SELECT ${tableRef}.*, ${aliasSelect}
FROM ${tableRef}
LEFT JOIN ${q(payload.refTable)}
  ON ${tableRef}.${q(payload.fkCol)} = ${q(payload.refTable)}.${q(payload.refColumn)}
LIMIT 200`
  emit('newDraft', sqlOut, t('query.expandFkTab', { col: payload.fkCol, ref: payload.refTable }))
}

/**
 * #4 FK 值下拉：ResultGrid 编辑 FK 列时请求父表 distinct 值。
 * 查 50 条够下拉用；失败 cb([]) 让 datalist 空，不打断编辑。
 */
async function onFkLookup(payload: {
  refTable: string
  refColumn: string
  cb: (vals: string[]) => void
}): Promise<void> {
  const { refTable, refColumn, cb } = payload
  const tbl = quoteId(props.conn.dialect, refTable)
  const col = quoteId(props.conn.dialect, refColumn)
  try {
    const r = await client.connections.execute(
      props.conn.id,
      `SELECT DISTINCT ${col} AS v FROM ${tbl} WHERE ${col} IS NOT NULL ORDER BY ${col} LIMIT 50`,
    )
    cb(
      r.rows
        .map((row: Record<string, unknown>) => row.v)
        .filter((v): v is string | number => v != null)
        .map((v) => String(v)),
    )
  } catch {
    cb([])
  }
}

function onFkNavigate(fk: FkNavigate): void {
  const fam = familyOf(props.conn.dialect)
  const tbl = quoteId(props.conn.dialect, fk.refTable)
  const ctxSchema = fam === 'pg' ? 'public' : undefined
  const where = whereForFk(fk.refColumns, fk.values)
  const full = `SELECT * FROM ${ctxSchema ? `${quoteId(props.conn.dialect, ctxSchema)}.${tbl}` : tbl} WHERE ${where} LIMIT 200`
  emit('newDraft', full, t('query.fkTabTitle', { tbl: fk.refTable }))
}
const env = connEnv(props.conn) // 环境标记（生产库高危操作加强确认 + 工具栏标识）
const readOnly = connReadOnly(props.conn) // 只读连接：整连接禁写
// 提交模式：本 tab 局部状态，初始跟随全局 settings.commitMode（只读连接强制 auto）；
// 工具栏按钮可即时切换。新建 tab 时取一次初始值，之后用户改了全局也不再影响已开 tab。
const commitMode = ref<'auto' | 'manual'>(initialCommitMode(props.conn, settings.commitMode))

/** 工具栏点切换：auto ↔ manual。切到 auto 前若 manual 还有 dirty 事务，先让用户决定提交/回滚。 */
async function toggleCommitMode(): Promise<void> {
  if (readOnly) {
    toast.info(t('commit.readOnlyForcedAuto'))
    return
  }
  if (commitMode.value === 'manual' && sessionId.value) {
    if (dirty.value) {
      // dirty 时不能简单关 session：弹 confirm 让用户选「提交→切」「回滚→切」「取消」
      const doCommit = await appConfirm({
        title: t('commit.switchToAutoTitle'),
        message: t('commit.switchToAutoPending'),
        confirmText: t('commit.commit'),
        cancelText: t('commit.rollback'),
        variant: 'warn',
      })
      try {
        if (doCommit) await client.connections.commitSession(sessionId.value)
        else await client.connections.rollbackSession(sessionId.value)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        return // 切换中止
      }
    }
    // 干净的 session 直接关
    await endSessionIfAny()
  }
  commitMode.value = commitMode.value === 'manual' ? 'auto' : 'manual'
  toast.info(commitMode.value === 'manual' ? t('commit.modeManual') : t('commit.modeAuto'))
}

// ── 手动提交会话状态 ─────────────────────────────────────────────
// sessionId 在首次 manual 执行时懒申请；任何非「纯读」语句执行后置 dirty
// （SELECT/WITH 这种 PG 也算事务内，但概念上未"改东西"，UX 上不当成有未提交）
const sessionId = ref<string | null>(null)
const dirty = ref(false)
// 方言不支持手动事务时，记一下"本 tab 本次会话已警告过"，避免每条 SQL 都 toast
let sessionUnsupportedWarned = false

async function ensureSession(): Promise<string | null> {
  if (sessionId.value) return sessionId.value
  try {
    const sid = await client.connections.beginSession(props.conn.id, execOptions())
    sessionId.value = sid
    return sid
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('COMMIT_MODE_UNSUPPORTED')) {
      if (!sessionUnsupportedWarned) {
        sessionUnsupportedWarned = true
        toast.warn(t('commit.unsupported'))
      }
      return null // 调用方走 auto fallback
    }
    throw e
  }
}

async function commit(): Promise<void> {
  const sid = sessionId.value
  if (!sid) return
  try {
    await client.connections.commitSession(sid)
    dirty.value = false
    toast.success(t('commit.committed'))
  } catch (e) {
    toast.error(t('commit.commitFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}
async function rollback(): Promise<void> {
  const sid = sessionId.value
  if (!sid) return
  if (
    dirty.value &&
    !(await appConfirm({ message: t('commit.rollbackConfirm'), variant: 'warn' }))
  ) {
    return
  }
  try {
    await client.connections.rollbackSession(sid)
    dirty.value = false
    toast.info(t('commit.rolledBack'))
  } catch (e) {
    toast.error(t('commit.rollbackFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}
async function endSessionIfAny(): Promise<void> {
  const sid = sessionId.value
  if (!sid) return
  sessionId.value = null
  dirty.value = false
  try {
    await client.connections.endSession(sid)
  } catch {
    /* 池连接释放出错不致命 */
  }
}

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
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'JOIN',
  'LEFT JOIN',
  'INNER JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'GROUP BY',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'HAVING',
  'AS',
  'ON',
  'USING',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS NULL',
  'IS NOT NULL',
  'IN',
  'EXISTS',
  'LIKE',
  'BETWEEN',
  'DISTINCT',
  'UNION',
  'UNION ALL',
  'ASC',
  'DESC',
  'VALUES',
  'SET',
  'CREATE TABLE',
  'ALTER TABLE',
  'DROP TABLE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
]
// 内置片段触发词（输入 sel / ins… 选中即展开模板）
const BUILTIN_SNIPPETS = [
  { label: 'sel', insertText: 'SELECT * FROM ' },
  { label: 'self', insertText: 'SELECT * FROM  WHERE ' },
  { label: 'cnt', insertText: 'SELECT COUNT(*) FROM ' },
  { label: 'ins', insertText: 'INSERT INTO  () VALUES ();' },
  { label: 'upd', insertText: 'UPDATE  SET  WHERE ;' },
  { label: 'del', insertText: 'DELETE FROM  WHERE ;' },
  { label: 'cte', insertText: 'WITH t AS (\n  \n)\nSELECT * FROM t' },
]
const MYSQL_FAM = ['mysql', 'mariadb', 'oceanbase']
const PG_FAM = ['postgresql', 'kingbase']
const ORA_FAM = ['oracle', 'dm']

const COMMON_FUNCS = [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'NULLIF',
  'CAST',
  'UPPER',
  'LOWER',
  'TRIM',
  'LENGTH',
  'SUBSTRING',
  'REPLACE',
  'ROUND',
  'ABS',
]
const FAM_FUNCS: Record<string, string[]> = {
  mysql: [
    'CONCAT',
    'IFNULL',
    'IF',
    'DATE_FORMAT',
    'NOW',
    'CURDATE',
    'GROUP_CONCAT',
    'UNIX_TIMESTAMP',
    'JSON_EXTRACT',
  ],
  pg: [
    'STRING_AGG',
    'ARRAY_AGG',
    'TO_CHAR',
    'TO_DATE',
    'NOW',
    'DATE_TRUNC',
    'GENERATE_SERIES',
    'JSONB_BUILD_OBJECT',
  ],
  oracle: ['NVL', 'NVL2', 'DECODE', 'TO_CHAR', 'TO_DATE', 'SYSDATE', 'SUBSTR', 'INSTR', 'LISTAGG'],
  sqlserver: [
    'ISNULL',
    'GETDATE',
    'CONVERT',
    'DATEADD',
    'DATEDIFF',
    'LEN',
    'CHARINDEX',
    'STRING_AGG',
  ],
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
    return (await loadColumns(table)).map((c) => ({
      label: c,
      kind: 'column' as const,
      detail: table,
    }))
  }
  const out: Suggestion[] = KEYWORDS.map((k) => ({ label: k, kind: 'keyword' as const }))
  for (const fn of dialectFuncs())
    out.push({
      label: fn,
      insertText: `${fn}()`,
      kind: 'function',
      detail: t('completion.function'),
    })
  for (const bs of BUILTIN_SNIPPETS)
    out.push({
      label: bs.label,
      insertText: bs.insertText,
      kind: 'snippet',
      detail: t('completion.snippet'),
    })
  for (const ps of pluginBuiltinSnippets())
    out.push({
      label: ps.name,
      insertText: ps.sql,
      kind: 'snippet',
      detail: t('completion.snippet'),
    })
  for (const s of snippets)
    out.push({ label: s.name, insertText: s.sql, kind: 'snippet', detail: t('completion.snippet') })
  for (const tbl of await loadTables())
    out.push({ label: tbl, kind: 'table', detail: t('completion.table') })
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
  if (/^delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s))
    return t('query.dangerDeleteNoWhere', { sql: s.slice(0, 60) })
  if (/^update\b/i.test(s) && !/\bwhere\b/i.test(s))
    return t('query.dangerUpdateNoWhere', { sql: s.slice(0, 60) })
  return null
}

// ── 查询参数化（:name 占位）──
const pendingParams = ref<{
  names: string[]
  values: Record<string, string>
  source: string
} | null>(null)
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
  return text.replace(/(?<![:\w]):(\w+)/g, (m, n: string) =>
    n in values ? paramLiteral(values[n]) : m,
  )
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

// 运行到光标处：只执行光标之前的 SQL
function runToCursor(): void {
  const before = editorRef.value?.getTextBeforeCursor()?.trim()
  if (before) runText(before)
}

// SQL 文本工具（去注释/压缩）。注释剥离为启发式，够日常用。
function stripSqlComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
}
// AI 助手：把当前编辑器内容（优先选区）+ 当前结果页的错误一起递给上层弹窗
function askAi(): void {
  const text = editorRef.value?.getSelectedText()?.trim() || sql.value.trim()
  emit('ai', text, props.conn.id, cur.value?.error ?? '')
}

function compressSql(): void {
  sql.value = stripSqlComments(sql.value).replace(/\s+/g, ' ').trim()
}
function removeComments(): void {
  sql.value = stripSqlComments(sql.value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function runText(text: string): void {
  const names = paramNames(text)
  if (names.length) {
    pendingParams.value = {
      names,
      values: Object.fromEntries(names.map((n) => [n, ''])),
      source: text,
    }
    return
  }
  void execSql(text)
}

async function execSql(text: string): Promise<void> {
  const statements = splitStatements(text)
  if (!statements.length) return
  if (readOnly) {
    const writes = statements.filter((s) => !isReadOnlyStatement(s))
    if (writes.length) {
      await appAlert({
        message: t('query.readOnlyBlocked', { sql: writes[0].slice(0, 60) }),
        variant: 'warn',
      })
      return
    }
  }
  // SQL Linter：error → 弹确认；warn → toast；info → 静默（仅在 console 里留痕，方便调试）
  // 跑在 dangerOf 之前，避免「无 WHERE」这种规则与 prod 强确认双弹（lintError 命中时直接 return）。
  const findings = lintStatements(statements, { connEnv: env, isReadOnly: readOnly })
  const lintErrors = findings.filter((f) => f.severity === 'error')
  if (lintErrors.length) {
    const ok = await appConfirm({
      title: t('query.dangerTitle'),
      message: lintErrors.map((f) => `• ${f.message}`).join('\n'),
      variant: 'danger',
      confirmText: t('common.confirm'),
    })
    if (!ok) return
  }
  const lintWarns = findings.filter((f) => f.severity === 'warn')
  if (lintWarns.length) toast.warn(lintWarns.map((f) => f.message).join('; '))
  const dangers = statements.map(dangerOf).filter(Boolean) as string[]
  if (dangers.length) {
    if (env === 'prod') {
      // 生产库高危操作：要求键入连接名二次确认，防误操作
      const typed = await appPrompt({
        title: t('query.dangerTitle'),
        message: t('query.prodDanger', { dangers: dangers.join('\n'), name: props.conn.name }),
        placeholder: props.conn.name,
      })
      if (typed?.trim() !== props.conn.name) return
    } else if (
      !(await appConfirm({
        title: t('query.dangerTitle'),
        message: t('query.dangerConfirm', { dangers: dangers.join('\n') }),
        variant: 'danger',
      }))
    ) {
      return
    }
  }
  const token = ++runToken
  running.value = true
  showHistory.value = false
  const next: ResultTab[] = []
  // 手动模式：先开 session（失败回落到 auto）；auto 模式：sid 始终是 null
  const sid = commitMode.value === 'manual' ? await ensureSession() : null
  try {
    for (const stmt of statements) {
      const pageable = paginatable && isSelect(stmt)
      const editTable = !readOnly && paginatable && isSelect(stmt) ? parseEditableTable(stmt) : null
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
        const opts = pageable ? { ...execOptions(), limit: tab.pageSize, offset: 0 } : execOptions()
        tab.result = sid
          ? await client.connections.executeInSession(sid, stmt, [], opts)
          : await client.connections.execute(props.conn.id, stmt, [], opts)
        // 非纯读语句执行成功 → 标记 session 有未提交改动
        if (sid && !isReadOnlyStatement(stmt)) dirty.value = true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        tab.error = msg
        if (isConnectionError(msg)) emit('connError', props.conn.id, msg)
        // PG 事务报错后整段进入 aborted 状态，必须 ROLLBACK 才能继续；
        // 我们这里不自动回滚，让用户看到 dirty + 错误，自行决定 commit/rollback。
        // MySQL 没这个状态，单条 stmt 失败不影响后续。
      }
      if (token !== runToken) return // 已被停止，丢弃结果
      next.push(tab)
    }
    tabs.value = next
    activeTab.value = 0
    // 异步校验每个 tab 的 editTable 是真表（不是视图）：是视图就清空 editTable
    // 让结果集变只读。fire-and-forget，不阻塞结果集渲染。
    for (const tab of next) void verifyEditableIsTable(tab)
    // AI 聊天面板：以原文 SQL 为 key 广播执行结果，更新代码块旁的执行徽章
    const firstErr = next.find((t) => t.error)?.error ?? null
    emitChatSqlExecuted({ sql: text, ok: !firstErr, error: firstErr })
    // I1 通知 webhook：失败 → query-error；耗时超阈值 → slow-query
    void notifyExecResult(text, next, firstErr)
  } finally {
    if (token === runToken) {
      running.value = false
      await loadHistory()
    }
  }
}

/** 解释执行计划：PG→JSON 节点树、MySQL→TREE 文本，渲染在「计划」面板；其余回退表格 EXPLAIN。
 *  withAnalyze=true 时走 EXPLAIN ANALYZE（PG）/ ANALYZE FORMAT=JSON（MySQL 8.0+），
 *  会**真正执行**查询拿真实行数和耗时，因此 DML 会有副作用，调用方须二次确认。 */
async function explain(withAnalyze = false): Promise<void> {
  const selected = editorRef.value?.getSelectedText()?.trim()
  const statements = splitStatements(selected || sql.value)
  if (!statements.length) return
  const stmt = statements[0]
  // ANALYZE 会跑 DML 修改数据，强制二次确认（看 dangerOf 一致逻辑）
  if (withAnalyze && /^\s*(insert|update|delete|truncate|drop|alter|create)\b/i.test(stmt)) {
    if (
      !(await appConfirm({
        title: t('query.dangerTitle'),
        message: t('plan.analyzeDmlWarn'),
        variant: 'danger',
      }))
    )
      return
  }
  const pq = planQuery(props.conn.dialect, stmt, { analyze: withAnalyze })
  running.value = true
  try {
    if (pq) {
      const r = await client.connections.execute(props.conn.id, pq.sql, [], execOptions())
      const val = String(Object.values(r.rows[0] ?? {})[0] ?? '')
      planData.value =
        pq.format === 'pg-json' ? { tree: parsePgPlan(val), text: null } : { tree: null, text: val }
      showHistory.value = false
      showSnippets.value = false
      showPlan.value = true
      return
    }
    // 回退：其余方言用普通 EXPLAIN，结果进结果页
    const ex = explainSql(props.conn.dialect, stmt)
    if (!ex) {
      await appAlert({ message: t('query.explainUnsupported'), variant: 'warn' })
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
    toast.error(t('query.explainFailed', { msg: e instanceof Error ? e.message : String(e) }))
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
  tab.sql = where
    ? `SELECT * FROM ${tab.editTable} WHERE ${where}`
    : `SELECT * FROM ${tab.editTable}`
  void gotoPage(tab, 0)
}

function changePageSize(tab: ResultTab | undefined, size: number): void {
  if (!tab) return
  tab.pageSize = size
  pageSize.value = size
  void gotoPage(tab, 0)
}

// 提交编辑（事务批执行 → 刷新当前页）
// 提交前先把生成的 DML 列出来供复核（保护提交），确认后再执行
const editPreview = ref<{ stmts: string[] } | null>(null)
function onCommit(changes: EditChanges): void {
  const tab = cur.value
  if (!tab || !tab.editTable || !tab.result) return
  const columns = tab.result.columns.map((c) => c.name)
  const stmts = buildEditDml(props.conn.dialect, tab.editTable, columns, changes)
  if (!stmts.length) return
  editPreview.value = { stmts }
}
async function doCommit(): Promise<void> {
  const p = editPreview.value
  const tab = cur.value
  if (!p || !tab) return
  editPreview.value = null
  try {
    await client.connections.executeBatch(props.conn.id, p.stmts, execOptions())
    await gotoPage(tab, tab.page) // 刷新当前页（结果变更会重置网格编辑态）
    await loadHistory()
  } catch (e) {
    await appAlert({
      title: t('query.commitFailedTitle'),
      message: t('query.commitFailed', { msg: e instanceof Error ? e.message : String(e) }),
      variant: 'danger',
    })
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
async function saveSnippet(sqlText: string): Promise<void> {
  const text = sqlText.trim()
  if (!text) return
  const name = await appPrompt({
    message: t('query.snippetNamePrompt'),
    defaultValue: text.slice(0, 40),
  })
  if (name === null) return
  const tags = (await appPrompt({ message: t('query.snippetTagsPrompt'), defaultValue: '' })) ?? ''
  addSnippet(name, text, tags.split(','))
}
// 工具栏「存为片段」：有选区则存选中语句，否则存整个编辑器内容
function saveCurrentSnippet(): void {
  const selected = editorRef.value?.getSelectedText()?.trim()
  void saveSnippet(selected || sql.value)
}
// 工具栏「收藏此查询」：把选区或整段 SQL 存入收藏夹（kind = 'query'）
async function favoriteCurrentQuery(): Promise<void> {
  const selected = editorRef.value?.getSelectedText()?.trim()
  const text = (selected || sql.value).trim()
  if (!text) return
  const name = await appPrompt({ message: t('query.favName'), defaultValue: text.slice(0, 40) })
  if (name == null) return
  const tag = (await appPrompt({ message: t('query.favTag'), defaultValue: '' })) ?? ''
  addQueryFavorite({
    connId: props.conn.id,
    connName: props.conn.name || t('common.untitled'),
    dialect: props.conn.dialect,
    name,
    sql: text,
    tags: tag ? [tag] : undefined,
  })
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

/**
 * K1 编辑器内动作 window event 接听：Workspace.dispatchCommand 派发 editor:run-sql 等，
 * 只有"激活"tab 应该响应——但 Vue 的 v-show 切换不卸载组件，所有 QueryPane 实例都会收到。
 * 用 IntersectionObserver 太重；这里用 paneEl 是否在视口里的简单判定（visible 时 offsetParent 非 null）。
 */
function isPaneActive(): boolean {
  const el = paneEl.value
  return !!(el && el.offsetParent !== null)
}
function onEditorRunSql(): void {
  if (isPaneActive()) run()
}
function onEditorFormatSql(): void {
  if (isPaneActive()) formatSql()
}
function onEditorSaveSnippet(): void {
  if (isPaneActive()) saveCurrentSnippet()
}
function onEditorFind(): void {
  if (isPaneActive()) editorRef.value?.triggerFind?.()
}
function onEditorReplace(): void {
  if (isPaneActive()) editorRef.value?.triggerReplace?.()
}

/** 拼一个轻量 schema 提示给 AI 行内补全（只发表名，列发太多会撑爆 token）。 */
function buildSchemaHint(): string | undefined {
  if (!tableList || !tableList.length) return undefined
  const sample = tableList.slice(0, 40).join(', ')
  return `tables: ${sample}`
}

/** AI 行内补全：在 Monaco 实例上挂 InlineCompletionsProvider；onUnmounted 时释放。 */
let aiInlineDisposer: { dispose(): void } | null = null
function setupAiInline(): void {
  const ed = editorRef.value?.getEditor?.()
  if (!ed) return
  aiInlineDisposer = registerAiInlineCompletion(monaco, ed, {
    getContext: () => ({
      dialect: props.conn.dialect,
      schemaHint: buildSchemaHint(),
    }),
    enabled: aiInlineDefaultEnabled,
  })
}

onMounted(() => {
  void loadHistory()
  void loadContext()
  if (props.pending) {
    sql.value = props.pending.sql
    void run()
  } else if (props.initialSql) {
    sql.value = props.initialSql // 草稿：只填入，不执行
  }
  window.addEventListener('mousedown', onWinClickForMore)
  window.addEventListener('editor:run-sql', onEditorRunSql)
  window.addEventListener('editor:format-sql', onEditorFormatSql)
  window.addEventListener('editor:save-snippet', onEditorSaveSnippet)
  window.addEventListener('editor:find', onEditorFind)
  window.addEventListener('editor:replace', onEditorReplace)
  setupAiInline()
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWinClickForMore)
  window.removeEventListener('editor:run-sql', onEditorRunSql)
  window.removeEventListener('editor:format-sql', onEditorFormatSql)
  window.removeEventListener('editor:save-snippet', onEditorSaveSnippet)
  window.removeEventListener('editor:find', onEditorFind)
  window.removeEventListener('editor:replace', onEditorReplace)
  aiInlineDisposer?.dispose()
  aiInlineDisposer = null
  // 关 tab 时若还有未关闭的 session，按"放弃改动"语义结束（endSession 内部会 ROLLBACK）。
  // 这里不弹确认——确认的责任在 QueryTabs.close（它有机会先弹再卸载组件）。
  void endSessionIfAny()
})

/**
 * I1：把执行结果转成 webhook 通知；耗时长 / 失败两条线分开发，方便用户在通知设置里只订阅其中一条。
 * 失败 + 不可达连接 不重复发（不可达通常是网络/重启，靠 connError 处理）。
 */
async function notifyExecResult(
  sql: string,
  tabs: ResultTab[],
  firstErr: string | null,
): Promise<void> {
  const connName = props.conn.name || props.conn.dialect
  const totalMs = tabs.reduce((s, t) => s + (t.result?.executionTimeMs ?? 0), 0)
  const sqlPreview = sql.length > 200 ? `${sql.slice(0, 200)}…` : sql
  if (firstErr && settings.notifyOnQueryError) {
    await notify('query-error', {
      title: `❌ SQL 执行失败 @ ${connName}`,
      body: `${firstErr}\n\n\`\`\`sql\n${sqlPreview}\n\`\`\``,
      level: 'error',
    })
  } else if (!firstErr && settings.slowQueryNotifyMs > 0 && totalMs >= settings.slowQueryNotifyMs) {
    await notify('slow-query', {
      title: `🐢 慢查询 ${totalMs}ms @ ${connName}`,
      body: `执行耗时 ${totalMs}ms，超过阈值 ${settings.slowQueryNotifyMs}ms。\n\n\`\`\`sql\n${sqlPreview}\n\`\`\``,
      level: 'warn',
    })
  }
}

// 暴露给 QueryTabs.close 在卸载前检查是否有未提交（要弹挽留确认时调用）
defineExpose({
  isDirty: () => dirty.value && !!sessionId.value,
  commitMode: () => commitMode.value,
  /** 让 QueryTabs 在 close 前先决定是 commit / rollback / 取消 */
  flushSession: async (decision: 'commit' | 'rollback'): Promise<void> => {
    if (!sessionId.value) return
    if (decision === 'commit') {
      await client.connections.commitSession(sessionId.value)
    } else {
      await client.connections.rollbackSession(sessionId.value)
    }
    dirty.value = false
  },
})
</script>

<template>
  <div ref="paneEl" class="pane">
    <Watermark v-if="env === 'prod'" />
    <!--
      工具栏分组：高频「执行 / 停止 / 运行到此 / EXPLAIN / 格式化 / AI」常驻；
      低频「压缩单行 / 去注释 / 清空 / 存为片段 / 收藏」收进右上「⋯ 更多」下拉，
      防止窗体收窄时按钮文字换行。Tab 标题已带连接名，去掉冗余的 conn-tag。
    -->
    <div class="toolbar">
      <button class="primary" :disabled="running" :title="t('query.run.title')" @click="run">
        ▶ {{ t('query.run') }}
      </button>
      <button :disabled="!running" :title="t('query.stop')" @click="cancel">■</button>
      <button :disabled="running" :title="t('query.runToCursor.title')" @click="runToCursor">⏭</button>
      <!-- NoSQL 没有 EXPLAIN / 事务概念,隐藏对应按钮 -->
      <button v-if="isSqlDialect" :disabled="running" :title="t('query.explain.title')" @click="explain(false)">{{ t('query.explain') }}</button>
      <button v-if="isSqlDialect" :disabled="running" :title="t('query.explainAnalyzeTitle')" @click="explain(true)">{{ t('query.explainAnalyze') }}</button>
      <!-- 提交模式切换：点一下 auto/manual 互切；manual 时 dirty 状态点切换会先弹 commit/rollback 确认 -->
      <span v-if="isSqlDialect" class="tb-sep" />
      <button
        v-if="isSqlDialect"
        class="commit-mode-toggle"
        :class="commitMode"
        :title="commitMode === 'manual' ? t('commit.toggleToAutoTitle') : t('commit.toggleToManualTitle')"
        :disabled="readOnly || running"
        @click="toggleCommitMode"
      >
        {{ commitMode === 'manual' ? '⌨ ' + t('commit.modeManual') : '⚡ ' + t('commit.modeAuto') }}
      </button>
      <!-- 手动提交模式专属：提交 / 回滚 / 事务状态 -->
      <template v-if="isSqlDialect && commitMode === 'manual'">
        <button
          class="commit"
          :disabled="!sessionId || !dirty || running"
          :title="t('commit.commitTitle')"
          @click="commit"
        >✓ {{ t('commit.commit') }}</button>
        <button
          class="rollback"
          :disabled="!sessionId || running"
          :title="t('commit.rollbackTitle')"
          @click="rollback"
        >↺ {{ t('commit.rollback') }}</button>
        <span
          class="txn-badge"
          :class="dirty ? 'dirty' : 'clean'"
          :title="dirty ? t('commit.dirtyTitle') : t('commit.cleanTitle')"
        >
          <span class="txn-dot" />
          {{ dirty ? t('commit.dirty') : t('commit.clean') }}
        </span>
      </template>
      <span class="tb-sep" />
      <button :title="t('query.format.title')" @click="formatSql">{{ t('query.format') }}</button>
      <button class="ghost" :title="t('query.ai.title')" @click="askAi">✨ AI</button>
      <span class="tb-sep" />
      <!-- 更多操作下拉：用 position:fixed 渲染，避免被 toolbar 的 overflow:auto 裁切 / 被下方 Monaco 编辑器盖住 -->
      <div class="more-wrap">
        <button ref="moreBtn" class="ghost" :title="t('query.more')" @click="toggleMore">⋯</button>
        <Teleport to="body">
          <div
            v-if="moreOpen"
            class="more-menu"
            :style="{ left: moreMenuPos.left + 'px', top: moreMenuPos.top + 'px' }"
            @click="moreOpen = false"
          >
          <button @click="compressSql">{{ t('query.compress') }}</button>
          <button @click="removeComments">{{ t('query.stripComments') }}</button>
          <button @click="saveCurrentSnippet">{{ t('query.saveSnippet') }}</button>
          <button @click="favoriteCurrentQuery">★ {{ t('query.favorite') }}</button>
          <hr />
          <button class="danger" @click="clearEditor">{{ t('query.clear') }}</button>
          </div>
        </Teleport>
      </div>

      <ThemedSelect
        v-if="topKind === 'database'"
        :model-value="selectedDb"
        :options="[{ value: '', label: t('query.defaultDb') }, ...dbOptions.map((d) => ({ value: d, label: d }))]"
        :placeholder="t('query.defaultDb')"
        :width="170"
        @update:model-value="(v) => { selectedDb = v; onDbChange() }"
      />
      <ThemedSelect
        v-if="schemaOptions.length || topKind === 'schema'"
        v-model="selectedSchema"
        :options="[{ value: '', label: t('query.defaultSchema') }, ...schemaOptions.map((s) => ({ value: s, label: s }))]"
        :placeholder="t('query.defaultSchema')"
        :width="170"
      />

      <span
        v-if="env"
        class="env-badge"
        :style="{ background: ENV_META[env].color }"
        :title="t('env.dangerTitle', { label: t('env.' + env) })"
      >{{ t('env.' + env) }}</span>
      <span v-if="readOnly" class="env-badge ro" :title="t('conn.readOnlyTitle')">{{ t('conn.readOnly') }}</span>
    </div>

    <div class="editor" :style="{ height: editorHeight + 'px' }">
      <SqlEditor
        ref="editorRef"
        v-model="sql"
        :completion="completion"
        @run="run"
        @format="formatSql"
        @save-snippet="saveCurrentSnippet"
        @favorite="favoriteCurrentQuery"
        @ai-explain="askAi"
        @compress="compressSql"
        @strip-comments="removeComments"
      />
    </div>

    <div class="splitter" :title="t('query.splitterTitle')" @pointerdown="onSplitDown"></div>

    <div class="result-tabs">
      <button
        v-for="(tab, i) in tabs"
        :key="tab.id"
        class="rtab"
        :class="{ active: !showHistory && !showSnippets && !showPlan && activeTab === i }"
        @click="selectTab(i)"
      >
        {{ t('query.tabResult', { n: i + 1 }) }}<span v-if="tab.error" class="err-dot">!</span>
      </button>
      <button v-if="planData" class="rtab" :class="{ active: showPlan }" @click="openPlan">{{ t('query.tabPlan') }}</button>
      <button class="rtab" :class="{ active: showHistory }" @click="openHistory">{{ t('query.tabHistory') }}</button>
      <button class="rtab" :class="{ active: showSnippets }" @click="openSnippets">{{ t('query.tabSnippets') }}</button>
    </div>

    <div class="result">
      <HistoryPanel
        v-if="showHistory"
        :entries="history"
        @pick="onPickHistory"
        @clear="onClearHistory"
        @save-snippet="saveSnippet"
      />
      <SnippetsPanel v-else-if="showSnippets" :dialect="props.conn.dialect" @pick="onPickSnippet" />
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
        :foreign-keys="currentFks"
        :incoming-foreign-keys="currentIncomingFks"
        :sql="cur?.sql"
        :conn-id="conn.id"
        :conn-name="conn.name"
        @change-page="(p) => gotoPage(cur, p)"
        @change-page-size="(s) => changePageSize(cur, s)"
        @commit="onCommit"
        @filter="(w) => applyServerFilter(cur, w)"
        @navigate-fk="onFkNavigate"
        @fk-lookup="onFkLookup"
        @expand-fk="onExpandFk"
        @ask-ai="(p) => emit('askAiAboutError', p)"
        @search-value="(v) => emit('searchValue', { connId: conn.id, value: v })"
      />
    </div>

    <Modal v-if="pendingParams" :title="t('query.paramsTitle')" @close="pendingParams = null">
      <div class="params">
        <label v-for="n in pendingParams.names" :key="n" class="prow">
          <span class="pname">:{{ n }}</span>
          <input
            v-model="pendingParams.values[n]"
            :placeholder="t('query.paramsPlaceholder')"
            @keyup.enter="submitParams"
          />
        </label>
        <div class="pactions">
          <button class="ghost" @click="pendingParams = null">{{ t('common.cancel') }}</button>
          <button class="primary" @click="submitParams">{{ t('query.run') }}</button>
        </div>
      </div>
    </Modal>

    <Modal
      v-if="editPreview"
      :title="t('query.commitPreviewTitle', { n: editPreview.stmts.length })"
      @close="editPreview = null"
    >
      <pre class="commit-sql">{{ editPreview.stmts.join(';\n') }};</pre>
      <div class="pactions">
        <button class="ghost" @click="editPreview = null">{{ t('common.cancel') }}</button>
        <button class="primary" @click="doCommit">{{ t('query.commitConfirm') }}</button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.commit-sql {
  max-height: 320px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  margin: 0 0 12px;
}
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
  position: relative; /* 让 .watermark 绝对定位铺满整个查询页 */
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  /* 收窄时让多余按钮可横向滚动而不是 wrap，避免按钮内文字断行 */
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: visible;
  min-width: 0;
}
.toolbar::-webkit-scrollbar {
  height: 6px;
}
.toolbar .hint {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
.toolbar .env-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  padding: 1px 7px;
  border-radius: 4px;
  white-space: nowrap;
  flex: none;
}
.toolbar .env-badge.ro {
  margin-left: 4px;
  background: #607d8b;
}
.toolbar button {
  padding: 4px 12px;
  font-size: 13px;
  white-space: nowrap;
  flex: none;
}
/* 工具栏分组分隔线 */
.toolbar .tb-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  flex: none;
  margin: 0 2px;
}
/* ── 提交模式切换按钮（点一下 auto / manual 互切，颜色随状态） ── */
.toolbar button.commit-mode-toggle {
  font-weight: 500;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  padding: 2px 8px;
}
.toolbar button.commit-mode-toggle.auto {
  color: #4caf50;
  border-color: rgba(76, 175, 80, 0.5);
}
.toolbar button.commit-mode-toggle.manual {
  color: #e0a020;
  border-color: rgba(224, 160, 32, 0.5);
}
.toolbar button.commit-mode-toggle:hover:not(:disabled) {
  background: rgba(124, 108, 255, 0.10);
}
/* ── 手动提交模式按钮 + 状态徽章 ── */
.toolbar button.commit {
  color: #4caf50;
  border-color: rgba(76, 175, 80, 0.5);
}
.toolbar button.commit:not(:disabled):hover {
  background: rgba(76, 175, 80, 0.14);
}
.toolbar button.rollback {
  color: var(--err, #e04050);
  border-color: rgba(224, 64, 80, 0.5);
}
.toolbar button.rollback:not(:disabled):hover {
  background: rgba(224, 64, 80, 0.14);
}
.toolbar .txn-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  flex: none;
}
.toolbar .txn-badge.clean {
  color: var(--muted);
  background: rgba(180, 180, 180, 0.10);
}
.toolbar .txn-badge.dirty {
  color: #e0a020;
  background: rgba(224, 160, 32, 0.14);
}
.toolbar .txn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
/* 「⋯ 更多」下拉 */
.more-wrap {
  position: relative;
  display: inline-flex;
  flex: none;
}
.more-menu {
  /* Teleport 到 body 后用 fixed 定位（坐标由脚本根据按钮 rect 算好），
   * z-index 抬高到 1000+，盖过 Monaco 编辑器（其内部 widget z-index 在 50~100 量级） */
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.more-menu button {
  text-align: left;
  width: 100%;
  background: transparent;
  border: none;
  padding: 6px 10px;
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
}
.more-menu button:hover {
  background: rgba(124, 108, 255, 0.18);
}
.more-menu button.danger {
  color: var(--err);
}
.more-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 4px 6px;
}
.toolbar .ctx {
  width: auto;
  padding: 4px 26px 4px 10px;
  font-size: 12px;
  max-width: 180px;
  background-color: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  /* 关闭原生 select 的系统下拉样式,改为自定义 caret;option 列表的样式
     由 OS 决定无法跨平台完全统一,但触发器(button 看起来部分)与主题对齐 */
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23bbb' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}
.toolbar .ctx:hover {
  border-color: var(--accent);
}
.toolbar .ctx:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(124, 108, 255, 0.18);
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
