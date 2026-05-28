<script setup lang="ts">
import {
  type ConnectionConfig,
  DbDialect,
  DbKind,
  MetaNodeKind,
  dialectKind,
} from '@db-tool/shared-types'
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { AiMode } from './ai'
import AiAssistantDialog from './components/AiAssistantDialog.vue'
import AiChatPanel from './components/AiChatPanel.vue'
import AiCommentDialog from './components/AiCommentDialog.vue'
import AiHealthCheckDialog from './components/AiHealthCheckDialog.vue'
import AiToolboxDialog from './components/AiToolboxDialog.vue'
import AppDialogs from './components/AppDialogs.vue'
import BackupRestoreDialog from './components/BackupRestoreDialog.vue'
import CommandPalette, { type PaletteItem } from './components/CommandPalette.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import DashboardDialog from './components/DashboardDialog.vue'
import DataContractDialog from './components/DataContractDialog.vue'
import DataDiffDialog from './components/DataDiffDialog.vue'
import DataFixupDialog from './components/DataFixupDialog.vue'
import DataInspectorDialog from './components/DataInspectorDialog.vue'
import DataTransferDialog from './components/DataTransferDialog.vue'
import ExportOptionsDialog from './components/ExportOptionsDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import IndexRecommenderDialog from './components/IndexRecommenderDialog.vue'
import KeyBindingsDialog from './components/KeyBindingsDialog.vue'
import LineageDialog from './components/LineageDialog.vue'
import Modal from './components/Modal.vue'
import NavTree from './components/NavTree.vue'
import NotificationSettingsDialog from './components/NotificationSettingsDialog.vue'
import ObjectSearchDialog from './components/ObjectSearchDialog.vue'
import OperationLogDialog from './components/OperationLogDialog.vue'
import PrivilegesDialog from './components/PrivilegesDialog.vue'
import QueryTabs from './components/QueryTabs.vue'
import ReplicationLagDialog from './components/ReplicationLagDialog.vue'
import RowHistoryDialog from './components/RowHistoryDialog.vue'
import SchemaDiffDialog from './components/SchemaDiffDialog.vue'
import SchemaDriftDialog from './components/SchemaDriftDialog.vue'
import SchemaSnapshotsDialog from './components/SchemaSnapshotsDialog.vue'
import SearchValueDialog from './components/SearchValueDialog.vue'
import ServerActivityDialog from './components/ServerActivityDialog.vue'
import ServerMonitorDialog from './components/ServerMonitorDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SqlTranslateDialog from './components/SqlTranslateDialog.vue'
import type { TreeNode } from './components/treeNode'
import { useDataClient } from './data-client'
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
  dropSupportsCascade,
  erdContext,
  existingForeignKeysQuery,
  extractDefinition,
  formatBytes,
  incomingForeignKeysQuery,
  objectDdlQuery,
  objectRef,
  parseTableStats,
  previewSql,
  quoteId,
  tableStatsQuery,
} from './ddl'
import { alert as appAlert, confirm as appConfirm, prompt as appPrompt, toast } from './dialog'
import {
  buildCreateFromColumns,
  buildDataDictHtml,
  buildDataDictMarkdown,
  buildTableDump,
} from './dump'
import {
  type Favorite,
  favorites,
  removeFavorite,
  setFavoriteTag,
  toggleFavorite,
} from './favorites'
import { t } from './i18n'
import { chordFromEvent, getBindings } from './keybindings'
import { buildMockInserts } from './mockgen'
import { settings, zoomIn, zoomOut, zoomReset } from './settings'

const navRef = useTemplateRef('navRef')
const tabsRef = useTemplateRef('tabsRef')
const aiChatRef = useTemplateRef('aiChatRef')

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
const importing = ref<{
  connId: string
  node: TreeNode
  dialect: DbDialect
  ctx: TableContext
} | null>(null)
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
  // NoSQL：没有「SQL 查询页」概念，按方言路由到 Mongo/Redis/ES 浏览器
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    if (conn.dialect === DbDialect.Redis && node?.kind === MetaNodeKind.Database) {
      tabsRef.value?.openRedisDb(conn, Number(node.name) || 0)
      return
    }
    if (
      conn.dialect === DbDialect.MongoDB &&
      node?.kind === MetaNodeKind.Table &&
      node.path.length >= 1
    ) {
      tabsRef.value?.openMongoCollection(conn, node.path[0], node.name)
      return
    }
    if (conn.dialect === DbDialect.Elasticsearch && node?.kind === MetaNodeKind.Table) {
      tabsRef.value?.openEsIndex(conn, node.name)
      return
    }
    toast.warn(t('ws.noSqlUnsupported') || '该方言不支持 SQL 查询')
    return
  }
  // 用触发节点所在的库/schema 作为查询上下文（找不到则查询页落默认库）
  const ctx = node ? contextOfNode(conn.dialect, node) : undefined
  tabsRef.value?.newQuery(conn, ctx)
}

async function onRunSql(connId: string, sql: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, sql)
}

