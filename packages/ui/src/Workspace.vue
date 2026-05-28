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
import PrivilegesDialog from './components/PrivilegesDialog.vue'
import SchemaDiffDialog from './components/SchemaDiffDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import QueryTabs from './components/QueryTabs.vue'
import type { TreeNode } from './components/treeNode'
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { buildCreateFromColumns, buildDataDictMarkdown, buildTableDump } from './dump'
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
  previewSql,
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

// 生成数据字典（Markdown）：迭代库/schema 下所有表的列信息
async function onDataDict(connId: string, node: TreeNode): Promise<void> {
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
    await client.files.saveText({
      defaultName: `${label}-data-dict.md`,
      content: buildDataDictMarkdown(label, withCols),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
  } catch (e) {
    window.alert(t('ws.exportFail', { msg: e instanceof Error ? e.message : String(e) }))
  }
}

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
    @data-dict="onDataDict"
    @edit-object="onEditObject"
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
    <QueryTabs ref="tabsRef" @conn-error="onConnError" @refresh="onTreeRefresh" />
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

