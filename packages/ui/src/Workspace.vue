<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { useDataClient } from './data-client'
import { t } from './i18n'
import CommandPalette, { type PaletteItem } from './components/CommandPalette.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import DataTransferDialog from './components/DataTransferDialog.vue'
import ExportOptionsDialog from './components/ExportOptionsDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import Modal from './components/Modal.vue'
import DataDiffDialog from './components/DataDiffDialog.vue'
import NavTree from './components/NavTree.vue'
import ObjectSearchDialog from './components/ObjectSearchDialog.vue'
import OperationLogDialog from './components/OperationLogDialog.vue'
import ServerMonitorDialog from './components/ServerMonitorDialog.vue'
import AiAssistantDialog from './components/AiAssistantDialog.vue'
import type { AiMode } from './ai'
import PrivilegesDialog from './components/PrivilegesDialog.vue'
import SchemaDiffDialog from './components/SchemaDiffDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import QueryTabs from './components/QueryTabs.vue'
import type { TreeNode } from './components/treeNode'
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { buildCreateFromColumns, buildDataDictHtml, buildDataDictMarkdown, buildTableDump } from './dump'
import { type Favorite, favorites, removeFavorite, setFavoriteTag, toggleFavorite } from './favorites'
import { zoomIn, zoomOut, zoomReset } from './settings'
import { buildMockInserts } from './mockgen'
import {
  type ObjectKind,
  type SqlTemplateKind,
  type TableContext,
  type TableStats,
  buildDrop,
  buildSqlTemplate,
  contextOfNode,
  definitionQuery,
  deriveContext,
  existingForeignKeysQuery,
  formatBytes,
  incomingForeignKeysQuery,
  parseTableStats,
  tableStatsQuery,
  dropSupportsCascade,
  erdContext,
  extractDefinition,
  objectDdlQuery,
  objectRef,
  previewSql,
  quoteId,
} from './ddl'

const navRef = useTemplateRef('navRef')
const tabsRef = useTemplateRef('tabsRef')

// 数据客户端由外层应用壳注入（桌面=IPC，Web=REST）
const client = useDataClient()

// editing 非空 → 弹出连接表单弹窗；error 为连接失败信息（自动弹窗时带上）
const editing = ref<{ connId: string | null; error?: string } | null>(null)

// 删除确认弹窗
const dropConfirm = ref<{
  connId: string
  node: TreeNode
  dialect: DbDialect
  label: string
  cascade: boolean
  busy: boolean
  error: string | null
} | null>(null)

// 批量删除确认弹窗
const bulkDropState = ref<{
  items: { connId: string; node: TreeNode; dialect: DbDialect }[]
  cascade: boolean
  busy: boolean
  done: number
  error: string | null
} | null>(null)

// CSV 导入对话框
const importing = ref<{ connId: string; node: TreeNode; dialect: DbDialect; ctx: TableContext } | null>(
  null,
)
// 数据传输对话框
const transferring = ref<{
  connId: string
  node: TreeNode
  dialect: DbDialect
  ctx: TableContext
} | null>(null)

const dropResult = computed(() =>
  dropConfirm.value
    ? buildDrop(dropConfirm.value.dialect, dropConfirm.value.node, dropConfirm.value.cascade)
    : null,
)
const dropCascadeApplicable = computed(() =>
  dropConfirm.value
    ? dropSupportsCascade(dropConfirm.value.dialect, dropConfirm.value.node.kind)
    : false,
)

function onNew(): void {
  editing.value = { connId: null }
}

function onEditConn(id: string): void {
  editing.value = { connId: id }
}

async function onSelectConn(id: string): Promise<void> {
  const conn = await client.connections.get(id)
  tabsRef.value?.openConnection(conn)
}

async function onNewQuery(id: string, node?: TreeNode): Promise<void> {
  const conn = await client.connections.get(id)
  // 用触发节点所在的库/schema 作为查询上下文（找不到则查询页落默认库）
  const ctx = node ? contextOfNode(conn.dialect, node) : undefined
  tabsRef.value?.newQuery(conn, ctx)
}

async function onRunSql(connId: string, sql: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, sql)
}

async function onDeleteConn(id: string): Promise<void> {
  if (!window.confirm(t('conn.removeConfirm'))) return
  await client.connections.remove(id)
  await navRef.value?.reload()
  tabsRef.value?.closeConnTabs(id)
}

// 连接打不开 / 查询报连接级错误 → 自动弹出该连接的编辑弹窗（已开则不重复弹）
function onConnError(connId: string, message: string): void {
  if (editing.value) return
  editing.value = { connId, error: message }
}

// 新建对象（表/视图/函数/存储过程）：从目录或对象节点触发 → 推断库/schema，开一个设计器 Tab
async function onNewObject(kind: ObjectKind, connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  // 对象节点新建 → 刷新其父目录；目录节点 → 刷新自身
  const refreshTarget = node.kind === 'group' ? node : (node.parent ?? node)
  tabsRef.value?.newObject(conn, kind, ctx, refreshTarget)
}

// 设计器创建成功 → 刷新对应目录树节点
function onTreeRefresh(node: TreeNode, connId: string): void {
  navRef.value?.refreshNode(node, connId)
}

// 查看表/视图结构 → 开结构页签
async function onViewStructure(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openStructure(conn, node)
}

// 查询前 200 行 → 按方言生成限行 SQL 并在查询页执行
async function onPreviewTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, previewSql(conn.dialect, node.sqlName ?? node.name, 200))
}

// 设计表（修改现有表）→ 开设计器 Tab（alter 模式，载入现有结构）
async function onDesignTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  tabsRef.value?.editTable(conn, ctx, node)
}

// 生成测试数据 → 取列信息，按类型造多行 INSERT 填入查询页（不执行）
async function onMockData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const countStr = window.prompt(t('ws.mockPrompt', { name: node.name }), '20')
  const count = Number(countStr)
  if (!Number.isFinite(count) || count < 1) return
  const colNodes = await client.connections.metadata(connId, {
    parentKind: MetaNodeKind.Group,
    path: [...node.path],
    group: 'columns',
  })
  const cols = colNodes.map((c) => ({
    name: c.name,
    type: c.detail?.dataType ?? '',
    pk: !!c.detail?.primaryKey,
  }))
  if (!cols.length) {
    window.alert(t('ws.noCols'))
    return
  }
  const ref = node.sqlName ?? node.name
  const sql = buildMockInserts(conn.dialect, ref, cols, Math.floor(count))
  tabsRef.value?.openDraft(conn, sql, t('ws.tabMockData', { name: node.name }))
}