async function onDeleteConn(id: string): Promise<void> {
  if (!(await appConfirm({ message: t('conn.removeConfirm'), variant: 'danger' }))) return
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
  // NoSQL 无关系型「结构」概念，Mongo collection 直接落到 MongoPane
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    if (
      conn.dialect === DbDialect.MongoDB &&
      node.kind === MetaNodeKind.Table &&
      node.path.length >= 1
    ) {
      tabsRef.value?.openMongoCollection(conn, node.path[0], node.name)
      return
    }
    if (conn.dialect === DbDialect.Redis && node.kind === MetaNodeKind.Database) {
      tabsRef.value?.openRedisDb(conn, Number(node.name) || 0)
      return
    }
    if (conn.dialect === DbDialect.Elasticsearch && node.kind === MetaNodeKind.Table) {
      tabsRef.value?.openEsIndex(conn, node.name)
      return
    }
    toast.warn('该方言不支持「查看结构」')
    return
  }
  tabsRef.value?.openStructure(conn, node)
}

// 查询前 200 行 → 按方言生成限行 SQL 并在查询页执行
async function onPreviewTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  // NoSQL 没有「SELECT ... LIMIT」概念：Mongo 当 collection 节点 → 开 MongoPane；其它 NoSQL 提示不支持
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    if (
      conn.dialect === DbDialect.MongoDB &&
      node.kind === MetaNodeKind.Table &&
      node.path.length >= 1
    ) {
      tabsRef.value?.openMongoCollection(conn, node.path[0], node.name)
      return
    }
    if (conn.dialect === DbDialect.Redis && node.kind === MetaNodeKind.Database) {
      tabsRef.value?.openRedisDb(conn, Number(node.name) || 0)
      return
    }
    if (conn.dialect === DbDialect.Elasticsearch && node.kind === MetaNodeKind.Table) {
      tabsRef.value?.openEsIndex(conn, node.name)
      return
    }
    toast.warn('该方言不支持「查询前 200 行」')
    return
  }
  tabsRef.value?.runSql(conn, previewSql(conn.dialect, node.sqlName ?? node.name, 200))
}

// 设计表（修改现有表）→ 开设计器 Tab（alter 模式，载入现有结构）
async function onDesignTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    toast.warn('该方言不支持「设计表」')
    return
  }
  const ctx = deriveContext(conn.dialect, node)
  tabsRef.value?.editTable(conn, ctx, node)
}

// 生成测试数据 → 取列信息，按类型造多行 INSERT 填入查询页（不执行）
async function onMockData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const countStr = await appPrompt({
    message: t('ws.mockPrompt', { name: node.name }),
    defaultValue: '20',
  })
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
    await appAlert({ message: t('ws.noCols'), variant: 'warn' })
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
      const r = await client.connections.execute(
        connId,
        `SHOW CREATE TABLE ${node.sqlName ?? node.name}`,
        [],
        {
          database: ctx.database,
          schema: ctx.schema,
        },
      )
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
      await appAlert({ message: t('ws.noDef'), variant: 'warn' })
      return
    }
    await navigator.clipboard?.writeText(ddl)
    toast.success(t('ws.ddlCopied'))
  } catch (e) {
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
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
      await appAlert({ message: t('ws.noTables'), variant: 'warn' })
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
    toast.error(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
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
    await appAlert({ message: t('ws.noDef'), variant: 'warn' })
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
      await appAlert({ message: t('ws.noDef'), variant: 'warn' })
      return
    }
    await navigator.clipboard?.writeText(ddl)
    toast.success(t('ws.ddlCopied'))
  } catch (e) {
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// ── 表数据/结构操作 ──

/** 清空表：DELETE FROM x；事务安全，可回滚，触发 ON DELETE 触发器（高危，二次确认）。 */
async function onEmptyTable(connId: string, node: TreeNode): Promise<void> {
  const ref = node.sqlName ?? node.name
  if (
    !(await appConfirm({
      title: t('ws.emptyTableTitle'),
      message: t('ws.confirmEmptyTable', { ref }),
      variant: 'danger',
    }))
  )
    return
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  try {
    await client.connections.execute(connId, `DELETE FROM ${ref}`, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    toast.success(t('ws.emptyTableDone', { ref }))
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 截断表：TRUNCATE TABLE x；极快、重置自增、不进 binlog 行模式、DDL 不可回滚。 */
async function onTruncateTable(connId: string, node: TreeNode): Promise<void> {
  const ref = node.sqlName ?? node.name
  if (
    !(await appConfirm({
      title: t('ws.truncateTableTitle'),
      message: t('ws.confirmTruncateTable', { ref }),
      variant: 'danger',
    }))
  )
    return
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  try {
    await client.connections.execute(connId, `TRUNCATE TABLE ${ref}`, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    toast.success(t('ws.truncateTableDone', { ref }))
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 重命名表：弹窗输入新名 → 方言对应 RENAME（MySQL: RENAME TABLE old TO new；PG/MSSQL: ALTER TABLE old RENAME TO new；Oracle: ALTER TABLE old RENAME TO new）。 */
async function onRenameTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const newName = await appPrompt({
    message: t('ws.renamePrompt', { name: node.name }),
    defaultValue: node.name,
  })
  if (!newName || !newName.trim() || newName.trim() === node.name) return
  const ctx = deriveContext(conn.dialect, node)
  const ref = node.sqlName ?? node.name
  const newQuoted = quoteId(conn.dialect, newName.trim())
  const sql = ['mysql', 'mariadb', 'oceanbase'].includes(conn.dialect)
    ? `RENAME TABLE ${ref} TO ${newQuoted}`
    : `ALTER TABLE ${ref} RENAME TO ${newQuoted}`
  try {
    await client.connections.execute(connId, sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/** 复制表：仅结构 / 结构+数据。生成的 SQL 在草稿查询页打开（让用户检查/调整后再执行）。 */
async function onCopyTable(connId: string, node: TreeNode, withData: boolean): Promise<void> {
  const conn = await client.connections.get(connId)
  const newName = await appPrompt({
    message: t('ws.copyTablePrompt', { name: node.name }),
    defaultValue: `${node.name}_copy`,
  })
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
  tabsRef.value?.openDraft(
    conn,
    lines.join('\n'),
    t('ws.copyTableTabTitle', { name: newName.trim() }),
  )
}

/**
 * 在草稿查询页用模板打开「新建序列 / 事件」SQL（PG sequence / MySQL event）。
 * 不走结构化设计器：这两类对象的字段太少且方言相关性高，让用户在 SQL 编辑器里直接调更灵活。
 */
async function onCreateTemplateDraft(
  kind: 'sequence' | 'event',
  connId: string,
  node: TreeNode,
): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  const fam = ['mysql', 'mariadb', 'oceanbase'].includes(conn.dialect)
    ? 'mysql'
    : ['postgresql', 'kingbase'].includes(conn.dialect)
      ? 'pg'
      : 'other'
  const q = (n: string) => quoteId(conn.dialect, n)
  let sql = ''
  let title = ''
  if (kind === 'sequence' && fam === 'pg') {
    const schema = ctx.schema ?? 'public'
    sql = `CREATE SEQUENCE ${q(schema)}.${q('new_sequence')}
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 9223372036854775807
  START WITH 1
  CACHE 1;`
    title = t('ws.tabNewSequence')
  } else if (kind === 'event' && fam === 'mysql') {
    sql = `CREATE EVENT ${q('new_event')}
ON SCHEDULE EVERY 1 HOUR
COMMENT 'description'
DO
BEGIN
  -- your statements;
END;`
    title = t('ws.tabNewEvent')
  } else {
    await appAlert({ message: t('ws.defUnsupported'), variant: 'warn' })
    return
  }
  tabsRef.value?.openDraft(conn, sql, title)
}

/** 切换连接的「生产环境」标记（extra.env: 'prod' ↔ undefined），保存后刷新导航树。 */
async function onToggleProdMark(connId: string): Promise<void> {
  const cfg = await client.connections.get(connId)
  const { env: _drop, ...restExtra } = (cfg.extra ?? {}) as Record<string, unknown>
  const extra = _drop === 'prod' ? restExtra : { ...restExtra, env: 'prod' as const }
  await client.connections.update({ ...cfg, extra: Object.keys(extra).length ? extra : undefined })
  await navRef.value?.reload()
}

// ER 图 → 开 ER 图 Tab（按库/schema 节点推断目标）
async function onOpenErd(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    toast.warn('该方言不支持「ER 图」')
    return
  }
  tabsRef.value?.openErd(conn, erdContext(conn.dialect, node), node)
}

// 查看触发器/序列定义 → 取定义填入查询页（可改后手动执行）
async function onViewDefinition(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const f = definitionQuery(conn.dialect, node)
  if (!f) {
    await appAlert({ message: t('ws.defUnsupported'), variant: 'warn' })
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
      await appAlert({ message: t('ws.noDef'), variant: 'warn' })
      return
    }
    tabsRef.value?.openDraft(
      conn,
      extractDefinition(conn.dialect, node, f.mode, row),
      t('ws.tabDef', { name: node.name }),
    )
  } catch (e) {
    toast.error(t('ws.viewDefFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 生成 SQL 模板（SELECT/INSERT/UPDATE/DELETE）→ 取列后填入查询页草稿
async function onGenerateSql(kind: SqlTemplateKind, connId: string, node: TreeNode): Promise<void> {
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
    toast.error(t('ws.genSqlFail', { msg: e instanceof Error ? e.message : String(e) }))
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
    await appAlert({ message: t('erd.fileNotReady'), variant: 'warn' })
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
      ? (
          await client.connections.execute(connId, `SELECT * FROM ${ref}`, [], {
            database: ctx.database,
            schema: ctx.schema,
          })
        ).rows
      : []
    const sql = buildTableDump(conn.dialect, ref, cols, rows, withData)
    await client.files.saveText({
      defaultName: `${node.name}.sql`,
      content: sql,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    toast.error(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
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
      await appAlert({ message: t('ws.noTables'), variant: 'warn' })
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
        ? (
            await client.connections.execute(connId, `SELECT * FROM ${ref}`, [], {
              database: ctx.database,
              schema: ctx.schema,
            })
          ).rows
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
    toast.error(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

// 数据传输 → 弹对话框
async function onTransferData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  transferring.value = {
    connId,
    node,
    dialect: conn.dialect,
    ctx: deriveContext(conn.dialect, node),
  }
}
function onTransferDone(count: number): void {
  transferring.value = null
  toast.success(t('ws.transferDone', { count }))
}

function onImportDone(count: number): void {
  const imp = importing.value
  importing.value = null
  if (imp) {
    navRef.value?.refreshNode(imp.node, imp.connId)
    toast.success(t('ws.importDone', { count, name: imp.node.name }))
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

// ── 连接表单：未保存关闭确认 ──
const connFormRef = useTemplateRef<{ isDirty: () => boolean } | null>('connFormRef')
/**
 * Modal beforeClose 钩子：脏表单关闭前先 confirm；
 * 返回 false 阻止关闭，true 才允许 Modal 发 close。
 */
async function confirmDiscardConnForm(): Promise<boolean> {
  if (!connFormRef.value?.isDirty()) return true
  return appConfirm({ message: t('common.unsavedConfirm'), variant: 'warn' })
}
/** Cancel 按钮也走同一道关：取消则不关；同意才置空 editing。 */
async function onCancelConn(): Promise<void> {
  if (await confirmDiscardConnForm()) editing.value = null
}

// ── 设置中心 ──
const settingsOpen = ref(false)
const settingsInitialSection = ref<'general' | 'editor' | 'grid' | 'watermark' | 'ai'>('general')
function openSettingsAtAi(): void {
  settingsInitialSection.value = 'ai'
  settingsOpen.value = true
}
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
async function editFavTag(f: Favorite): Promise<void> {
  const next = await appPrompt({
    message: t('ws.favoritesEditTag'),
    defaultValue: f.tags?.[0] ?? '',
  })
  if (next == null) return
  setFavoriteTag(f.id, next)
}
const opLogOpen = ref(false)
const monitorOpen = ref(false)
/** 「服务器活动」（进程 / 长事务 / 锁等待）：右键连接 → 服务器活动 */
const activityOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** #16 Schema 快照面板 */
const snapshotsOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openSnapshots(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  snapshotsOpen.value = { conn }
}
/** #14 备份/还原面板 */
const backupOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openBackup(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  backupOpen.value = { conn }
}
/** G1 AI 数据库体检 */
const healthOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openHealth(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  healthOpen.value = { conn }
}
/** #12 Dashboard */
const dashboardOpen = ref(false)
/** A2/A8 跨表全文搜索 */
const searchValueOpen = ref<{ connId: string; value?: string } | null>(null)
/** C5 索引推荐器（per 连接） */
const idxRecOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openIdxRec(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  idxRecOpen.value = { conn }
}
/** C1 主从复制延迟监控（per 连接） */
const replOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openRepl(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  replOpen.value = { conn }
}
/** G2 AI 写注释（per 连接 + 表）。⌘K 走的入口先弹 prompt 让用户填表名；
 *  下一波在 NavTree 右键加直连入口替代手填。 */
const aiCommentOpen = ref<{ conn: ConnectionConfig; table: string } | null>(null)
async function openAiCommentByPrompt(connId: string): Promise<void> {
  const table = await appPrompt({
    message: t('aicmt.askTable'),
    placeholder: 'schema.table',
  })
  if (!table?.trim()) return
  const conn = await client.connections.get(connId)
  aiCommentOpen.value = { conn, table: table.trim() }
}
/** G2 NavTree 表节点右键直连入口（已带表名，省去 prompt） */
async function openAiCommentForTable(connId: string, table: string): Promise<void> {
  const conn = await client.connections.get(connId)
  aiCommentOpen.value = { conn, table }
}
/** G4 SQL 跨方言翻译（全局，无连接绑定） */
const translateOpen = ref<{ initialSql?: string } | null>(null)
/** I1 通知 webhook 设置 */
const notifOpen = ref(false)
/** K1 自定义快捷键 */
const keybindOpen = ref(false)
/** D6 Schema 漂移检测（全局，对话框内自己选 2 个连接） */
const driftOpen = ref(false)
/** A3+B5+B6+B9+B10 数据检查器 */
const inspectorOpen = ref<{ conn: ConnectionConfig; table: string } | null>(null)
async function openInspector(connId: string, table: string): Promise<void> {
  const conn = await client.connections.get(connId)
  inspectorOpen.value = { conn, table }
}
/** B3+B4+B8 数据修整 */
const fixupOpen = ref<{ conn: ConnectionConfig; table: string } | null>(null)
async function openFixup(connId: string, table: string): Promise<void> {
  const conn = await client.connections.get(connId)
  fixupOpen.value = { conn, table }
}
/** A9 行历史 */
const rowHistOpen = ref<{
  conn: ConnectionConfig
  table: string
  pk: Record<string, unknown>
} | null>(null)
/** A10 列血缘 */
const lineageOpen = ref<{ conn: ConnectionConfig; table: string; column: string } | null>(null)
/** B7 数据契约 */
const contractOpen = ref(false)
// #9-#21 AI 工具箱：选任务 → 填上下文 → 推到右侧聊天面板
const aiToolboxOpen = ref<{
  task?:
    | 'migration'
    | 'optimize'
    | 'explain-analysis'
    | 'test-data'
    | 'nl2sql'
    | 'doc'
    | 'explain-table'
  sql?: string
  explain?: string
  connId?: string
  table?: string
} | null>(null)
async function openActivity(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  activityOpen.value = { conn }
}
const aiState = ref<{ mode: AiMode; sql?: string; connId?: string; error?: string } | null>(null)
const aboutOpen = ref(false)
// 右侧 AI 聊天侧边栏（持久化开关）
const aiChatOpen = ref(localStorage.getItem('skylerx.aiChat.open') === '1')
watch(aiChatOpen, (v) => {
  try {
    localStorage.setItem('skylerx.aiChat.open', v ? '1' : '0')
  } catch {
    /* ignore */
  }
})
// 当前活跃 query tab 的连接 id（给右侧 AI 聊天侧边栏当默认连接，跟着 tab 切换走）
const activeChatConnId = computed(() => {
  const ref = tabsRef.value as { activeConnId?: { value: string } } | null
  return ref?.activeConnId?.value ?? ''
})
async function onAiChatInsert(sql: string, connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openDraft(conn, sql, t('aichat.draftTitle'))
}
async function onAiChatRun(sql: string, connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, sql)
}
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

// ResultGrid 错误卡片里点「问 AI」：打开右侧聊天面板 + 把错误上下文塞过去发问
interface AskAiErrorPayload {
  connId: string
  connName?: string
  sql: string
  error: string
}
async function onAskAiAboutError(p: AskAiErrorPayload): Promise<void> {
  aiChatOpen.value = true
  // 等下一帧让 AiChatPanel 挂载完成，再调用 exposed 方法
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  const ref = aiChatRef.value as { askAboutError?: (p: AskAiErrorPayload) => void } | null
  ref?.askAboutError?.(p)
}

/**
 * 通用 AI 入口：把已经拼好的 prompt 发到 AI 聊天面板（#9-#21 共用此通道）。
 */
interface AskAiPredefinedPayload {
  prompt: string
  connId?: string
  connName?: string
  withSchema?: boolean
}
async function askAiPredefined(p: AskAiPredefinedPayload): Promise<void> {
  aiChatOpen.value = true
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  const ref = aiChatRef.value as { askPredefined?: (p: AskAiPredefinedPayload) => void } | null
  ref?.askPredefined?.(p)
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
  // 服务器活动需要先选连接，所以为每条连接生成一条 act:activity:<id>
  ...paletteConns.value.map((c) => ({
    id: `act:activity:${c.id}`,
    label: `${t('pal.activity')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // schema 快照 同上
  ...paletteConns.value.map((c) => ({
    id: `act:snapshots:${c.id}`,
    label: `${t('pal.snapshots')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // 备份/还原
  ...paletteConns.value.map((c) => ({
    id: `act:backup:${c.id}`,
    label: `${t('pal.backup')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // G1 AI 数据库体检
  ...paletteConns.value.map((c) => ({
    id: `act:health:${c.id}`,
    label: `${t('pal.aiHealth')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  { id: 'act:ai', label: t('pal.ai'), group: t('pal.groupActions') },
  { id: 'act:ai-toolbox', label: t('pal.aiToolbox'), group: t('pal.groupActions') },
  // #15 新窗口（仅桌面端有 window.newSession）
  ...(client.window?.newSession
    ? [{ id: 'act:new-window', label: t('pal.newWindow'), group: t('pal.groupActions') }]
    : []),
  // #12 Dashboard
  { id: 'act:dashboard', label: t('pal.dashboard'), group: t('pal.groupActions') },
  // A2 跨表全文搜索
  ...paletteConns.value.map((c) => ({
    id: `act:search-value:${c.id}`,
    label: `${t('pal.searchValue')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // B7 数据契约
  { id: 'act:contracts', label: t('pal.contracts'), group: t('pal.groupActions') },
  // C5 索引推荐器
  ...paletteConns.value.map((c) => ({
    id: `act:idxrec:${c.id}`,
    label: `${t('pal.idxRec')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // C1 主从复制延迟
  ...paletteConns.value.map((c) => ({
    id: `act:repl:${c.id}`,
    label: `${t('pal.replLag')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // G2 AI 写注释（per 连接，⌘K 命中后弹 prompt 让用户填表名）
  ...paletteConns.value.map((c) => ({
    id: `act:aicmt:${c.id}`,
    label: `${t('pal.aiComment')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // G4 SQL 翻译（全局）
  { id: 'act:translate', label: t('pal.translate'), group: t('pal.groupActions') },
  // I1 通知 webhook
  { id: 'act:notif', label: t('pal.notif'), group: t('pal.groupActions') },
  // K1 自定义快捷键
  { id: 'act:keybind', label: t('pal.keybind'), group: t('pal.groupActions') },
  // D6 Schema 漂移检测
  { id: 'act:drift', label: t('pal.drift'), group: t('pal.groupActions') },
  { id: 'act:ai-chat', label: t('pal.aiChat'), group: t('pal.groupActions') },
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
  else if (item.id.startsWith('act:activity:')) {
    const cid = item.id.slice('act:activity:'.length)
    void openActivity(cid)
  } else if (item.id.startsWith('act:snapshots:')) {
    const cid = item.id.slice('act:snapshots:'.length)
    void openSnapshots(cid)
  } else if (item.id.startsWith('act:backup:')) {
    const cid = item.id.slice('act:backup:'.length)
    void openBackup(cid)
  } else if (item.id.startsWith('act:health:')) {
    const cid = item.id.slice('act:health:'.length)
    void openHealth(cid)
  } else if (item.id === 'act:ai') aiState.value = { mode: 'nl2sql' }
  else if (item.id === 'act:ai-chat') aiChatOpen.value = !aiChatOpen.value
  else if (item.id === 'act:ai-toolbox') aiToolboxOpen.value = {}
  else if (item.id === 'act:new-window') void client.window?.newSession?.()
  else if (item.id === 'act:dashboard') dashboardOpen.value = true
  else if (item.id.startsWith('act:search-value:')) {
    const cid = item.id.slice('act:search-value:'.length)
    searchValueOpen.value = { connId: cid }
  } else if (item.id === 'act:contracts') contractOpen.value = true
  else if (item.id.startsWith('act:idxrec:')) {
    void openIdxRec(item.id.slice('act:idxrec:'.length))
  } else if (item.id.startsWith('act:repl:')) {
    void openRepl(item.id.slice('act:repl:'.length))
  } else if (item.id.startsWith('act:aicmt:')) {
    void openAiCommentByPrompt(item.id.slice('act:aicmt:'.length))
  } else if (item.id === 'act:translate') translateOpen.value = {}
  else if (item.id === 'act:notif') notifOpen.value = true
  else if (item.id === 'act:keybind') keybindOpen.value = true
  else if (item.id === 'act:drift') driftOpen.value = true
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
    toast.success(t('ws.importConnsResult', { n }))
  } catch (e) {
    toast.error(t('ws.importConnsFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

/**
 * K1：把命令 id 映射到具体行为；命中返回 true，未识别返回 false（继续走硬编码 fallback）。
 *
 * 「全局动作」（palette/settings 等）→ 直接调对应方法。
 * 「编辑器内动作」（run-sql / find / replace / format-sql / save-snippet / close-tab）→ 派发 window CustomEvent，
 * QueryPane / QueryTabs 在编辑态 mount 时各自 addEventListener 接听；这样用户改了 chord 也能命中。
 * Monaco 自身的默认快捷键（⌘+Enter / ⌘+F / ⌘+H）跟事件互不冲突——Monaco 先吃，事件 noop。
 */
function dispatchCommand(cmdId: string): boolean {
  switch (cmdId) {
    case 'palette':
      if (paletteOpen.value) paletteOpen.value = false
      else void openPalette()
      return true
    case 'object-search':
      objectSearchOpen.value = true
      return true
    case 'ai-chat':
      aiChatOpen.value = !aiChatOpen.value
      return true
    case 'new-conn':
      onNew()
      return true
    case 'settings':
      settingsOpen.value = true
      return true
    case 'new-query':
      tabsRef.value?.newForCurrent?.()
      return true
    case 'close-tab':
      tabsRef.value?.closeActive?.()
      return true
    // 这些在编辑态时由 QueryPane 监听 window event 触发对应方法
    case 'run-sql':
    case 'find':
    case 'replace':
    case 'format-sql':
    case 'save-snippet':
      window.dispatchEvent(new CustomEvent(`editor:${cmdId}`))
      return true
    default:
      return false
  }
}

function onKeydown(e: KeyboardEvent): void {
  // K1：先查用户自定义快捷键。若 chord 命中一个已知命令，执行后 return。
  // 用户未改的 chord 会等同 DEFAULT_KEY_BINDINGS → 下面硬编码分支仍可命中（双保险）。
  const chord = chordFromEvent(e)
  if (chord) {
    const bindings = getBindings(settings.keyBindings)
    for (const [cmdId, c] of Object.entries(bindings)) {
      if (c !== chord) continue
      if (dispatchCommand(cmdId)) {
        e.preventDefault()
        return
      }
      break
    }
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (paletteOpen.value) paletteOpen.value = false
    else void openPalette()
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
    // ⌘/Ctrl+Shift+O：全局对象搜索
    e.preventDefault()
    objectSearchOpen.value = true
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
    // ⌘/Ctrl+Shift+L：开/关右侧 AI 聊天侧边栏
    e.preventDefault()
    aiChatOpen.value = !aiChatOpen.value
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

/**
 * 应用菜单命令路由：主进程菜单点击后 send('menu:command', key)，按 key 调对应方法。
 *
 * 大多数 key 都对应已经存在的 ⌘K 命令面板 item id（act:xxx），统一复用 onPalettePick；
 * 个别系统级 / 编辑器内动作（find / replace / format-sql / new-query）单独路由。
 */
const PALETTE_KEY_MAP: Record<string, string> = {
  'new-conn': 'act:new-conn',
  settings: 'act:settings',
  about: 'act:about',
  shortcuts: 'act:shortcuts',
  'object-search': 'act:object-search',
  palette: 'act:palette', // 见下面单独处理
  'toggle-ai-chat': 'act:ai-chat',
  favorites: 'act:favorites',
  'op-log': 'act:oplog',
  activity: 'act:activity-pick',
  'backup-restore': 'act:backup-pick',
  'data-transfer': 'act:transfer-pick',
  'schema-diff': 'act:schema-diff',
  'data-diff': 'act:data-diff',
  snapshots: 'act:snapshots-pick',
  dashboard: 'act:dashboard',
  'search-value': 'act:search-value-pick',
  contracts: 'act:contracts',
  'ai-toolbox': 'act:ai-toolbox',
  'ai-assistant': 'act:ai',
  'new-window': 'act:new-window',
  'import-conns': 'act:import-conns',
  'export-conns': 'act:export-conns',
}

function onMenuCommand(key: string): void {
  // 命令面板 = 直接打开搜索框
  if (key === 'palette') {
    paletteOpen.value = true
    return
  }
  // 新建查询：交给当前活跃 tab 的连接
  if (key === 'new-query') {
    tabsRef.value?.newForCurrent?.()
    return
  }
  // 关闭当前 tab：交给 QueryTabs
  if (key === 'close-tab') {
    // QueryTabs 没暴露 closeActive，先 noop；快捷键 ⌘W 现在由 Electron 标签关闭代替
    return
  }
  // 编辑器级动作：Monaco 自带，转发给 window event 让 SqlEditor 捕获
  if (key === 'find' || key === 'replace' || key === 'format-sql') {
    window.dispatchEvent(new CustomEvent(`editor:${key}`))
    return
  }
  // 选连接才能跑的：弹一个简单 picker（这里走命令面板更省事）
  if (
    key === 'activity' ||
    key === 'backup-restore' ||
    key === 'data-transfer' ||
    key === 'snapshots' ||
    key === 'search-value'
  ) {
    paletteOpen.value = true
    return
  }
  if (key === 'check-update') {
    void checkForUpdate()
    aboutOpen.value = true
    return
  }
  if (key === 'open-sql') {
    // SqlEditor 用 hidden file input；这里走 client.files.openText 再喂给 QueryPane
    void (async () => {
      const f = await client.files?.openText([{ name: 'SQL', extensions: ['sql', 'txt'] }])
      if (!f) return
      // activeConnId 是 tabsRef expose 的 computed，取值用 .value
      const tabsExp = tabsRef.value as {
        activeConnId?: { value: string }
        openDraft?: (c: ConnectionConfig, sql: string, title: string) => void
      } | null
      const cid = tabsExp?.activeConnId?.value
      if (cid) {
        const cfg = await client.connections.get(cid)
        tabsExp?.openDraft?.(cfg, f.content, f.name)
      }
    })()
    return
  }
  // 落到命令面板 id：直接构造 PaletteItem 然后跑现有 dispatcher
  const palId = PALETTE_KEY_MAP[key]
  if (palId) void onPaletteSelect({ id: palId, label: key, group: '' } as PaletteItem)
}

// 订阅主进程菜单命令；卸载时反订阅
let unsubMenu: (() => void) | null = null
onMounted(() => {
  unsubMenu = client.menu?.onCommand?.(onMenuCommand) ?? null
})
onUnmounted(() => unsubMenu?.())
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
    @inspect-table="(cid, node) => openInspector(cid, node.sqlName ?? node.name)"
    @fixup-table="(cid, node) => openFixup(cid, node.sqlName ?? node.name)"
    @ai-comment-table="(cid, node) => openAiCommentForTable(cid, node.sqlName ?? node.name)"
    @ai-health-check="openHealth"
    @index-recommender="openIdxRec"
    @rename-table="onRenameTable"
    @copy-table="onCopyTable"
    @toggle-prod-mark="onToggleProdMark"
    @create-template-draft="onCreateTemplateDraft"
    @view-definition="onViewDefinition"
    @generate-sql="onGenerateSql"
    @open-erd="onOpenErd"
    @import-data="onImportData"
    @export-sql="onExportSql"
    @export-schema-sql="onExportSchemaSql"
    @transfer-data="onTransferData"
    @bulk-drop="onBulkDrop"
    @open-settings="settingsOpen = true"
    @toggle-ai-chat="aiChatOpen = !aiChatOpen"
  />

  <main class="main">
    <QueryTabs
      ref="tabsRef"
      @conn-error="onConnError"
      @refresh="onTreeRefresh"
      @ai="onAiFromPane"
      @ask-ai-about-error="onAskAiAboutError"
      @search-value="(p) => { searchValueOpen = { connId: p.connId, value: p.value } }"
    />
  </main>

  <!-- 右侧 AI 聊天侧边栏（类 Cursor）；点导航树 ✨ / ⌘⇧L / ⌘K → AI 聊天 唤起 -->
  <AiChatPanel
    v-if="aiChatOpen"
    ref="aiChatRef"
    :active-conn-id="activeChatConnId"
    @close="aiChatOpen = false"
    @insert-sql="onAiChatInsert"
    @run-sql="onAiChatRun"
    @open-settings="openSettingsAtAi"
  />

  <!-- 全局主题对话框 + Toast 通知（替代 window.confirm/alert/prompt） -->
  <AppDialogs />

  <!-- 右侧常驻竖栏（类 VS Code 活动栏）：始终可见，点 ✨ 开关 AI 聊天 -->
  <aside class="right-rail">
    <button
      class="rail-btn"
      :class="{ on: aiChatOpen }"
      :title="t('nav.aiChat')"
      @click="aiChatOpen = !aiChatOpen"
    >✨</button>
  </aside>

  <Modal
    v-if="editing"
    :title="editing.connId ? t('ws.titleEditConn') : t('ws.titleNewConn')"
    width="medium"
    fixed-height
    storage-key="connection"
    :before-close="confirmDiscardConnForm"
    @close="onCancelConn"
  >
    <ConnectionForm
      ref="connFormRef"
      :conn-id="editing.connId"
      :initial-error="editing.error"
      @saved="onSaved"
      @deleted="onDeleted"
      @cancel="onCancelConn"
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

  <SettingsDialog v-if="settingsOpen" :initial-section="settingsInitialSection" @close="settingsOpen = false" />

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

  <!-- #1 + #8：服务器活动（进程 / 长事务 / 锁等待） -->
  <ServerActivityDialog
    v-if="activityOpen"
    :conn="activityOpen.conn"
    @close="activityOpen = null"
  />

  <!-- #16 Schema 快照（一键拍/对比） -->
  <SchemaSnapshotsDialog
    v-if="snapshotsOpen"
    :conn="snapshotsOpen.conn"
    @close="snapshotsOpen = null"
  />

  <!-- #14 备份 / 还原 -->
  <BackupRestoreDialog
    v-if="backupOpen"
    :conn="backupOpen.conn"
    @close="backupOpen = null"
  />

  <!-- G1 AI 数据库体检 -->
  <AiHealthCheckDialog
    v-if="healthOpen"
    :conn="healthOpen.conn"
    @close="healthOpen = null"
    @open-settings="settingsOpen = true"
  />

  <!-- #12 Dashboard：多 SQL 多卡片小盘子 -->
  <DashboardDialog v-if="dashboardOpen" @close="dashboardOpen = false" />

  <!-- A2/A8 跨表全文搜索 -->
  <SearchValueDialog
    v-if="searchValueOpen"
    :initial-conn-id="searchValueOpen.connId"
    :prefill-value="searchValueOpen.value"
    @close="searchValueOpen = null"
  />

  <!-- A3+B5+B6+B9+B10 数据检查器（连接 + 表） -->
  <DataInspectorDialog
    v-if="inspectorOpen"
    :conn="inspectorOpen.conn"
    :table="inspectorOpen.table"
    @close="inspectorOpen = null"
  />

  <!-- B3+B4+B8 数据修整 -->
  <DataFixupDialog
    v-if="fixupOpen"
    :conn="fixupOpen.conn"
    :table="fixupOpen.table"
    @close="fixupOpen = null"
    @run-sql="(sql) => { tabsRef?.runSql(fixupOpen!.conn, sql); fixupOpen = null }"
  />

  <!-- A9 行历史 -->
  <RowHistoryDialog
    v-if="rowHistOpen"
    :conn="rowHistOpen.conn"
    :table="rowHistOpen.table"
    :pk="rowHistOpen.pk"
    @close="rowHistOpen = null"
  />

  <!-- A10 列血缘 -->
  <LineageDialog
    v-if="lineageOpen"
    :conn="lineageOpen.conn"
    :table="lineageOpen.table"
    :column="lineageOpen.column"
    @close="lineageOpen = null"
  />

  <!-- B7 数据契约 -->
  <DataContractDialog v-if="contractOpen" @close="contractOpen = false" />

  <!-- C5 索引推荐器：建议 → emit runSql 走当前 tab 跑 -->
  <IndexRecommenderDialog
    v-if="idxRecOpen"
    :conn="idxRecOpen.conn"
    @close="idxRecOpen = null"
    @run-sql="(sql) => { tabsRef?.runSql(idxRecOpen!.conn, sql) }"
  />

  <!-- C1 主从复制延迟监控 -->
  <ReplicationLagDialog
    v-if="replOpen"
    :conn="replOpen.conn"
    @close="replOpen = null"
  />

  <!-- G2 AI 写注释：emit runSql 跑 COMMENT/ALTER -->
  <AiCommentDialog
    v-if="aiCommentOpen"
    :conn="aiCommentOpen.conn"
    :table="aiCommentOpen.table"
    @close="aiCommentOpen = null"
    @run-sql="(sql) => { tabsRef?.runSql(aiCommentOpen!.conn, sql) }"
  />

  <!-- G4 SQL 跨方言翻译（全局） -->
  <SqlTranslateDialog
    v-if="translateOpen"
    :initial-sql="translateOpen.initialSql"
    @close="translateOpen = null"
  />

  <!-- I1 通知 webhook 设置 -->
  <NotificationSettingsDialog v-if="notifOpen" @close="notifOpen = false" />

  <!-- K1 自定义快捷键 -->
  <KeyBindingsDialog v-if="keybindOpen" @close="keybindOpen = false" />

  <!-- D6 Schema 漂移检测（内部自己选连接） -->
  <SchemaDriftDialog v-if="driftOpen" @close="driftOpen = false" />

  <!-- #9-#21 AI 工具箱：选任务 → 拼 prompt → 推到右侧聊天面板 -->
  <AiToolboxDialog
    v-if="aiToolboxOpen"
    :initial-task="aiToolboxOpen.task"
    :initial-sql="aiToolboxOpen.sql"
    :initial-explain="aiToolboxOpen.explain"
    :initial-conn-id="aiToolboxOpen.connId"
    :initial-table="aiToolboxOpen.table"
    @close="aiToolboxOpen = null"
    @submit="(p) => askAiPredefined(p)"
  />

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
/* 右侧活动栏：永远可见的窄栏，类似 VS Code 右侧侧边按钮列 */
.right-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  width: 40px;
  flex: none;
  background: var(--panel);
  border-left: 1px solid var(--border);
}
.rail-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}
.rail-btn:hover {
  background: rgba(124, 108, 255, 0.14);
  color: var(--text);
}
.rail-btn.on {
  background: rgba(124, 108, 255, 0.22);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent, #7c6cff);
}
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