// 表统计信息 → 弹窗展示行数 / 数据 / 索引占用
const tableStats = ref<{
  name: string
  stats: TableStats | null
  error: string | null
  fmt: (n: number) => string
} | null>(null)
async function onTableStats(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  const sql = tableStatsQuery(conn.dialect, ctx, node.name)
  tableStats.value = { name: node.name, stats: null, error: null, fmt: formatBytes }
  if (!sql) {
    tableStats.value.error = t('ws.statsUnsupported')
    return
  }
  try {
    const r = await client.connections.execute(connId, sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    const row = (r.rows as Record<string, unknown>[])[0]
    if (!row) tableStats.value.error = t('ws.noStats')
    else tableStats.value.stats = parseTableStats(row)
  } catch (e) {
    if (tableStats.value) tableStats.value.error = e instanceof Error ? e.message : String(e)
  }
}

// 外键依赖关系 → 弹窗展示「引用的表 / 被引用」，可点击在树中定位
const deps = ref<{
  name: string
  connId: string
  schema: string
  out: { table: string; cols: string }[]
  inc: { table: string; cols: string }[]
  error: string | null
} | null>(null)
async function onDeps(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  deps.value = {
    name: node.name,
    connId,
    schema: ctx.schema ?? ctx.database ?? '',
    out: [],
    inc: [],
    error: null,
  }
  const outSql = existingForeignKeysQuery(conn.dialect, ctx, node.name)
  const inSql = incomingForeignKeysQuery(conn.dialect, ctx, node.name)
  if (!outSql || !inSql) {
    deps.value.error = t('ws.depsUnsupported')
    return
  }
  try {
    const opts = { database: ctx.database, schema: ctx.schema }
    const [o, i] = await Promise.all([
      client.connections.execute(connId, outSql, [], opts),
      client.connections.execute(connId, inSql, [], opts),
    ])
    deps.value.out = (o.rows as Record<string, unknown>[]).map((r) => ({
      table: String(r.reftab ?? ''),
      cols: String(r.cols ?? ''),
    }))
    deps.value.inc = (i.rows as Record<string, unknown>[]).map((r) => ({
      table: String(r.srctab ?? ''),
      cols: String(r.cols ?? ''),
    }))
  } catch (e) {
    if (deps.value) deps.value.error = e instanceof Error ? e.message : String(e)
  }
}
// 复制建表语句：MySQL 用 SHOW CREATE TABLE，其余由列信息重建
async function onCopyDdl(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  try {
    let ddl = ''
    if (['mysql', 'mariadb', 'oceanbase'].includes(conn.dialect)) {
      const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${node.sqlName ?? node.name}`, [], {
        database: ctx.database,
        schema: ctx.schema,
      })
      const row = (r.rows as Record<string, unknown>[])[0] ?? {}
      ddl = String(row['Create Table'] ?? row['Create View'] ?? Object.values(row)[1] ?? '')
    } else {
      const cols = await client.connections.metadata(connId, {
        parentKind: MetaNodeKind.Group,
        path: [...node.path],
        group: 'columns',
      })
      ddl = buildCreateFromColumns(conn.dialect, node.sqlName ?? node.name, cols)
    }
    if (!ddl) {
      window.alert(t('ws.noDef'))
      return
    }
    await navigator.clipboard?.writeText(ddl)
    window.alert(t('ws.ddlCopied'))
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

async function onToggleFavorite(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  toggleFavorite({
    connId,
    connName: conn.name || t('common.untitled'),
    dialect: conn.dialect,
    schema: ctx.schema ?? ctx.database ?? '',
    name: node.name,
    sqlName: node.sqlName ?? node.name,
    kind: node.kind,
  })
}

// 收藏夹点击：对象 → 定位 + 查询前 200 行；查询 → 在该连接以草稿打开 SQL
async function onFavoriteOpen(fav: Favorite): Promise<void> {
  shortcutsOpen.value = false
  favoritesOpen.value = false
  const conn = await client.connections.get(fav.connId)
  if (fav.kind === 'query') {
    tabsRef.value?.openDraft(conn, fav.sqlName, fav.name)
    return
  }
  await navRef.value?.revealObject(fav.connId, fav.schema, fav.name)
  tabsRef.value?.runSql(conn, previewSql(conn.dialect, fav.sqlName, 200))
}

// 生成数据字典（Markdown）：迭代库/schema 下所有表的列信息
async function genDataDict(connId: string, node: TreeNode, format: 'md' | 'html'): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = erdContext(conn.dialect, node)
  try {
    const tables = await client.connections.metadata(connId, {
      parentKind: MetaNodeKind.Group,
      path: [...node.path],
      group: 'tables',
    })
    if (!tables.length) {
      window.alert(t('ws.noTables'))
      return
    }
    const withCols: { name: string; columns: typeof tables }[] = []
    for (const tbl of tables) {
      const cols = await client.connections.metadata(connId, {
        parentKind: MetaNodeKind.Group,
        path: [...tbl.path],
        group: 'columns',
      })
      withCols.push({ name: tbl.name, columns: cols })
    }
    const label = ctx.schema || ctx.database || 'schema'
    const isHtml = format === 'html'
    await client.files.saveText({
      defaultName: `${label}-data-dict.${format}`,
      content: isHtml ? buildDataDictHtml(label, withCols) : buildDataDictMarkdown(label, withCols),
      filters: [{ name: isHtml ? 'HTML' : 'Markdown', extensions: [format] }],
    })
  } catch (e) {
    window.alert(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}
const onDataDict = (connId: string, node: TreeNode) => genDataDict(connId, node, 'md')
const onDataDictHtml = (connId: string, node: TreeNode) => genDataDict(connId, node, 'html')

function onDepReveal(table: string): void {
  const d = deps.value
  if (!d) return
  void navRef.value?.revealObject(d.connId, d.schema, table)
  deps.value = null
}

// 编辑视图/函数/存储过程 → 载入定义后开 DDL 编辑器 Tab
async function onEditObject(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  tabsRef.value?.editObject(conn, node.kind as ObjectKind, ctx, node)
}

// 复制视图/函数/存储过程/触发器的 DDL 到剪贴板（统一入口；走 objectDdlQuery 同样的拉取路径）
async function onCopyObjectDdl(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  const kind = node.kind as ObjectKind
  const q = objectDdlQuery(conn.dialect, kind, objectRef(conn.dialect, node))
  if (!q) {
    window.alert(t('ws.noDef'))
    return
  }
  try {
    const r = await client.connections.execute(connId, q.sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    const row = (r.rows[0] as Record<string, unknown> | undefined) ?? {}
    let ddl = ''
    if (q.mode === 'showCreate') {
      const key = Object.keys(row).find((k) => /^create/i.test(k))
      ddl = String(row[key ?? ''] ?? '')
    } else if (q.mode === 'viewdef') {
      ddl = (q.prefix ?? '') + String(row.ddl ?? '')
    } else {
      ddl = String(row.ddl ?? '')
    }
    if (!ddl) {
      window.alert(t('ws.noDef'))
      return
    }
    await navigator.clipboard?.writeText(ddl)
    window.alert(t('ws.ddlCopied'))
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// ── 表数据/结构操作 ──

/** 清空表：DELETE FROM x；事务安全，可回滚，触发 ON DELETE 触发器（高危，二次确认）。 */
async function onEmptyTable(connId: string, node: TreeNode): Promise<void> {
  const ref = node.sqlName ?? node.name
  if (!window.confirm(t('ws.confirmEmptyTable', { ref }))) return
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  try {
    await client.connections.execute(connId, `DELETE FROM ${ref}`, [], { database: ctx.database, schema: ctx.schema })
    window.alert(t('ws.emptyTableDone', { ref }))
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 截断表：TRUNCATE TABLE x；极快、重置自增、不进 binlog 行模式、DDL 不可回滚。 */
async function onTruncateTable(connId: string, node: TreeNode): Promise<void> {
  const ref = node.sqlName ?? node.name
  if (!window.confirm(t('ws.confirmTruncateTable', { ref }))) return
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  try {
    await client.connections.execute(connId, `TRUNCATE TABLE ${ref}`, [], { database: ctx.database, schema: ctx.schema })
    window.alert(t('ws.truncateTableDone', { ref }))
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 重命名表：弹窗输入新名 → 方言对应 RENAME（MySQL: RENAME TABLE old TO new；PG/MSSQL: ALTER TABLE old RENAME TO new；Oracle: ALTER TABLE old RENAME TO new）。 */
async function onRenameTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const newName = window.prompt(t('ws.renamePrompt', { name: node.name }), node.name)
  if (!newName || !newName.trim() || newName.trim() === node.name) return
  const ctx = deriveContext(conn.dialect, node)
  const ref = node.sqlName ?? node.name
  const newQuoted = quoteId(conn.dialect, newName.trim())
  const sql = ['mysql', 'mariadb', 'oceanbase'].includes(conn.dialect)
    ? `RENAME TABLE ${ref} TO ${newQuoted}`
    : `ALTER TABLE ${ref} RENAME TO ${newQuoted}`
  try {
    await client.connections.execute(connId, sql, [], { database: ctx.database, schema: ctx.schema })
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 复制表：仅结构 / 结构+数据。生成的 SQL 在草稿查询页打开（让用户检查/调整后再执行）。 */
async function onCopyTable(connId: string, node: TreeNode, withData: boolean): Promise<void> {
  const conn = await client.connections.get(connId)
  const newName = window.prompt(t('ws.copyTablePrompt', { name: node.name }), `${node.name}_copy`)
  if (!newName || !newName.trim()) return
  const ref = node.sqlName ?? node.name
  const newQuoted = quoteId(conn.dialect, newName.trim())
  const fam = ['mysql', 'mariadb', 'oceanbase'].includes(conn.dialect)
    ? 'mysql'
    : ['postgresql', 'kingbase'].includes(conn.dialect)
      ? 'pg'
      : 'other'
  const lines: string[] = []
  if (fam === 'mysql') {
    lines.push(`CREATE TABLE ${newQuoted} LIKE ${ref};`)
    if (withData) lines.push(`INSERT INTO ${newQuoted} SELECT * FROM ${ref};`)
  } else if (fam === 'pg') {
    lines.push(`CREATE TABLE ${newQuoted} (LIKE ${ref} INCLUDING ALL);`)
    if (withData) lines.push(`INSERT INTO ${newQuoted} SELECT * FROM ${ref};`)
  } else {
    // 其它方言：用 SELECT ... INTO 之类近似（不同方言差异大，统一走 CREATE TABLE AS）
    lines.push(`CREATE TABLE ${newQuoted} AS SELECT * FROM ${ref}${withData ? '' : ' WHERE 1=0'};`)
  }
  tabsRef.value?.openDraft(conn, lines.join('\n'), t('ws.copyTableTabTitle', { name: newName.trim() }))
}

/** 切换连接的「生产环境」标记（extra.env: 'prod' ↔ undefined），保存后刷新导航树。 */
async function onToggleProdMark(connId: string): Promise<void> {
  const cfg = await client.connections.get(connId)
  const { env: _drop, ...restExtra } = (cfg.extra ?? {}) as Record<string, unknown>
  const extra =
    _drop === 'prod' ? restExtra : { ...restExtra, env: 'prod' as const }
  await client.connections.update({ ...cfg, extra: Object.keys(extra).length ? extra : undefined })
  await navRef.value?.reload()
}

// ER 图 → 开 ER 图 Tab（按库/schema 节点推断目标）
async function onOpenErd(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openErd(conn, erdContext(conn.dialect, node), node)
}

// 查看触发器/序列定义 → 取定义填入查询页（可改后手动执行）
async function onViewDefinition(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const f = definitionQuery(conn.dialect, node)
  if (!f) {
    window.alert(t('ws.defUnsupported'))
    return
  }
  const ctx = deriveContext(conn.dialect, node)
  try {
    const r = await client.connections.execute(connId, f.sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    const row = r.rows[0] as Record<string, unknown> | undefined
    if (!row) {
      window.alert(t('ws.noDef'))
      return
    }
    tabsRef.value?.openDraft(conn, extractDefinition(conn.dialect, node, f.mode, row), t('ws.tabDef', { name: node.name }))
  } catch (e) {
    window.alert(t('ws.viewDefFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 生成 SQL 模板（SELECT/INSERT/UPDATE/DELETE）→ 取列后填入查询页草稿
async function onGenerateSql(
  kind: SqlTemplateKind,
  connId: string,
  node: TreeNode,
): Promise<void> {
  const conn = await client.connections.get(connId)
  try {
    const cols = await client.connections.metadata(connId, {
      parentKind: MetaNodeKind.Group,
      path: [...node.path],
      group: 'columns',
    })
    const colInfo = cols.map((c) => ({ name: c.name, pk: !!c.detail?.primaryKey }))
    const sql = buildSqlTemplate(conn.dialect, kind, node.sqlName ?? node.name, colInfo)
    tabsRef.value?.openDraft(conn, sql, `${node.name} · ${kind.toUpperCase()}`)
  } catch (e) {
    window.alert(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 导入数据（CSV → 表）→ 弹导入对话框
async function onImportData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  importing.value = { connId, node, dialect: conn.dialect, ctx: deriveContext(conn.dialect, node) }
}

// 导出：先弹「仅结构 / 结构+数据」选项，再执行
const exportReq = ref<{ scope: 'table' | 'schema'; connId: string; node: TreeNode } | null>(null)
function onExportSql(connId: string, node: TreeNode): void {
  exportReq.value = { scope: 'table', connId, node }
}
function onExportSchemaSql(connId: string, node: TreeNode): void {
  exportReq.value = { scope: 'schema', connId, node }
}
async function onExportPick(withData: boolean): Promise<void> {
  const req = exportReq.value
  exportReq.value = null
  if (!req) return
  if (!client.files) {
    window.alert(t('erd.fileNotReady'))
    return
  }
  if (req.scope === 'table') await doTableExport(req.connId, req.node, withData)
  else await doSchemaExport(req.connId, req.node, withData)
}

async function doTableExport(connId: string, node: TreeNode, withData: boolean): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  const ref = node.sqlName ?? node.name
  try {
    const cols = await client.connections.metadata(connId, {
      parentKind: MetaNodeKind.Group,
      path: [...node.path],
      group: 'columns',
    })
    const rows = withData
      ? (await client.connections.execute(connId, `SELECT * FROM ${ref}`, [], {
          database: ctx.database,
          schema: ctx.schema,
        })).rows
      : []
    const sql = buildTableDump(conn.dialect, ref, cols, rows, withData)
    await client.files.saveText({
      defaultName: `${node.name}.sql`,
      content: sql,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    window.alert(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 导出整库/schema 为 SQL（迭代所有表）
async function doSchemaExport(connId: string, node: TreeNode, withData: boolean): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = erdContext(conn.dialect, node)
  try {
    const tables = await client.connections.metadata(connId, {
      parentKind: MetaNodeKind.Group,
      path: [...node.path],
      group: 'tables',
    })
    if (!tables.length) {
      window.alert(t('ws.noTables'))
      return
    }
    const parts: string[] = []
    for (const tbl of tables) {
      const cols = await client.connections.metadata(connId, {
        parentKind: MetaNodeKind.Group,
        path: [...tbl.path],
        group: 'columns',
      })
      const ref = tbl.sqlName ?? tbl.name
      const rows = withData
        ? (await client.connections.execute(connId, `SELECT * FROM ${ref}`, [], {
            database: ctx.database,
            schema: ctx.schema,
          })).rows
        : []
      parts.push(buildTableDump(conn.dialect, ref, cols, rows, withData))
    }
    const label = ctx.schema || ctx.database || 'schema'
    await client.files.saveText({
      defaultName: `${label}.sql`,
      content: `${t('ws.dumpHeader', { label, n: tables.length })}\n\n${parts.join('\n\n')}`,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    window.alert(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 数据传输 → 弹对话框
async function onTransferData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  transferring.value = { connId, node, dialect: conn.dialect, ctx: deriveContext(conn.dialect, node) }
}
function onTransferDone(count: number): void {
  transferring.value = null
  window.alert(t('ws.transferDone', { count }))
}

function onImportDone(count: number): void {
  const imp = importing.value
  importing.value = null
  if (imp) {
    navRef.value?.refreshNode(imp.node, imp.connId)
    window.alert(t('ws.importDone', { count, name: imp.node.name }))
  }
}

// 删除对象 → 弹二次确认
async function onDropObject(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  if (!buildDrop(conn.dialect, node)) return // 不可删除的节点
  dropConfirm.value = {
    connId,
    node,
    dialect: conn.dialect,
    label: t(`obj.${node.kind}`),
    cascade: false,
    busy: false,
    error: null,
  }
}

async function confirmDrop(): Promise<void> {
  const d = dropConfirm.value
  const r = dropResult.value
  if (!d || !r) return
  d.busy = true
  d.error = null
  try {
    await client.connections.execute(d.connId, r.sql, [], {
      database: r.ctx.database,
      schema: r.ctx.schema,
    })
    const parent = d.node.parent
    dropConfirm.value = null
    if (parent) navRef.value?.refreshNode(parent, d.connId)
  } catch (e) {
    d.error = e instanceof Error ? e.message : String(e)
    d.busy = false
  }
}

// 批量删除：解析各对象的方言（按连接缓存），过滤不可删除项后弹一次确认
async function onBulkDrop(items: { connId: string; node: TreeNode }[]): Promise<void> {
  const connCache = new Map<string, ConnectionConfig>()
  const resolved: { connId: string; node: TreeNode; dialect: DbDialect }[] = []
  for (const it of items) {
    let conn = connCache.get(it.connId)
    if (!conn) {
      conn = await client.connections.get(it.connId)
      connCache.set(it.connId, conn)
    }
    if (!buildDrop(conn.dialect, it.node)) continue // 跳过不可删除的节点
    resolved.push({ connId: it.connId, node: it.node, dialect: conn.dialect })
  }
  if (!resolved.length) return
  bulkDropState.value = { items: resolved, cascade: false, busy: false, done: 0, error: null }
}

// 顺序执行批量删除；中途失败保留进度（done）便于「继续」重试
async function confirmBulkDrop(): Promise<void> {
  const b = bulkDropState.value
  if (!b) return
  b.busy = true
  b.error = null
  const parents = new Map<TreeNode, string>()
  try {
    for (let i = b.done; i < b.items.length; i++) {
      const it = b.items[i]
      const r = buildDrop(it.dialect, it.node, b.cascade)
      if (!r) {
        b.done = i + 1
        continue
      }
      await client.connections.execute(it.connId, r.sql, [], {
        database: r.ctx.database,
        schema: r.ctx.schema,
      })
      b.done = i + 1
      if (it.node.parent) parents.set(it.node.parent, it.connId)
    }
    bulkDropState.value = null
    navRef.value?.clearMulti()
    for (const [parent, connId] of parents) navRef.value?.refreshNode(parent, connId)
  } catch (e) {
    b.error = e instanceof Error ? e.message : String(e)
    b.busy = false
  }
}

async function onSaved(conn: ConnectionConfig): Promise<void> {
  editing.value = null
  await navRef.value?.reload()
  tabsRef.value?.openConnection(conn)
}

async function onDeleted(id: string): Promise<void> {
  editing.value = null
  await navRef.value?.reload()
  tabsRef.value?.closeConnTabs(id)
}

function onCancel(): void {
  editing.value = null
}

// ── 设置中心 ──
const settingsOpen = ref(false)
const schemaDiffOpen = ref(false)
const privilegesOpen = ref(false)
const dataDiffOpen = ref(false)
const objectSearchOpen = ref(false)
const shortcutsOpen = ref(false)
const favoritesOpen = ref(false)
const collapsedFavGroups = ref(new Set<string>())
const favoriteGroups = computed(() => {
  const map = new Map<string, Favorite[]>()
  for (const f of favorites) {
    const tag = f.tags?.[0] ?? ''
    if (!map.has(tag)) map.set(tag, [])
    map.get(tag)?.push(f)
  }
  // 未分组的放最后；其余按标签字典序
  const tagged = [...map.keys()].filter((k) => k).sort()
  const ordered = [...tagged, ...(map.has('') ? [''] : [])]
  return ordered.map((tag) => ({ tag, items: map.get(tag) ?? [] }))
})
function toggleFavGroup(tag: string): void {
  const next = new Set(collapsedFavGroups.value)
  if (next.has(tag)) next.delete(tag)
  else next.add(tag)
  collapsedFavGroups.value = next
}
function editFavTag(f: Favorite): void {
  const next = window.prompt(t('ws.favoritesEditTag'), f.tags?.[0] ?? '')
  if (next == null) return
  setFavoriteTag(f.id, next)
}
const opLogOpen = ref(false)
const monitorOpen = ref(false)
const aiState = ref<{ mode: AiMode; sql?: string; connId?: string; error?: string } | null>(null)
const aboutOpen = ref(false)
const APP_VERSION = '0.1.0'
const updateState = ref<{ checking: boolean; latest?: string; error?: string }>({ checking: false })
async function checkForUpdate(): Promise<void> {
  updateState.value = { checking: true }
  try {
    const res = await fetch('https://api.github.com/repos/duhbbx/SkylerX/releases/latest', {
      headers: { accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; name?: string }
    const latest = (data.tag_name ?? data.name ?? '').replace(/^v/, '')
    updateState.value = { checking: false, latest }
  } catch (e) {
    updateState.value = { checking: false, error: e instanceof Error ? e.message : String(e) }
  }
}
// 快捷键参考表
const SHORTCUTS: { k: string; label: string }[] = [
  { k: '⌘/Ctrl + K', label: t('pal.objectSearch') },
  { k: '⌘/Ctrl + ⇧ + O', label: t('osearch.title') },
  { k: '⌘/Ctrl + Enter', label: t('query.run') },
  { k: '⌘/Ctrl + ⇧ + F', label: t('query.format') },
  { k: '⌘/Ctrl + /', label: '注释 / Comment' },
  { k: '⌘/Ctrl + F / H', label: '查找 / 替换' },
  { k: 'F11', label: '全屏 / Full screen' },
  { k: '⌘/Ctrl + + / − / 0', label: t('settings.zoom') },
]
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.()
}

// 全局对象搜索命中 → 在该连接「查询前 200 行」
async function onSearchPreview(connId: string, qualified: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, previewSql(conn.dialect, qualified, 200))
}

// 全局对象搜索命中 → 在导航树中展开并选中该对象
async function onSearchReveal(connId: string, schema: string, table: string): Promise<void> {
  await navRef.value?.revealObject(connId, schema, table)
}

// 结构对比生成的迁移 SQL → 在目标连接开一个草稿查询页
async function onDiffOpenSql(connId: string, sql: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openDraft(conn, sql, t('ws.tabMigration'))
}

// AI 助手生成的 SQL → 在所选连接开一个草稿查询页
async function onAiInsert(sql: string, connId: string): Promise<void> {
  aiState.value = null
  const conn = await client.connections.get(connId)
  tabsRef.value?.openDraft(conn, sql, t('ai.tabTitle'))
}

// QueryPane 工具栏「AI」按钮：有错误→诊断，否则→解释当前 SQL
function onAiFromPane(sql: string, connId: string, errMsg: string): void {
  aiState.value = {
    mode: errMsg ? 'diagnose' : 'explain',
    sql,
    connId,
    error: errMsg || undefined,
  }
}

// ── ⌘K 命令面板 ──
const paletteOpen = ref(false)
const paletteConns = ref<ConnectionConfig[]>([])

const paletteItems = computed<PaletteItem[]>(() => [
  { id: 'act:new-conn', label: t('pal.newConn'), group: t('pal.groupActions') },
  { id: 'act:object-search', label: t('pal.objectSearch'), group: t('pal.groupActions') },
  { id: 'act:schema-diff', label: t('pal.schemaDiff'), group: t('pal.groupActions') },
  { id: 'act:data-diff', label: t('pal.dataDiff'), group: t('pal.groupActions') },
  { id: 'act:privileges', label: t('pal.privileges'), group: t('pal.groupActions') },
  { id: 'act:settings', label: t('pal.settings'), group: t('pal.groupActions') },
  { id: 'act:export-conns', label: t('pal.exportConns'), group: t('pal.groupActions') },
  { id: 'act:import-conns', label: t('pal.importConns'), group: t('pal.groupActions') },
  { id: 'act:refresh', label: t('pal.refresh'), group: t('pal.groupActions') },
  { id: 'act:favorites', label: t('pal.favorites'), group: t('pal.groupActions') },
  { id: 'act:oplog', label: t('pal.oplog'), group: t('pal.groupActions') },
  { id: 'act:monitor', label: t('pal.monitor'), group: t('pal.groupActions') },
  { id: 'act:ai', label: t('pal.ai'), group: t('pal.groupActions') },
  { id: 'act:about', label: t('pal.about'), group: t('pal.groupActions') },
  { id: 'act:shortcuts', label: t('pal.shortcuts'), group: t('pal.groupActions') },
  ...paletteConns.value.map((c) => ({
    id: `conn:${c.id}`,
    label: c.name || t('common.untitled'),
    hint: c.dialect,
    group: t('pal.groupConns'),
  })),
])

async function openPalette(): Promise<void> {
  paletteConns.value = await client.connections.list()
  paletteOpen.value = true
}

async function onPaletteSelect(item: PaletteItem): Promise<void> {
  paletteOpen.value = false
  if (item.id === 'act:new-conn') onNew()
  else if (item.id === 'act:object-search') objectSearchOpen.value = true
  else if (item.id === 'act:schema-diff') schemaDiffOpen.value = true
  else if (item.id === 'act:data-diff') dataDiffOpen.value = true
  else if (item.id === 'act:privileges') privilegesOpen.value = true
  else if (item.id === 'act:settings') settingsOpen.value = true
  else if (item.id === 'act:export-conns') await exportConns()
  else if (item.id === 'act:import-conns') await importConns()
  else if (item.id === 'act:refresh') await navRef.value?.reload()
  else if (item.id === 'act:favorites') favoritesOpen.value = true
  else if (item.id === 'act:oplog') opLogOpen.value = true
  else if (item.id === 'act:monitor') monitorOpen.value = true
  else if (item.id === 'act:ai') aiState.value = { mode: 'nl2sql' }
  else if (item.id === 'act:about') aboutOpen.value = true
  else if (item.id === 'act:shortcuts') shortcutsOpen.value = true
  else if (item.id.startsWith('conn:')) await onSelectConn(item.id.slice(5))
}

// 连接配置导入/导出（不含密码，迁移/备份用）
async function exportConns(): Promise<void> {
  const conns = await client.connections.list()
  await client.files.saveText({
    defaultName: 'skylerx-connections.json',
    content: JSON.stringify(conns, null, 2),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
}
async function importConns(): Promise<void> {
  const f = await client.files.openText([{ name: 'JSON', extensions: ['json'] }])
  if (!f) return
  try {
    const arr = JSON.parse(f.content) as ConnectionConfig[]
    let n = 0
    for (const c of arr) {
      try {
        await client.connections.create({ ...c, id: '' })
        n++
      } catch {
        /* 跳过无效条目 */
      }
    }
    await navRef.value?.reload()
    window.alert(t('ws.importConnsResult', { n }))
  } catch (e) {
    window.alert(t('ws.importConnsFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (paletteOpen.value) paletteOpen.value = false
    else void openPalette()
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
    // ⌘/Ctrl+Shift+O：全局对象搜索
    e.preventDefault()
    objectSearchOpen.value = true
  } else if (e.key === 'F11') {
    e.preventDefault()
    toggleFullscreen()
  } else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault()
    zoomIn()
  } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
    e.preventDefault()
    zoomOut()
  } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
    e.preventDefault()
    zoomReset()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <NavTree
    ref="navRef"
    @new-conn="onNew"
    @edit-conn="onEditConn"
    @select-conn="onSelectConn"
    @new-query="onNewQuery"
    @delete-conn="onDeleteConn"
    @run-sql="onRunSql"
    @conn-error="onConnError"
    @new-object="onNewObject"
    @drop-object="onDropObject"
    @view-structure="onViewStructure"
    @preview-table="onPreviewTable"
    @design-table="onDesignTable"
    @table-stats="onTableStats"
    @mock-data="onMockData"
    @deps="onDeps"
    @copy-ddl="onCopyDdl"
    @toggle-favorite="onToggleFavorite"
    @data-dict="onDataDict"
    @data-dict-html="onDataDictHtml"
    @edit-object="onEditObject"
    @copy-object-ddl="onCopyObjectDdl"
    @empty-table="onEmptyTable"
    @truncate-table="onTruncateTable"
    @rename-table="onRenameTable"
    @copy-table="onCopyTable"
    @toggle-prod-mark="onToggleProdMark"
    @view-definition="onViewDefinition"
    @generate-sql="onGenerateSql"
    @open-erd="onOpenErd"
    @import-data="onImportData"
    @export-sql="onExportSql"
    @export-schema-sql="onExportSchemaSql"
    @transfer-data="onTransferData"
    @bulk-drop="onBulkDrop"
    @open-settings="settingsOpen = true"
  />

  <main class="main">
    <QueryTabs ref="tabsRef" @conn-error="onConnError" @refresh="onTreeRefresh" @ai="onAiFromPane" />
  </main>

  <Modal
    v-if="editing"
    :title="editing.connId ? t('ws.titleEditConn') : t('ws.titleNewConn')"
    @close="onCancel"
  >
    <ConnectionForm
      :conn-id="editing.connId"
      :initial-error="editing.error"
      @saved="onSaved"
      @deleted="onDeleted"
      @cancel="onCancel"
    />
  </Modal>

  <Modal v-if="dropConfirm" :title="t('ws.dropTitle')" @close="dropConfirm = null">
    <div class="confirm">
      <p>{{ t('ws.dropMsg', { label: dropConfirm.label, name: dropConfirm.node.name }) }}</p>
      <label v-if="dropCascadeApplicable" class="cascade">
        <input v-model="dropConfirm.cascade" type="checkbox" />
        {{ t('ws.cascade') }}
      </label>
      <pre class="confirm-sql">{{ dropResult?.sql }}</pre>
      <div v-if="dropConfirm.error" class="banner err">✗ {{ dropConfirm.error }}</div>
      <div class="actions">
        <button class="danger" :disabled="dropConfirm.busy" @click="confirmDrop">
          {{ dropConfirm.busy ? t('ws.deleting') : t('common.delete') }}
        </button>
        <button class="ghost" @click="dropConfirm = null">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </Modal>

  <Modal v-if="bulkDropState" :title="t('ws.bulkDropTitle')" @close="bulkDropState = null">
    <div class="confirm">
      <p>{{ t('ws.bulkDropMsg', { n: bulkDropState.items.length }) }}</p>
      <ul class="bulk-list">
        <li v-for="(it, i) in bulkDropState.items" :key="i" :class="{ gone: i < bulkDropState.done }">
          {{ t(`obj.${it.node.kind}`) }} · {{ it.node.sqlName ?? it.node.name }}
        </li>
      </ul>
      <label class="cascade">
        <input v-model="bulkDropState.cascade" type="checkbox" />
        {{ t('ws.cascadeBulk') }}
      </label>
      <div v-if="bulkDropState.error" class="banner err">
        {{ t('ws.bulkErr', { done: bulkDropState.done, total: bulkDropState.items.length, msg: bulkDropState.error }) }}
      </div>
      <div class="actions">
        <button class="danger" :disabled="bulkDropState.busy" @click="confirmBulkDrop">
          {{
            bulkDropState.busy
              ? t('ws.bulkDeleting', { done: bulkDropState.done, total: bulkDropState.items.length })
              : bulkDropState.error
                ? t('ws.bulkContinue')
                : t('ws.bulkDeleteN', { n: bulkDropState.items.length })
          }}
        </button>
        <button class="ghost" @click="bulkDropState = null">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </Modal>

  <ImportDialog
    v-if="importing"
    :conn-id="importing.connId"
    :dialect="importing.dialect"
    :ctx="importing.ctx"
    :node="importing.node"
    @done="onImportDone"
    @close="importing = null"
  />

  <CommandPalette
    v-if="paletteOpen"
    :items="paletteItems"
    @select="onPaletteSelect"
    @close="paletteOpen = false"
  />

  <DataTransferDialog
    v-if="transferring"
    :conn-id="transferring.connId"
    :dialect="transferring.dialect"
    :node="transferring.node"
    :ctx="transferring.ctx"
    @done="onTransferDone"
    @close="transferring = null"
  />

  <ExportOptionsDialog
    v-if="exportReq"
    :title="exportReq.scope === 'schema' ? t('ws.exportSchemaTitle', { name: exportReq.node.name }) : t('ws.exportTableTitle', { name: exportReq.node.name })"
    @pick="onExportPick"
    @close="exportReq = null"
  />

  <Modal v-if="deps" :title="t('ws.depsTitle', { name: deps.name })" @close="deps = null">
    <div class="confirm">
      <div v-if="deps.error" class="banner err">✗ {{ deps.error }}</div>
      <template v-else>
        <div class="dep-sec">{{ t('ws.depsOut') }}</div>
        <div v-if="!deps.out.length" class="dep-empty">{{ t('ws.depsNone') }}</div>
        <div v-for="(d, i) in deps.out" :key="'o' + i" class="dep-row" @click="onDepReveal(d.table)">
          → <b>{{ d.table }}</b> <span class="dep-cols">({{ d.cols }})</span>
        </div>
        <div class="dep-sec">{{ t('ws.depsIn') }}</div>
        <div v-if="!deps.inc.length" class="dep-empty">{{ t('ws.depsNone') }}</div>
        <div v-for="(d, i) in deps.inc" :key="'i' + i" class="dep-row" @click="onDepReveal(d.table)">
          ← <b>{{ d.table }}</b> <span class="dep-cols">({{ d.cols }})</span>
        </div>
        <p class="dep-foot">{{ t('ws.depsFoot') }}</p>
      </template>
    </div>
  </Modal>

  <Modal v-if="tableStats" :title="t('ws.statsTitle', { name: tableStats.name })" @close="tableStats = null">
    <div class="confirm">
      <div v-if="tableStats.error" class="banner err">✗ {{ tableStats.error }}</div>
      <template v-else-if="tableStats.stats">
        <div class="kv-row"><span>{{ t('ws.statsRows') }}</span><b>{{ tableStats.stats.rows.toLocaleString() }}</b></div>
        <div class="kv-row"><span>{{ t('ws.statsData') }}</span><b>{{ tableStats.fmt(tableStats.stats.dataBytes) }}</b></div>
        <div class="kv-row"><span>{{ t('ws.statsIndex') }}</span><b>{{ tableStats.fmt(tableStats.stats.indexBytes) }}</b></div>
        <div class="kv-row total">
          <span>{{ t('ws.statsTotal') }}</span><b>{{ tableStats.fmt(tableStats.stats.dataBytes + tableStats.stats.indexBytes) }}</b>
        </div>
      </template>
      <div v-else class="banner">{{ t('common.loading') }}</div>
    </div>
  </Modal>

  <Modal v-if="favoritesOpen" :title="t('ws.favoritesTitle')" @close="favoritesOpen = false">
    <div class="fav-list">
      <div v-if="!favorites.length" class="fav-empty">{{ t('ws.favoritesEmpty') }}</div>
      <template v-for="g in favoriteGroups" :key="g.tag">
        <div class="fav-group" @click="toggleFavGroup(g.tag)">
          <span class="fav-caret">{{ collapsedFavGroups.has(g.tag) ? '▸' : '▾' }}</span>
          <span class="fav-gname">{{ g.tag || t('ws.favoritesUntagged') }}</span>
          <span class="fav-gcount">{{ g.items.length }}</span>
        </div>
        <template v-if="!collapsedFavGroups.has(g.tag)">
          <div v-for="f in g.items" :key="f.id" class="fav-row" @click="onFavoriteOpen(f)">
            <span class="fav-icon">{{ f.kind === 'view' ? '👁' : f.kind === 'query' ? '★' : '▦' }}</span>
            <span class="fav-name">{{ f.name }}</span>
            <span class="fav-meta">{{ f.connName }}<template v-if="f.schema"> · {{ f.schema }}</template></span>
            <button class="fav-del" :title="t('ws.favoritesEditTag')" @click.stop="editFavTag(f)">✎</button>
            <button class="fav-del" :title="t('common.remove')" @click.stop="removeFavorite(f.id)">✕</button>
          </div>
        </template>
      </template>
    </div>
  </Modal>

  <Modal v-if="shortcutsOpen" :title="t('ws.shortcutsTitle')" @close="shortcutsOpen = false">
    <table class="sc-table">
      <thead>
        <tr><th>{{ t('ws.scAction') }}</th><th>{{ t('ws.scKey') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in SHORTCUTS" :key="s.k">
          <td>{{ s.label }}</td>
          <td><kbd>{{ s.k }}</kbd></td>
        </tr>
      </tbody>
    </table>
  </Modal>

  <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />

  <SchemaDiffDialog
    v-if="schemaDiffOpen"
    @open-sql="onDiffOpenSql"
    @close="schemaDiffOpen = false"
  />

  <ObjectSearchDialog
    v-if="objectSearchOpen"
    @reveal="onSearchReveal"
    @preview="onSearchPreview"
    @close="objectSearchOpen = false"
  />

  <DataDiffDialog
    v-if="dataDiffOpen"
    @open-sql="onDiffOpenSql"
    @close="dataDiffOpen = false"
  />

  <PrivilegesDialog
    v-if="privilegesOpen"
    @open-sql="onDiffOpenSql"
    @close="privilegesOpen = false"
  />

  <OperationLogDialog
    v-if="opLogOpen"
    @open-sql="onDiffOpenSql"
    @close="opLogOpen = false"
  />

  <ServerMonitorDialog v-if="monitorOpen" @close="monitorOpen = false" />

  <Modal v-if="aboutOpen" :title="t('about.title')" @close="aboutOpen = false">
    <div class="about">
      <div class="about-brand">SkylerX</div>
      <div class="about-tag">{{ t('about.tag') }}</div>
      <div class="about-rows">
        <div class="about-row"><span>{{ t('about.version') }}</span><b>{{ APP_VERSION }}</b></div>
        <div class="about-row"><span>{{ t('about.license') }}</span><b>Apache-2.0</b></div>
        <div class="about-row">
          <span>{{ t('about.repo') }}</span>
          <a href="https://github.com/duhbbx/SkylerX" target="_blank" rel="noopener">github.com/duhbbx/SkylerX</a>
        </div>
        <div class="about-row">
          <span>{{ t('about.issues') }}</span>
          <a href="https://github.com/duhbbx/SkylerX/issues" target="_blank" rel="noopener">{{ t('about.fileIssue') }}</a>
        </div>
        <div class="about-row">
          <span>{{ t('about.update') }}</span>
          <span class="upd-cell">
            <button class="ghost" :disabled="updateState.checking" @click="checkForUpdate">
              {{ updateState.checking ? t('about.checking') : t('about.check') }}
            </button>
            <template v-if="updateState.error">
              <span class="upd-err">{{ updateState.error }}</span>
            </template>
            <template v-else-if="updateState.latest">
              <span v-if="updateState.latest === APP_VERSION" class="upd-ok">{{ t('about.upToDate') }}</span>
              <a
                v-else
                :href="`https://github.com/duhbbx/SkylerX/releases/tag/v${updateState.latest}`"
                target="_blank"
                rel="noopener"
              >{{ t('about.newer', { v: updateState.latest }) }}</a>
            </template>
          </span>
        </div>
      </div>
    </div>
  </Modal>

  <AiAssistantDialog
    v-if="aiState"
    :initial-mode="aiState.mode"
    :initial-sql="aiState.sql"
    :initial-conn-id="aiState.connId"
    :initial-error="aiState.error"
    @insert="onAiInsert"
    @open-settings="settingsOpen = true"
    @close="aiState = null"
  />
</template>

<style scoped>
.confirm p {
  margin: 0 0 12px;
  font-size: 14px;
}
.confirm .cascade {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 12px;
  cursor: pointer;
}
.confirm-sql {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  margin: 0 0 12px;
}
.bulk-list {
  max-height: 220px;
  overflow: auto;
  margin: 0 0 12px;
  padding: 8px 10px 8px 26px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.bulk-list li {
  margin: 2px 0;
}
.bulk-list li.gone {
  color: var(--muted);
  text-decoration: line-through;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 2px;
  font-size: 14px;
  border-bottom: 1px solid var(--border);
}
.kv-row span {
  color: var(--muted);
}
.kv-row.total {
  border-bottom: none;
  font-weight: 600;
}
.sc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.sc-table th {
  text-align: left;
  color: var(--muted);
  font-weight: 500;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.sc-table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
}
.sc-table tr:last-child td {
  border-bottom: none;
}
.sc-table kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-subtle, rgba(127, 127, 127, 0.08));
  white-space: nowrap;
}
.fav-list {
  min-width: 360px;
  max-height: 60vh;
  overflow-y: auto;
}
.fav-empty {
  color: var(--muted);
  padding: 16px 4px;
  text-align: center;
  font-size: 13px;
}
.fav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.fav-row:hover {
  background: rgba(124, 108, 255, 0.14);
}
.fav-icon {
  opacity: 0.8;
}
.fav-name {
  font-weight: 500;
}
.fav-meta {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.fav-del {
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.fav-del:hover {
  color: var(--err);
}
.fav-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.fav-group:hover {
  color: var(--text);
}
.fav-caret {
  width: 10px;
}
.fav-gname {
  flex: 1;
}
.fav-gcount {
  opacity: 0.7;
}
.about {
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  padding: 4px 6px 8px;
}
.about-brand {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
}
.about-tag {
  font-size: 13px;
  color: var(--muted);
}
.about-rows {
  width: 100%;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.about-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 2px;
  border-bottom: 1px solid var(--border);
}
.about-row:last-child {
  border-bottom: none;
}
.about-row span {
  color: var(--muted);
}
.about a {
  color: var(--accent, #7c6cff);
  text-decoration: none;
}
.about a:hover {
  text-decoration: underline;
}
.upd-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.upd-cell button {
  padding: 3px 10px;
  font-size: 12px;
}
.upd-ok {
  color: #4caf50;
  font-size: 12px;
}
.upd-err {
  color: var(--err, #e04050);
  font-size: 12px;
}
.dep-sec {
  font-size: 12px;
  color: var(--muted);
  margin: 10px 0 4px;
  font-weight: 600;
}
.dep-row {
  padding: 5px 8px;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-family: ui-monospace, monospace;
}
.dep-row:hover {
  background: rgba(124, 108, 255, 0.14);
}
.dep-cols {
  color: var(--muted);
  font-size: 12px;
}
.dep-empty {
  padding: 4px 8px;
  color: var(--muted);
  font-size: 13px;
}
.dep-foot {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--muted);
}
</style>

