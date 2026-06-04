<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  DbDialect,
  DbKind,
  MetaNodeKind,
  dialectKind,
} from '@db-tool/shared-types'
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import type { AiMode } from './ai'
import { onChatErrorAsk } from './chat-bus'
import AiAssistantDialog from './components/AiAssistantDialog.vue'
import AiChatPanel from './components/AiChatPanel.vue'
import AiCommentDialog from './components/AiCommentDialog.vue'
import AiHealthCheckDialog from './components/AiHealthCheckDialog.vue'
import AiInsightsDialog from './components/AiInsightsDialog.vue'
import AiSchemaArchitectDialog from './components/AiSchemaArchitectDialog.vue'
import AiSchemaReverseDialog from './components/AiSchemaReverseDialog.vue'
import AiToolboxDialog from './components/AiToolboxDialog.vue'
import AppDialogs from './components/AppDialogs.vue'
import BackupRestoreDialog from './components/BackupRestoreDialog.vue'
import ChartViewerDialog from './components/ChartViewerDialog.vue'
import ClickHouseAdvancedDialog from './components/ClickHouseAdvancedDialog.vue'
import ClusterTopologyDialog from './components/ClusterTopologyDialog.vue'
import CommandPalette, { type PaletteItem } from './components/CommandPalette.vue'
import ComplianceDialog from './components/ComplianceDialog.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import DashboardDialog from './components/DashboardDialog.vue'
import DataContractDialog from './components/DataContractDialog.vue'
import DataDiffDialog from './components/DataDiffDialog.vue'
import DataFixupDialog from './components/DataFixupDialog.vue'
import DataInspectorDialog from './components/DataInspectorDialog.vue'
import DataMaskingViewDialog from './components/DataMaskingViewDialog.vue'
import DataTransferDialog from './components/DataTransferDialog.vue'
import ErDiagramDialog from './components/ErDiagramDialog.vue'
import ExportOptionsDialog from './components/ExportOptionsDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import IndexRecommenderDialog from './components/IndexRecommenderDialog.vue'
import KeyBindingsDialog from './components/KeyBindingsDialog.vue'
import LineageDialog from './components/LineageDialog.vue'
import LintRulesDialog from './components/LintRulesDialog.vue'
import MigrationAssessWizard from './components/MigrationAssessWizard.vue'
import MockDataDialog from './components/MockDataDialog.vue'
import Modal from './components/Modal.vue'
import MongoAggregationDialog from './components/MongoAggregationDialog.vue'
import MongoCollectionInfoDialog from './components/MongoCollectionInfoDialog.vue'
import MppPartitionDialog from './components/MppPartitionDialog.vue'
import MysqlAdvancedDialog from './components/MysqlAdvancedDialog.vue'
import NavFilterDialog from './components/NavFilterDialog.vue'
import NavTree from './components/NavTree.vue'
import NdjsonViewerDialog from './components/NdjsonViewerDialog.vue'
import NewDatabaseDialog from './components/NewDatabaseDialog.vue'
import NewSchemaDialog from './components/NewSchemaDialog.vue'
import NotebookDialog from './components/NotebookDialog.vue'
import NotificationSettingsDialog from './components/NotificationSettingsDialog.vue'
import ObjectSearchDialog from './components/ObjectSearchDialog.vue'
import OceanBaseTopologyDialog from './components/OceanBaseTopologyDialog.vue'
import OperationLogDialog from './components/OperationLogDialog.vue'
import OracleToDmWizard from './components/OracleToDmWizard.vue'
import PasteImportDialog from './components/PasteImportDialog.vue'
import PgAdvancedDialog from './components/PgAdvancedDialog.vue'
import PiiScannerDialog from './components/PiiScannerDialog.vue'
import PrivilegesDialog from './components/PrivilegesDialog.vue'
import ProcessListDialog from './components/ProcessListDialog.vue'
import QueryTabs from './components/QueryTabs.vue'
import RagDialog from './components/RagDialog.vue'
import RedisBigKeysDialog from './components/RedisBigKeysDialog.vue'
import RedisImportExportDialog from './components/RedisImportExportDialog.vue'
import RedisMonitorDialog from './components/RedisMonitorDialog.vue'
import RedisNewKeyDialog from './components/RedisNewKeyDialog.vue'
import RedisScriptDialog from './components/RedisScriptDialog.vue'
import RedisSearchDialog from './components/RedisSearchDialog.vue'
import RedisServerInfoDialog from './components/RedisServerInfoDialog.vue'
import ReplicationLagDialog from './components/ReplicationLagDialog.vue'
import ResultDiffDialog from './components/ResultDiffDialog.vue'
import RowHistoryDialog from './components/RowHistoryDialog.vue'
import SchemaDiffDialog from './components/SchemaDiffDialog.vue'
import SchemaDriftDialog from './components/SchemaDriftDialog.vue'
import SchemaSnapshotsDialog from './components/SchemaSnapshotsDialog.vue'
import SearchValueDialog from './components/SearchValueDialog.vue'
import ServerActivityDialog from './components/ServerActivityDialog.vue'
import ServerMonitorDialog from './components/ServerMonitorDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SlowQueryDialog from './components/SlowQueryDialog.vue'
import SqlLineageDialog from './components/SqlLineageDialog.vue'
import SqlTranslateDialog from './components/SqlTranslateDialog.vue'
import StorageCapacityDialog from './components/StorageCapacityDialog.vue'
import VisualQueryDialog from './components/VisualQueryDialog.vue'
import WorkspaceExportDialog from './components/WorkspaceExportDialog.vue'
import type { TreeNode } from './components/treeNode'
import { useDataClient } from './data-client'
import {
  type BulkSqlChunk,
  type ObjectKind,
  type SqlTemplateKind,
  type TableContext,
  type TableStats,
  buildBulkDrop,
  buildBulkTruncate,
  buildDrop,
  buildSqlTemplate,
  contextOfNode,
  definitionQuery,
  deriveContext,
  dropSupportsCascade,
  erdContext,
  existingForeignKeysQuery,
  extractDefinition,
  familyOf,
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
  type EnvSummary,
  formatEnvBlock,
  getEnvCache,
  primeEnvCache,
  reportError,
} from './errorReporter'
import {
  type Favorite,
  favorites,
  removeFavorite,
  setFavoriteTag,
  toggleFavorite,
} from './favorites'
import { t } from './i18n'
import { chordFromEvent, getBindings } from './keybindings'
import {
  NAV_WIDTH_MAX,
  NAV_WIDTH_MIN,
  clampNavWidth,
  settings,
  zoomIn,
  zoomOut,
  zoomReset,
} from './settings'

const navRef = useTemplateRef('navRef')
const tabsRef = useTemplateRef('tabsRef')
const aiChatRef = useTemplateRef('aiChatRef')

// 数据客户端由外层应用壳注入（桌面=IPC，Web=REST）
const client = useDataClient()

// editing 非空 → 弹出连接表单弹窗；error 为连接失败信息（自动弹窗时带上）
// prefillGroup:新建时如果是从"分组右键"触发,提前把 group 字段填好
const editing = ref<{ connId: string | null; error?: string; prefillGroup?: string } | null>(null)

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

/**
 * Generic per-chunk batch run state (#25). Used for TRUNCATE, DDL export, etc.
 * — anywhere we have a precomputed list of SQL chunks to run sequentially
 * with fail-fast semantics. The progress panel reuses the same template
 * shape (label list + done counter + cancel).
 */
const bulkRunState = ref<{
  title: string
  /** Pre-rendered label for each chunk in the order they'll execute. */
  labels: string[]
  /** Per-chunk async runner. Throws on error → halt. */
  run: (i: number) => Promise<void>
  busy: boolean
  done: number
  error: string | null
  /** Optional cleanup once everything succeeded (reload tree etc). */
  onDone?: () => void | Promise<void>
} | null>(null)

/** Pop the generic bulk-run modal closed. */
function dismissBulkRun(): void {
  bulkRunState.value = null
}

/**
 * Sequential fail-fast runner. Public so the modal's "继续" button can re-call
 * after the user fixes whatever upstream issue caused the error.
 */
async function confirmBulkRun(): Promise<void> {
  const b = bulkRunState.value
  if (!b) return
  b.busy = true
  b.error = null
  try {
    for (let i = b.done; i < b.labels.length; i++) {
      await b.run(i)
      b.done = i + 1
    }
    await b.onDone?.()
    bulkRunState.value = null
  } catch (e) {
    b.error = e instanceof Error ? e.message : String(e)
    b.busy = false
  }
}

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

/** 在指定分组下新建连接(导航树空白菜单/分组菜单触发)。 */
function onNewConnInGroup(group: string): void {
  editing.value = { connId: null, prefillGroup: group }
}

function onEditConn(id: string): void {
  editing.value = { connId: id }
}

async function onSelectConn(id: string): Promise<void> {
  const conn = await client.connections.get(id)
  tabsRef.value?.openConnection(conn)
}

/**
 * Parse the Redis db index out of a `MetaNodeKind.Database` tree node.
 *
 * Redis driver builds nodes with name='db0', name='db5' (string prefix); the
 * numeric index lives in node.path[0] = '0', '5'. A naive `Number(node.name)`
 * yields NaN and the caller silently falls back to db0 — that's #3 / #27.
 * Always go through this helper to keep the three Redis routing paths in sync.
 */
function parseRedisDbIndex(node: TreeNode): number {
  const n = Number(node.path?.[0] ?? node.name.replace(/^db/, ''))
  return Number.isFinite(n) ? n : 0
}

async function onNewQuery(id: string, node?: TreeNode): Promise<void> {
  const conn = await client.connections.get(id)
  // NoSQL：没有「SQL 查询页」概念，按方言路由到 Mongo/Redis/ES 浏览器
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    if (conn.dialect === DbDialect.Redis) {
      // 右键 db 节点 → 用 db 索引;右键连接根 / 无 node → 默认 db0 (#27).
      const dbIndex = node?.kind === MetaNodeKind.Database ? parseRedisDbIndex(node) : 0
      tabsRef.value?.openRedisDb(conn, dbIndex)
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

/** Redis 专属:左侧树双击 key → 打开 RedisPane 并把 pendingKey 传过去自动选中。 */
async function onOpenRedisKey(connId: string, dbIndex: number, key: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openRedisDb(conn, dbIndex, key)
}

/**
 * #19: 单击 Redis key 联动 — 仅当已经有匹配 db 的 RedisPane tab 时才激活,
 * 不主动开新 tab. focusRedisDb 同步返回是否命中, 这里不做额外提示
 * (单击主路径就是浏览, 没命中就当普通 select 处理).
 */
function onFocusRedisKey(connId: string, dbIndex: number, key: string): void {
  tabsRef.value?.focusRedisDb(connId, dbIndex, key)
}

/** Redis 专属:右键 → 删除 key(DEL),成功后刷新对应类型组节点。 */
async function onDeleteRedisKey(
  connId: string,
  dbIndex: number,
  key: string,
  parent: TreeNode,
): Promise<void> {
  if (!(await appConfirm({ message: `确认删除 key "${key}" ?`, variant: 'danger' }))) return
  try {
    await client.connections.executeCommand(connId, {
      op: 'DEL',
      args: [key],
      context: { dbIndex },
    })
    // parent = 类型组节点(如 Strings),刷新后重新 SCAN 抽样
    await navRef.value?.refreshNode(parent, connId)
    toast.success(`已删除: ${key}`)
  } catch (e) {
    reportError(e, { tag: 'redis-delete-key' })
  }
}

/** Redis 专属:清空指定逻辑库(FLUSHDB)。生产连接额外多一次防呆。 */
async function onFlushRedisDb(connId: string, dbIndex: number, dbNode: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const env = conn.extra?.env as string | undefined
  const isProd = env === 'prod'
  if (isProd) {
    const typed = await appPrompt({
      message: `⚠️ 这是生产环境连接「${conn.name}」。\n要清空 db${dbIndex} 的所有 key,请输入"FLUSHDB" 二次确认:`,
      defaultValue: '',
    })
    if (typed !== 'FLUSHDB') {
      toast.warn('已取消')
      return
    }
  } else {
    if (
      !(await appConfirm({
        message: `确认清空「${conn.name}」的 db${dbIndex} 内所有 key ?\n此操作不可恢复。`,
        variant: 'danger',
      }))
    )
      return
  }
  try {
    await client.connections.executeCommand(connId, {
      op: 'FLUSHDB',
      args: [],
      context: { dbIndex },
    })
    await navRef.value?.refreshNode(dbNode, connId)
    toast.success(`db${dbIndex} 已清空`)
  } catch (e) {
    reportError(e, { tag: 'redis-flushdb' })
  }
}

/** Redis 专属:清空整个实例(FLUSHALL)。无论环境都强制 "FLUSHALL" 输入确认。 */
async function onFlushRedisAll(connId: string, connNode: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const typed = await appPrompt({
    message: `⚠️ 即将清空「${conn.name}」整个实例的所有 16 个逻辑库,所有 key 都会丢失,不可恢复。\n请输入"FLUSHALL"确认:`,
    defaultValue: '',
  })
  if (typed !== 'FLUSHALL') {
    toast.warn('已取消')
    return
  }
  try {
    await client.connections.executeCommand(connId, {
      op: 'FLUSHALL',
      args: [],
      // 不需要 dbIndex,FLUSHALL 跨库
    })
    await navRef.value?.refreshNode(connNode, connId)
    toast.success('整个实例已清空')
  } catch (e) {
    reportError(e, { tag: 'redis-flushall' })
  }
}

/** Redis 专属:新建 key — 打开 RedisNewKeyDialog;parent 用于成功后刷新对应类型组。 */
async function onNewRedisKey(connId: string, dbIndex: number, parent: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  redisNewKeyOpen.value = { conn, dbIndex, parent }
}

/** Redis 新建 key 成功:刷新左侧树的"父节点"(可能是 db 节点也可能是类型组)。 */
async function onRedisKeyCreated(): Promise<void> {
  if (!redisNewKeyOpen.value) return
  const { conn, parent } = redisNewKeyOpen.value
  // db 节点要刷新整个子树才看得到新 key;类型组节点刷自身即可
  await navRef.value?.refreshNode(parent, conn.id)
}

/** 新建数据库:打开弹窗。 */
async function onNewDatabase(connId: string, parent: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  newDbOpen.value = { conn, parent }
}

/** 新建数据库成功:刷新连接节点(出现新库)。 */
async function onDatabaseCreated(): Promise<void> {
  if (!newDbOpen.value) return
  const { conn, parent } = newDbOpen.value
  await navRef.value?.refreshNode(parent, conn.id)
}

/** 新建 Schema:打开弹窗。父节点为 Database 时取其 name 作为 schema 所在库。 */
async function onNewSchema(connId: string, parent: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  // Database 节点:name 即父库;Schema 节点:PG 系 path=[库, schema] → 父库取 path[0]
  // (建同库下的兄弟 schema);Oracle/DM 的 schema path=[schema] 无库层 → undefined。
  // Connection 节点:不带 database(走默认上下文)。
  const database =
    parent.kind === MetaNodeKind.Database
      ? parent.name
      : parent.kind === MetaNodeKind.Schema && parent.path.length > 1
        ? parent.path[0]
        : undefined
  newSchemaOpen.value = { conn, database, parent }
}

/** 新建 Schema 成功:刷新出新 schema。从 Schema 节点建的是兄弟 schema → 刷新它的父
 *  (库/连接);从 库/连接节点建的就刷新自身。reveal=true 让新 schema 直接浮现。 */
async function onSchemaCreated(): Promise<void> {
  if (!newSchemaOpen.value) return
  const { conn, parent } = newSchemaOpen.value
  const target = parent.kind === MetaNodeKind.Schema ? (parent.parent ?? parent) : parent
  await navRef.value?.refreshNode(target, conn.id, true)
}

async function onDeleteConn(id: string): Promise<void> {
  if (!(await appConfirm({ message: t('conn.removeConfirm'), variant: 'danger' }))) return
  await client.connections.remove(id)
  await navRef.value?.reload()
  tabsRef.value?.closeConnTabs(id)
}

/**
 * 复制连接:
 *  - 拷一份完整配置(含密码/SSH/SSL/extra),生成新 id 与名字"<原名> (副本)"。
 *  - 同时把 sortIndex 设为"在原连接之后",保证副本紧挨原条目;后续拖动可任意调整。
 *  - 不自动打开新连接窗,只 toast 提示,符合"复制不动手"原则;用户随时双击打开。
 */
async function onDuplicateConn(id: string): Promise<void> {
  try {
    const src = await client.connections.get(id)
    // 深拷贝避免后端被 mutate;extra 单独复制
    const dup = {
      ...src,
      id: crypto.randomUUID(),
      name: `${src.name || '未命名'} (副本)`,
      sortIndex: typeof src.sortIndex === 'number' ? src.sortIndex + 0.5 : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      extra: src.extra ? { ...src.extra } : undefined,
      ssh: src.ssh ? { ...src.ssh } : undefined,
      ssl: src.ssl ? { ...src.ssl } : undefined,
    }
    await client.connections.create(dup)
    await navRef.value?.reload()
    toast.success(`已复制: ${dup.name}`)
  } catch (e) {
    reportError(e, { tag: 'duplicate-connection' })
  }
}

/** 复制连接内容到剪贴板(jdbc/json/multiline/singleline;格式化在 connExport,一律不含密码)。 */
async function onCopyConnInfo(
  connId: string,
  format: 'jdbc' | 'json' | 'multiline' | 'singleline',
): Promise<void> {
  try {
    const conn = await client.connections.get(connId)
    const { formatConnection } = await import('./connExport')
    await navigator.clipboard?.writeText(formatConnection(conn, format))
    toast.success(t('ctx.copyConnOk'))
  } catch (e) {
    reportError(e, { tag: 'copy-conn-info' })
  }
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

// 设计器创建成功 → 刷新对应目录树节点（reveal：折叠的空分组也强制重载并展开，
// 让新建的首个对象，如第一个类型/包/同义词，立即浮现）
function onTreeRefresh(node: TreeNode, connId: string): void {
  navRef.value?.refreshNode(node, connId, true)
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
      tabsRef.value?.openRedisDb(conn, parseRedisDbIndex(node))
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

// 对象依赖 / 影响分析 → 开依赖页签
async function onViewDependencies(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.openDependencies(conn, node)
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
      tabsRef.value?.openRedisDb(conn, parseRedisDbIndex(node))
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

/**
 * 生成测试数据 v2：弹 MockDataDialog 让用户按语义配置每列，
 * 比旧版（只 prompt 行数 → 按 SQL 类型随机）强大得多。
 * v1 的 buildMockInserts 调用迁移到 dialog 内部。
 */
const mockState = ref<{
  conn: ConnectionConfig
  tableRef: string
  tableName: string
  baseColumns: { name: string; type: string; pk?: boolean }[]
} | null>(null)

async function onMockData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  const colNodes = await client.connections.metadata(connId, {
    parentKind: MetaNodeKind.Group,
    path: [...node.path],
    group: 'columns',
  })
  const baseColumns = colNodes.map((c) => ({
    name: c.name,
    type: c.detail?.dataType ?? '',
    pk: !!c.detail?.primaryKey,
  }))
  if (!baseColumns.length) {
    await appAlert({ message: t('ws.noCols'), variant: 'warn' })
    return
  }
  mockState.value = {
    conn,
    tableRef: node.sqlName ?? node.name,
    tableName: node.name,
    baseColumns,
  }
}

/** Oracle → DM 迁移向导（独立工具，自带连接选择步骤） */
const o2dmRef = useTemplateRef<{ open: () => void } | null>('o2dmRef')
const migAssessRef = useTemplateRef<{ open: (o?: { srcConnId?: string }) => void } | null>(
  'migAssessRef',
)

/** 等保 2.0 合规检查（按连接打开） */
const complianceOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openCompliance(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  complianceOpen.value = { conn }
}

/** 慢查询日志分析（按连接打开） */
const slowOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openSlowQuery(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  slowOpen.value = { conn }
}
const storageOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openStorageTrend(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  storageOpen.value = { conn }
}
function onSlowOpenSql(connId: string, sql: string): void {
  void (async () => {
    const conn = await client.connections.get(connId)
    tabsRef.value?.openDraft(conn, sql, t('slowq.title'))
  })()
}

/** #6 可视化查询构建器：按连接打开 */
const vqdState = ref<{ conn: ConnectionConfig } | null>(null)
async function openVqd(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  vqdState.value = { conn }
}
function onVqdOpenSql(sql: string): void {
  if (!vqdState.value) return
  tabsRef.value?.openDraft(vqdState.value.conn, sql, t('vqd.tabTitle'))
}

/** #8 NDJSON 查看器：通用文件选择 → 弹查看对话框（独立工具，不依赖连接） */
const ndjsonState = ref<{ name: string; content: string } | null>(null)
async function openNdjsonViewer(): Promise<void> {
  if (!client.files) {
    await appAlert({ message: t('ws.noFilesApi'), variant: 'warn' })
    return
  }
  const file = await client.files.openText([{ name: 'NDJSON', extensions: ['ndjson', 'jsonl'] }])
  if (!file) return
  ndjsonState.value = file
}

function onMockGenerated(sql: string): void {
  if (!mockState.value) return
  tabsRef.value?.openDraft(
    mockState.value.conn,
    sql,
    t('ws.tabMockData', { name: mockState.value.tableName }),
  )
}

/**
 * Mock 数据 → 直接执行的完成通知(不开查询页)。
 *
 * 真正的逐条 INSERT 执行已经下放到 MockDataDialog 内部实现(它需要展示进度+取消),
 * 这里只是个兼容钩子;dialog 跑完后会 emit('execute', sql),我们不再关闭弹框,
 * 让用户继续调整 mock 配置或手动 ×。
 */
async function onMockExecute(_sql: string): Promise<void> {
  // no-op: dialog 自管进度/toast/状态,不需要在 Workspace 重复执行
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
    if (['mysql', 'mariadb', 'oceanbase', 'gbase8a'].includes(conn.dialect)) {
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
    } else if (['oracle', 'dm'].includes(conn.dialect)) {
      // Oracle/DM 用 dbms_metadata.get_ddl('TABLE', name, schema), 比 列拼装 完整(含索引/约束/默认值)
      // 失败回退到 buildCreateFromColumns,避免 SELECT_CATALOG_ROLE 缺权限时阻塞
      const schema = node.path[node.path.length - 2] ?? ''
      const name = node.name
      const esc = (s: string) => s.replace(/'/g, "''").toUpperCase()
      try {
        const r = await client.connections.execute(
          connId,
          `SELECT dbms_metadata.get_ddl('TABLE', '${esc(name)}', '${esc(schema)}') AS "ddl" FROM dual`,
        )
        ddl = String((r.rows[0] as Record<string, unknown> | undefined)?.ddl ?? '').trim()
      } catch {
        /* 没权限,落到下面的 buildCreateFromColumns */
      }
      if (!ddl) {
        const cols = await client.connections.metadata(connId, {
          parentKind: MetaNodeKind.Group,
          path: [...node.path],
          group: 'columns',
        })
        ddl = buildCreateFromColumns(conn.dialect, node.sqlName ?? node.name, cols)
      }
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
    reportError(e, { tag: 'ws.genSqlFail' })
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
    reportError(e, { tag: 'ws.exportFail' })
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
  const q = objectDdlQuery(conn.dialect, kind, objectRef(conn.dialect, node), node)
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
      // 'funcdef' (PG) 或 'oracle-ddl'
      ddl = String(row.ddl ?? '').trim()
      if (q.mode === 'oracle-ddl' && q.bodySql) {
        try {
          const rb = await client.connections.execute(connId, q.bodySql, [], {
            database: ctx.database,
            schema: ctx.schema,
          })
          const body = String((rb.rows[0] as Record<string, unknown>)?.ddl ?? '').trim()
          if (body) ddl = `${ddl}\n/\n\n${body}`
        } catch {
          // 缺 body（spec-only 包 / 简单类型）→ 忽略。
        }
      }
    }
    if (!ddl) {
      await appAlert({ message: t('ws.noDef'), variant: 'warn' })
      return
    }
    await navigator.clipboard?.writeText(ddl)
    toast.success(t('ws.ddlCopied'))
  } catch (e) {
    reportError(e, { tag: 'ws.genSqlFail' })
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
    reportError(e, { tag: 'ws.emptyTableFail' })
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
    reportError(e, { tag: 'ws.truncateTableFail' })
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
  const sql = ['mysql', 'mariadb', 'oceanbase', 'gbase8a'].includes(conn.dialect)
    ? `RENAME TABLE ${ref} TO ${newQuoted}`
    : `ALTER TABLE ${ref} RENAME TO ${newQuoted}`
  try {
    await client.connections.execute(connId, sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    if (node.parent) await navRef.value?.refreshNode(node.parent, connId)
  } catch (e) {
    reportError(e, { tag: 'ws.renameTableFail' })
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
  const fam = ['mysql', 'mariadb', 'oceanbase', 'gbase8a'].includes(conn.dialect)
    ? 'mysql'
    : ['postgresql', 'kingbase', 'vastbase', 'mogdb', 'panweidb', 'highgo'].includes(conn.dialect)
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
  kind: 'sequence' | 'event' | 'trigger' | 'package' | 'type' | 'synonym',
  connId: string,
  node: TreeNode,
): Promise<void> {
  const conn = await client.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  const fam = ['mysql', 'mariadb', 'oceanbase', 'gbase8a'].includes(conn.dialect)
    ? 'mysql'
    : ['postgresql', 'kingbase', 'vastbase', 'mogdb', 'panweidb', 'highgo'].includes(conn.dialect)
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
  } else if (familyOf(conn.dialect) === 'oracle') {
    // Oracle/DM 家族：包/序列/触发器/类型/同义词的可编辑 SQL 模板。
    const schema = ctx.schema ?? ctx.database ?? 'SCHEMA'
    const s = (n: string) => `${q(schema)}.${q(n)}`
    if (kind === 'sequence') {
      sql = `CREATE SEQUENCE ${s('NEW_SEQUENCE')}\n  START WITH 1\n  INCREMENT BY 1\n  MINVALUE 1\n  NOCACHE;`
      title = t('ws.tabNewSequence')
    } else if (kind === 'trigger') {
      sql = `CREATE OR REPLACE TRIGGER ${s('NEW_TRIGGER')}\n  BEFORE INSERT ON ${q(schema)}.${q('TARGET_TABLE')}\n  FOR EACH ROW\nBEGIN\n  NULL;\nEND;`
      title = t('ws.tabNewTrigger')
    } else if (kind === 'package') {
      sql = `CREATE OR REPLACE PACKAGE ${s('NEW_PACKAGE')} AS\n  PROCEDURE hello;\nEND;\n/\n\nCREATE OR REPLACE PACKAGE BODY ${s('NEW_PACKAGE')} AS\n  PROCEDURE hello IS\n  BEGIN\n    NULL;\n  END;\nEND;\n/`
      title = t('ws.tabNewPackage')
    } else if (kind === 'type') {
      sql = `CREATE OR REPLACE TYPE ${s('NEW_TYPE')} AS OBJECT (\n  id NUMBER\n);`
      title = t('ws.tabNewType')
    } else if (kind === 'synonym') {
      sql = `CREATE OR REPLACE SYNONYM ${s('NEW_SYNONYM')} FOR ${q('TARGET_SCHEMA')}.${q('TARGET_OBJECT')};`
      title = t('ws.tabNewSynonym')
    } else {
      await appAlert({ message: t('ws.defUnsupported'), variant: 'warn' })
      return
    }
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
    // Oracle/DM: definitionQuery 不覆盖 → 走 dbms_metadata.get_ddl（含 spec+body）。
    if (familyOf(conn.dialect) === 'oracle') {
      await onCopyToDraftViaDdl(connId, node, conn)
      return
    }
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
    reportError(e, { tag: 'ws.viewDefFail' })
  }
}

// Oracle/DM「查看定义」回退：用 objectDdlQuery 拉 DDL（含包/类型的 body），开草稿页。
async function onCopyToDraftViaDdl(
  connId: string,
  node: TreeNode,
  conn: ConnectionConfig,
): Promise<void> {
  const ctx = deriveContext(conn.dialect, node)
  const q = objectDdlQuery(
    conn.dialect,
    node.kind as ObjectKind,
    objectRef(conn.dialect, node),
    node,
  )
  if (!q) {
    await appAlert({ message: t('ws.defUnsupported'), variant: 'warn' })
    return
  }
  try {
    const ddl = await runOracleDdl(connId, q, ctx)
    if (!ddl) {
      await appAlert({ message: t('ws.noDef'), variant: 'warn' })
      return
    }
    tabsRef.value?.openDraft(conn, ddl, t('ws.tabDef', { name: node.name }))
  } catch (e) {
    reportError(e, { tag: 'ws.viewDefFail' })
  }
}

// 执行 oracle-ddl 取定义：主 sql 取 spec，bodySql 取 body（可能不存在 → 静默忽略）。
async function runOracleDdl(
  connId: string,
  q: { sql: string; bodySql?: string },
  ctx: { database?: string; schema?: string },
): Promise<string> {
  const exec = async (sql: string): Promise<string> => {
    const r = await client.connections.execute(connId, sql, [], {
      database: ctx.database,
      schema: ctx.schema,
    })
    const row = (r.rows[0] as Record<string, unknown> | undefined) ?? {}
    return String(row.ddl ?? '').trim()
  }
  let ddl = await exec(q.sql)
  if (q.bodySql) {
    try {
      const body = await exec(q.bodySql)
      if (body) ddl = `${ddl}\n/\n\n${body}`
    } catch {
      // spec-only 包 / 无 body 的类型 → ORA-31603，忽略。
    }
  }
  return ddl
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
    reportError(e, { tag: 'ws.genSqlTemplateFail' })
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
    reportError(e, { tag: 'ws.exportTableFail' })
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
    reportError(e, { tag: 'ws.exportSchemaFail' })
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

/**
 * 顺序执行批量删除 — 用 buildBulkDrop() 把同 (connId, kind, schema) 的对象
 * 聚合成一条多目标 DROP, 减少 round trip (#25). 不能 batch 的方言 (Oracle/DM/SQLite)
 * 自动退化为单条循环. 任一 chunk 报错即停, done 计数保留, 用户改完可"继续".
 */
async function confirmBulkDrop(): Promise<void> {
  const b = bulkDropState.value
  if (!b) return
  b.busy = true
  b.error = null
  const parents = new Map<TreeNode, string>()
  // Bucket by (connId, dialect). All items in one bucket share a driver and
  // can be planned together by buildBulkDrop.
  const byConn = new Map<
    string,
    { dialect: DbDialect; items: { connId: string; node: TreeNode }[] }
  >()
  for (let i = b.done; i < b.items.length; i++) {
    const it = b.items[i]
    let arr = byConn.get(it.connId)
    if (!arr) {
      arr = { dialect: it.dialect, items: [] }
      byConn.set(it.connId, arr)
    }
    arr.items.push({ connId: it.connId, node: it.node })
    if (it.node.parent) parents.set(it.node.parent, it.connId)
  }
  // Build the SQL plan per connection. Each chunk's `count` is the number of
  // original nodes covered; we use that to advance `b.done` in lockstep.
  const plan: { connId: string; chunk: BulkSqlChunk }[] = []
  for (const [connId, group] of byConn) {
    const chunks = buildBulkDrop(group.dialect, group.items, b.cascade)
    for (const c of chunks) plan.push({ connId, chunk: c.chunk })
  }
  try {
    for (const p of plan) {
      await client.connections.execute(p.connId, p.chunk.sql, [], {
        database: p.chunk.ctx.database,
        schema: p.chunk.ctx.schema,
      })
      b.done += p.chunk.count
    }
    bulkDropState.value = null
    navRef.value?.clearMulti()
    for (const [parent, connId] of parents) navRef.value?.refreshNode(parent, connId)
  } catch (e) {
    b.error = e instanceof Error ? e.message : String(e)
    b.busy = false
  }
}

// ── 批量 TRUNCATE (#25) ──
async function onBulkTruncate(items: { connId: string; node: TreeNode }[]): Promise<void> {
  if (!items.length) return
  const ok = await appConfirm({
    title: t('common.confirm'),
    message: `确定 TRUNCATE ${items.length} 张表? 表里数据全清, 不可回滚.`,
    variant: 'warn',
  })
  if (!ok) return
  // Resolve dialect per connection.
  const connCache = new Map<string, ConnectionConfig>()
  const byConn = new Map<
    string,
    { dialect: DbDialect; items: { connId: string; node: TreeNode }[] }
  >()
  for (const it of items) {
    let conn = connCache.get(it.connId)
    if (!conn) {
      conn = await client.connections.get(it.connId)
      connCache.set(it.connId, conn)
    }
    let arr = byConn.get(it.connId)
    if (!arr) {
      arr = { dialect: conn.dialect, items: [] }
      byConn.set(it.connId, arr)
    }
    arr.items.push(it)
  }
  // Plan: ask buildBulkTruncate per (conn, dialect).
  const plan: { connId: string; chunk: BulkSqlChunk }[] = []
  for (const [connId, group] of byConn) {
    for (const c of buildBulkTruncate(group.dialect, group.items)) {
      plan.push({ connId, chunk: c.chunk })
    }
  }
  if (!plan.length) return
  const labels = plan.map((p) =>
    p.chunk.count > 1
      ? `TRUNCATE ${p.chunk.names.length} 张表 (${p.chunk.names.join(', ')})`
      : `TRUNCATE ${p.chunk.names[0]}`,
  )
  bulkRunState.value = {
    title: '批量 TRUNCATE',
    labels,
    run: async (i) => {
      const p = plan[i]
      await client.connections.execute(p.connId, p.chunk.sql, [], {
        database: p.chunk.ctx.database,
        schema: p.chunk.ctx.schema,
      })
    },
    busy: false,
    done: 0,
    error: null,
    onDone: () => navRef.value?.clearMulti(),
  }
}

// ── 批量复制 SELECT 模板 (#25) ──
async function onBulkCopySelect(items: { connId: string; node: TreeNode }[]): Promise<void> {
  // Resolve dialect once per conn so we can fully qualify identifiers.
  const connCache = new Map<string, ConnectionConfig>()
  const lines: string[] = []
  for (const it of items) {
    let conn = connCache.get(it.connId)
    if (!conn) {
      conn = await client.connections.get(it.connId)
      connCache.set(it.connId, conn)
    }
    const ref = it.node.sqlName ?? quoteId(conn.dialect, it.node.name)
    lines.push(`SELECT * FROM ${ref};`)
  }
  const text = lines.join('\n')
  try {
    await navigator.clipboard?.writeText(text)
    toast.success(`已复制 ${lines.length} 条 SELECT 模板`, 2000)
  } catch (e) {
    reportError(e, { tag: 'bulk-copy-select' })
  }
}

// ── 批量导出 DDL (#25) ──
async function onBulkExportDdl(items: { connId: string; node: TreeNode }[]): Promise<void> {
  if (!items.length) return
  const connCache = new Map<string, ConnectionConfig>()
  // Build a single .sql blob: for each object, SHOW CREATE / pg_get_viewdef /
  // dbms_metadata.get_ddl etc. Run them sequentially with fail-fast, but
  // collect any per-item failure as a SQL comment so the user can keep going.
  const labels = items.map((it) => `${it.node.kind} · ${it.node.sqlName ?? it.node.name}`)
  const sections: string[] = []
  bulkRunState.value = {
    title: '批量导出 DDL',
    labels,
    run: async (i) => {
      const it = items[i]
      let conn = connCache.get(it.connId)
      if (!conn) {
        conn = await client.connections.get(it.connId)
        connCache.set(it.connId, conn)
      }
      // Tables: use copyDdl path which already exists via DDL pipeline.
      // For other kinds, lean on objectDdlQuery from ddl.ts.
      const ddl = await fetchObjectDdl(conn, it.node)
      const header = `-- ${it.node.kind.toUpperCase()}: ${it.node.sqlName ?? it.node.name}`
      sections.push(`${header}\n${ddl ?? '-- (无法获取 DDL)'}\n`)
    },
    busy: false,
    done: 0,
    error: null,
    onDone: async () => {
      const content = sections.join('\n')
      const filename = `skylerx_ddl_${new Date().toISOString().slice(0, 10)}.sql`
      try {
        const w = window as unknown as {
          api?: {
            files?: {
              saveText: (req: { defaultName: string; content: string }) => Promise<string | null>
            }
          }
        }
        const saved = await w.api?.files?.saveText?.({ defaultName: filename, content })
        if (saved) toast.success(`DDL 已写到 ${saved}`, 3000)
      } catch (e) {
        // Fall back to copying to clipboard so the user can still rescue it.
        try {
          await navigator.clipboard?.writeText(content)
          toast.warn('保存失败,已复制到剪贴板', 3000)
        } catch (ee) {
          reportError(ee, { tag: 'bulk-export-ddl-fallback-copy' })
        }
      }
      navRef.value?.clearMulti()
    },
  }
}

/**
 * Best-effort DDL fetch for a single object. Reuses the same SHOW CREATE /
 * pg_get_viewdef / dbms_metadata.get_ddl paths the DDL editor uses, but
 * trimmed to "give me a string" semantics.
 */
async function fetchObjectDdl(conn: ConnectionConfig, node: TreeNode): Promise<string | null> {
  if (node.kind === MetaNodeKind.Table) {
    // SHOW CREATE TABLE / equivalent
    try {
      const family = familyOf(conn.dialect)
      if (family === 'mysql') {
        const r = await client.connections.execute(
          conn.id,
          `SHOW CREATE TABLE ${node.sqlName ?? node.name}`,
        )
        const row = r.rows[0] as Record<string, unknown> | undefined
        if (!row) return null
        const key = Object.keys(row).find((k) => /^create/i.test(k))
        return key ? String(row[key]) : null
      }
      if (family === 'pg') {
        // pg_get_tabledef is non-standard; we fall back to a column-list reconstruct.
        const ctx = node.path
        const schema = ctx.length >= 2 ? ctx[ctx.length - 2] : 'public'
        const r = await client.connections.execute(
          conn.id,
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = '${schema}' AND table_name = '${node.name}'
           ORDER BY ordinal_position`,
        )
        if (!r.rows.length) return null
        const cols = r.rows.map((c) => {
          const cc = c as Record<string, unknown>
          const def = cc.column_default ? ` DEFAULT ${String(cc.column_default)}` : ''
          const nn = cc.is_nullable === 'NO' ? ' NOT NULL' : ''
          return `  ${cc.column_name} ${cc.data_type}${nn}${def}`
        })
        return `CREATE TABLE ${node.sqlName ?? `"${schema}"."${node.name}"`} (\n${cols.join(',\n')}\n);`
      }
    } catch {
      return null
    }
    return null
  }
  // Views / functions / procedures / triggers / sequences / packages / types / synonyms
  const ref = node.sqlName ?? node.name
  const q = objectDdlQuery(conn.dialect, node.kind as ObjectKind, ref, node)
  if (!q) return null
  try {
    const r = await client.connections.execute(conn.id, q.sql)
    const row = r.rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    if (q.mode === 'showCreate') {
      const key = Object.keys(row).find((k) => /^create/i.test(k))
      return key ? String(row[key]) : null
    }
    const spec = String(row.ddl ?? '').trim()
    if (q.mode === 'oracle-ddl' && q.bodySql) {
      try {
        const rb = await client.connections.execute(conn.id, q.bodySql)
        const body = String((rb.rows[0] as Record<string, unknown>)?.ddl ?? '').trim()
        if (body) return `${spec}\n/\n\n${body}`
      } catch {
        // 缺 body → 只用 spec。
      }
    }
    return spec
  } catch {
    return null
  }
}

// ── 连接级批量操作 (#25) ──
async function onBulkDeleteConnections(connIds: string[]): Promise<void> {
  if (!connIds.length) return
  const ok = await appConfirm({
    title: t('common.confirm'),
    message: `确定删除 ${connIds.length} 个连接? 此操作不可撤销 (连接配置 + 本地缓存的密码一并清除).`,
    variant: 'danger',
  })
  if (!ok) return
  const errors: string[] = []
  for (const id of connIds) {
    try {
      await client.connections.remove(id)
      tabsRef.value?.closeConnTabs(id)
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await navRef.value?.reload()
  navRef.value?.clearMulti()
  if (errors.length) {
    reportError(new Error(`部分连接删除失败:\n${errors.join('\n')}`), { tag: 'bulk-delete-conn' })
  } else {
    toast.success(`已删除 ${connIds.length} 个连接`)
  }
}

async function onBulkMoveToGroup(connIds: string[]): Promise<void> {
  if (!connIds.length) return
  // 收集已有分组 → 作为 combobox 下拉候选;也可手输新名(不存在则创建)。
  const all = await client.connections.list()
  const existingGroups = new Set<string>()
  for (const c of all) if (c.group) existingGroups.add(c.group)
  for (const g of settings.groupOrder) existingGroups.add(g)
  const choices = [...existingGroups].sort()
  const picked = await appPrompt({
    title: `移动 ${connIds.length} 个连接到分组`,
    message: '从下拉里选已有分组,或直接输入新分组名(不存在则创建)。留空 = 取消分组。',
    defaultValue: '',
    placeholder: '分组名(留空 = 取消分组)',
    options: choices,
  })
  if (picked == null) return // 用户取消
  const trimmed = picked.trim() // 前后去空白
  const targetGroup: string | undefined = trimmed === '' ? undefined : trimmed
  // 新分组名持久化到 groupOrder(保证空组也能显示、可排序)。
  if (targetGroup && !choices.includes(targetGroup)) {
    settings.groupOrder = [...settings.groupOrder, targetGroup]
  }
  const errors: string[] = []
  for (const id of connIds) {
    try {
      const full = await client.connections.get(id)
      full.group = targetGroup
      await client.connections.update(full)
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  await navRef.value?.reload()
  navRef.value?.clearMulti()
  if (errors.length) {
    reportError(new Error(`部分移动失败:\n${errors.join('\n')}`), { tag: 'bulk-move-group' })
  } else {
    toast.success(
      targetGroup
        ? `已移动 ${connIds.length} 个连接到「${targetGroup}」`
        : `已把 ${connIds.length} 个连接移出分组`,
    )
  }
}

async function onBulkTestConnections(connIds: string[]): Promise<void> {
  if (!connIds.length) return
  const labels: string[] = []
  const tests: Array<() => Promise<{ id: string; ok: boolean; msg: string; ms?: number }>> = []
  for (const id of connIds) {
    const full = await client.connections.get(id)
    labels.push(`测试 ${full.name}`)
    tests.push(async () => {
      try {
        const r = await client.connections.test(full)
        return {
          id,
          ok: r.ok,
          msg: r.ok
            ? `OK ${r.serverVersion ?? ''} (${r.latencyMs ?? '?'} ms)`
            : r.message || '失败',
          ms: r.latencyMs,
        }
      } catch (e) {
        return { id, ok: false, msg: e instanceof Error ? e.message : String(e) }
      }
    })
  }
  // Parallel run (max 6 at a time to avoid clobbering the user's network).
  const concurrency = Math.min(6, tests.length)
  const results: { id: string; ok: boolean; msg: string }[] = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < tests.length) {
        const i = cursor++
        results.push(await tests[i]())
      }
    }),
  )
  const okCount = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok)
  navRef.value?.clearMulti()
  if (failed.length === 0) {
    toast.success(`全部 ${okCount} 个连接通过`, 3000)
  } else {
    const summary = failed.map((r) => `- ${r.id}: ${r.msg}`).join('\n')
    reportError(new Error(`${failed.length} / ${connIds.length} 失败:\n${summary}`), {
      tag: 'bulk-test-conn',
    })
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
/** Redis 新建 key 弹窗(per db) */
const redisNewKeyOpen = ref<{ conn: ConnectionConfig; dbIndex: number; parent: TreeNode } | null>(
  null,
)
/** Redis 跨库搜索弹窗 */
const redisSearchOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** Redis 导入/导出 弹窗(共用一个组件,mode 切换) */
const redisIeOpen = ref<{
  conn: ConnectionConfig
  dbIndex: number
  mode: 'import' | 'export'
} | null>(null)
/** Redis 服务器信息面板(INFO / 慢日志 / 客户端 / 命令统计 / CONFIG / Cluster / Sentinel) */
const redisServerInfoOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** Redis 大 key 排行 */
const redisBigKeysOpen = ref<{ conn: ConnectionConfig; dbIndex: number } | null>(null)
/** Redis Lua/Functions 编辑器 */
const redisScriptOpen = ref<{ conn: ConnectionConfig; dbIndex?: number } | null>(null)
/** Redis 实时监控(INFO stats 轮询) */
const redisMonitorOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** Mongo 集合 stats/索引 面板 */
const mongoCollInfoOpen = ref<{
  conn: ConnectionConfig
  database: string
  collection: string
} | null>(null)
/** Mongo aggregation pipeline 弹窗 */
const mongoAggOpen = ref<{ conn: ConnectionConfig; database: string; collection: string } | null>(
  null,
)
/** OB/TiDB 集群拓扑 */
const clusterTopoOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** PG 高级面板(扩展/复制/复制槽) */
const pgAdvOpen = ref<{ conn: ConnectionConfig; database?: string } | null>(null)
/** ClickHouse 高级面板(分区/Mutation/副本/TTL) */
const chAdvOpen = ref<{ conn: ConnectionConfig; database?: string } | null>(null)
/** Doris/StarRocks 分区管理 */
const mppPartOpen = ref<{ conn: ConnectionConfig; database?: string; table?: string } | null>(null)
/** MySQL 高级面板(binlog/主从/变量) */
const mysqlAdvOpen = ref<{ conn: ConnectionConfig } | null>(null)
/** PII 扫描器 */
const piiScanOpen = ref<{ conn: ConnectionConfig; database?: string; schema?: string } | null>(null)
/** 数据脱敏视图 */
const maskingViewOpen = ref<{
  conn: ConnectionConfig
  database?: string
  schema?: string
  table?: string
} | null>(null)
/** AI Insights(慢 SQL + 错误根因) */
const aiInsightsOpen = ref<{
  conn: ConnectionConfig
  prefillSql?: string
  prefillError?: string
  initialTab?: 'slow' | 'error'
} | null>(null)
/** AI schema 反向工程 */
const aiSchemaRevOpen = ref<{ conn: ConnectionConfig; database?: string } | null>(null)
/** Excel/CSV 粘贴智能导入 */
const pasteImportOpen = ref<{ preferConnId?: string; prefillRows?: string[][] } | null>(null)
/** AI 建表助手(对话式) */
const aiArchOpen = ref<{ conn: ConnectionConfig; database?: string } | null>(null)
/** Workspace 导出/导入 */
const wsExportOpen = ref<boolean>(false)
/** #24: 配置可见库/Schema 过滤 — 携带的 conn 用于 dialog 初始化 + 保存 */
const navFilterOpen = ref<ConnectionConfig | null>(null)
async function onConfigureNavFilter(connId: string): Promise<void> {
  navFilterOpen.value = await client.connections.get(connId)
}

/** #D: 进程/会话列表 */
const processListOpen = ref<ConnectionConfig | null>(null)
async function onOpenProcessList(connId: string): Promise<void> {
  processListOpen.value = await client.connections.get(connId)
}

/** #B: 结果集图表 viewer — 只在打开时持有 result snapshot, 关掉就丢. */
const chartOpen = ref<import('@db-tool/shared-types').QueryResult | null>(null)
function onOpenChart(r: import('@db-tool/shared-types').QueryResult): void {
  chartOpen.value = r
}
/** 新建数据库弹窗(per 连接) */
const newDbOpen = ref<{ conn: ConnectionConfig; parent: TreeNode } | null>(null)
/** 新建 Schema 弹窗(per 连接 + 可选父库) */
const newSchemaOpen = ref<{
  conn: ConnectionConfig
  database?: string
  parent: TreeNode
} | null>(null)
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
const lintRulesOpen = ref(false)
const sqlLineageOpen = ref(false)
const notebookOpen = ref(false)
const resultDiffOpen = ref(false)
const ragOpen = ref(false)
const erOpen = ref(false)
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

/** OceanBase 集群拓扑（信创差异化能力，仅 OceanBase 方言可入口）。 */
const obTopoOpen = ref<{ conn: ConnectionConfig } | null>(null)
async function openObTopology(connId: string): Promise<void> {
  const conn = await client.connections.get(connId)
  obTopoOpen.value = { conn }
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
/**
 * 真实版本号 — 启动时从主进程 system:getVersion IPC 拉取(打包时 CI 已经把 tag 同步到 package.json)
 * dev / web 端 IPC 不可用时回退到 'dev'
 */
const APP_VERSION = ref('dev')
void (async () => {
  try {
    const sys = (window as unknown as { api?: { system?: { getVersion: () => Promise<string> } } })
      .api?.system
    if (sys) APP_VERSION.value = await sys.getVersion()
  } catch {
    /* 保持 'dev' */
  }
})()

/**
 * `import.meta.env.DEV` is injected by Vite — true under `electron-vite dev`,
 * false in any packaged build. Cast through the `ImportMeta` shape because
 * `packages/ui`'s tsconfig doesn't reference `vite/client`; the runtime value
 * is what matters and is correctly set by both the desktop renderer and the
 * website build.
 */
const isDevBuild = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true

// ── #17 NavTree drag-to-resize ───────────────────────────────────────────
/**
 * 拖动期间不写 settings.navWidth(那会每帧触发持久化 watch),只直接改
 * :root 的 --nav-width 变量;mouseup 才把最终值落到 settings.navWidth.
 * dblclick 重置到默认 300px.
 */
const navResizing = ref(false)

function onNavResizerDown(e: MouseEvent): void {
  // 起始光标 X + 起始宽度(从 settings 读,跟当前 CSS var 同步)
  const startX = e.clientX
  const startW = clampNavWidth(settings.navWidth)
  navResizing.value = true
  // 整窗 ondragstart 在 NavTree 里很常见(连接拖拽),拖宽期间禁用文本选中
  // 跟原生拖拽行为, 否则光标在右侧 main 里掠过会选中查询编辑器文本.
  const prevUserSelect = document.body.style.userSelect
  const prevCursor = document.body.style.cursor
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'

  function onMove(ev: MouseEvent): void {
    const next = clampNavWidth(startW + (ev.clientX - startX))
    document.documentElement.style.setProperty('--nav-width', `${next}px`)
  }
  function onUp(): void {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.userSelect = prevUserSelect
    document.body.style.cursor = prevCursor
    navResizing.value = false
    // 读回最终 CSS 变量,写到 settings → 触发持久化 + applyNavWidth(幂等).
    const finalRaw = document.documentElement.style.getPropertyValue('--nav-width').trim()
    const finalW = clampNavWidth(Number.parseFloat(finalRaw) || startW)
    if (finalW !== settings.navWidth) settings.navWidth = finalW
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onNavResizerReset(): void {
  settings.navWidth = 300
}

// 暴露给模板里 readonly 引用,clamp 上下限可见(虽未实际渲染,留作未来 tooltip)
void NAV_WIDTH_MIN
void NAV_WIDTH_MAX
/**
 * 更新 UI 状态(完全由 main 进程的 updates:status 事件驱动)。
 * - dev 模式下 main 端 autoUpdater 不启用,IPC 会回 devMode=true,UI 退回 GitHub 链接
 * - packaged 模式下 main 自动 forward checking/available/downloading/downloaded/error 事件,
 *   downloading 时显示进度条,downloaded 后按钮变"立即重启安装"
 */
type UpdaterStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'available'
      info: {
        version: string
        releaseNotes?: string
        releaseDate?: string
        releaseName?: string
      }
    }
  | { kind: 'not-available'; currentVersion: string }
  | {
      kind: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { kind: 'downloaded'; info: { version: string } }
  | { kind: 'error'; message: string }

const updateStatus = ref<UpdaterStatus>({ kind: 'idle' })
const updateDevMode = ref(false)
// dev 模式 fallback:从 GitHub API 拉 latest tag 给用户看(同样会被 CSP 拦,
// connect-src 已开 api.github.com 解掉),不能下载安装,只给个链接
const updateDevLatest = ref<string | null>(null)
const updateDevError = ref<string | null>(null)

const desktopApi = (): {
  updates?: {
    check: () => Promise<{ devMode?: boolean; ok?: boolean; error?: string }>
    downloadAndInstall: () => Promise<{ devMode?: boolean; ok?: boolean; error?: string }>
    install: () => Promise<{ devMode?: boolean; ok?: boolean }>
    getStatus: () => Promise<UpdaterStatus>
    onStatus: (cb: (s: UpdaterStatus) => void) => () => void
  }
} | null =>
  typeof window !== 'undefined'
    ? (((window as unknown as { api?: unknown }).api as never) ?? null)
    : null

async function checkForUpdate(): Promise<void> {
  const api = desktopApi()
  if (!api?.updates) {
    // 非桌面端(理论上不会走到,Workspace 当前仅 desktop 用),走老的 fetch fallback
    await checkForUpdateBrowserFallback()
    return
  }
  updateStatus.value = { kind: 'checking' }
  const r = await api.updates.check()
  if (r.devMode) {
    updateDevMode.value = true
    await checkForUpdateBrowserFallback()
  } else if (r.error) {
    updateStatus.value = { kind: 'error', message: r.error }
  }
  // 成功:具体 status 通过 onStatus 事件回流,不在这里赋值
}

async function downloadAndInstallUpdate(): Promise<void> {
  const api = desktopApi()
  if (!api?.updates) return
  const r = await api.updates.downloadAndInstall()
  if (r.error) updateStatus.value = { kind: 'error', message: r.error }
}

/**
 * dev / web fallback for "has a new version shipped?".
 *
 * Was hitting api.github.com directly from the renderer (#13): on rate-limit
 * (60/hour unauth) or corporate proxies the call returned 403 and the dev
 * "update available?" UI broke. Now goes through a main-process IPC that
 * tries OSS first (no auth, no rate limit) then GitHub. Renderer-side fetch
 * to api.github.com is removed entirely.
 *
 * Web build (no `window.api`): fallback to a single OSS index.json fetch
 * locally; OSS doesn't rate-limit and has CORS open to `skyler.uno`.
 */
async function checkForUpdateBrowserFallback(): Promise<void> {
  const api = (
    window as unknown as {
      api?: {
        system?: {
          peekLatestVersion?: () => Promise<{
            tag: string
            source: 'oss' | 'github' | 'none'
            error?: string
          }>
        }
      }
    }
  ).api
  // Desktop dev path — main-process IPC.
  if (api?.system?.peekLatestVersion) {
    try {
      const r = await api.system.peekLatestVersion()
      if (r.tag) {
        updateDevLatest.value = r.tag
        updateDevError.value = null
      } else {
        updateDevError.value = r.error || '未拿到最新版本'
      }
    } catch (e) {
      updateDevError.value = e instanceof Error ? e.message : String(e)
    }
    return
  }
  // Web build path — OSS index.json directly (no auth, no rate limit).
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8_000)
  try {
    const res = await fetch(
      'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/index.json',
      { signal: ac.signal },
    )
    if (!res.ok) throw new Error(`OSS HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string }
    updateDevLatest.value = (data.tag_name ?? '').replace(/^v/, '')
    updateDevError.value = null
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError'
    updateDevError.value = isAbort ? '请求超时(>8s)' : e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timer)
  }
}

// 启动时订阅 main 推过来的更新状态 + 日志,组件卸载时取消
interface UpdaterLog {
  ts: number
  level: 'info' | 'warn' | 'error'
  msg: string
}
const updateLogs = ref<UpdaterLog[]>([])
const showUpdateLogs = ref(false)

let unsubUpdateStatus: (() => void) | null = null
let unsubUpdateLog: (() => void) | null = null
onMounted(() => {
  const api = desktopApi() as {
    updates?: {
      getStatus: () => Promise<unknown>
      onStatus: (cb: (s: unknown) => void) => () => void
      getLogs?: () => Promise<UpdaterLog[]>
      onLog?: (cb: (log: UpdaterLog) => void) => () => void
    }
  } | null
  if (!api?.updates) return
  void api.updates.getStatus().then((s) => {
    if (s && (s as UpdaterStatus).kind) updateStatus.value = s as UpdaterStatus
  })
  unsubUpdateStatus = api.updates.onStatus((s) => {
    updateStatus.value = s as UpdaterStatus
  })
  // 调试日志:启动时拉历史 + 实时订阅追加
  void api.updates.getLogs?.().then((logs) => {
    if (logs) updateLogs.value = logs.slice(-50)
  })
  unsubUpdateLog =
    api.updates.onLog?.((log) => {
      updateLogs.value = [...updateLogs.value.slice(-49), log]
    }) ?? null
})
onUnmounted(() => {
  unsubUpdateStatus?.()
  unsubUpdateStatus = null
  unsubUpdateLog?.()
  unsubUpdateLog = null
})
function fmtLogTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
async function copyUpdateLogs(): Promise<void> {
  const text = updateLogs.value.map((l) => `${fmtLogTime(l.ts)} [${l.level}] ${l.msg}`).join('\n')
  try {
    await navigator.clipboard?.writeText(text)
    toast.success('日志已复制', 1500)
  } catch {
    /* ignore */
  }
}

/**
 * 「提交 Issue」入口 (#13 用户期望流程):
 *   1. 复制环境信息 markdown 到剪贴板 (SkylerX 版本 / 通道 / OS+arch /
 *      Electron-Node-Chrome / locale / tz);
 *   2. toast 提示"已复制环境信息";
 *   3. 留 ~700ms 让 toast 视觉停留, 再 window.open 出 issues 页 —
 *      立即开会被外部浏览器抢焦点, 用户看不到 toast.
 *   4. clipboard 失败 / env IPC 失败 / 任何 throw 都不能拦跳转.
 *
 * 不再用 `<a target="_blank">`: Electron 的 target="_blank" 在某些版本里
 * 跟我们 @click 抢 default action — preventDefault 还没生效, blink 层就
 * 已经把 navigation 派给 setWindowOpenHandler 跑 shell.openExternal,
 * 我们的复制+toast 整个被跳过. 改为 `<a href="#" @click.prevent>` +
 * 程序化 window.open, 行为可预期.
 */
function openIssuesWithEnv(): void {
  const issuesUrl = 'https://github.com/duhbbx/SkylerX/issues'
  // 异步逻辑在 IIFE 里; @click.prevent 已在模板侧 preventDefault, 这里
  // 不需要 e 参数, 也避免 async event handler 的类型噪音.
  void (async () => {
    let copied = false
    try {
      let env: EnvSummary | null = getEnvCache()
      if (!env) {
        const api = (
          window as unknown as {
            api?: { system?: { getEnvSummary?: () => Promise<EnvSummary> } }
          }
        ).api
        env = (await api?.system?.getEnvSummary?.()) ?? null
      }
      if (env && navigator.clipboard?.writeText) {
        const md = formatEnvBlock(env).replace(/^\n/, '') // 去掉前导空行,贴 issue 直接渲染
        await navigator.clipboard.writeText(md)
        toast.success('已复制提交 issue 所需的环境信息', 2500)
        copied = true
      } else if (!env) {
        toast.warn('环境信息暂未就绪,跳过复制直接跳转 issue 页', 2500)
      } else {
        toast.warn('剪贴板不可用,跳过复制直接跳转 issue 页', 2500)
      }
    } catch (err) {
      toast.warn(
        `环境信息复制失败 (${err instanceof Error ? err.message : String(err)}),仍跳转 issue 页`,
        3000,
      )
    }
    // 给 toast ~700ms 出场+视觉停留, 再开外部浏览器. 复制失败时短一点.
    const delay = copied ? 700 : 400
    setTimeout(() => {
      window.open(issuesUrl, '_blank', 'noopener')
    }, delay)
  })()
}

const updateBtnLabel = computed(() => {
  switch (updateStatus.value.kind) {
    case 'checking':
      return t('about.checking')
    case 'downloading':
      return `下载中 ${Math.round(updateStatus.value.percent)}%`
    case 'downloaded':
      return '立即重启安装'
    case 'available':
      return `下载并安装 v${updateStatus.value.info.version}`
    default:
      return t('about.check')
  }
})
function onUpdateBtnClick(): void {
  const s = updateStatus.value
  if (s.kind === 'available' || s.kind === 'downloaded') void downloadAndInstallUpdate()
  else if (s.kind !== 'checking' && s.kind !== 'downloading') void checkForUpdate()
}

/** ISO 时间转 "2026-05-30 18:30" 这种可读格式;失败回退原值 */
function formatReleaseDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
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
 * 错误总线 (ChatErrorAsk) 全局监听：任意 alert({ askAi }) 或 ConnectionForm
 * 错误 banner 上的「✨ 问 AI」按钮都会 emit ChatErrorAskEvent，统一到这里转给
 * onAskAiAboutError 把上下文 (SQL/错误码/连接) 打到右侧 AI 聊天面板。
 *
 * 把 errorCode 拼到 error 文本前（而不是分字段传）的原因：AiChatPanel.askAboutError
 * 现有签名只认 { connId, connName?, sql, error }，改它会牵动 ResultGrid 的对接，
 * 错误码当成 error 前缀更省事——AI 模型也吃得下「[MySQL 1062] Duplicate entry」这种格式。
 */
let chatErrorAskOff: (() => void) | null = null
onMounted(() => {
  chatErrorAskOff = onChatErrorAsk((e) => {
    const errText = e.errorCode ? `[${e.errorCode}] ${e.error}` : e.error
    void onAskAiAboutError({
      connId: e.connId ?? '',
      connName: e.connName,
      sql: e.sql ?? '',
      error: errText,
    })
  })
})
onUnmounted(() => {
  chatErrorAskOff?.()
  chatErrorAskOff = null
})

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
  // OceanBase 集群拓扑（仅 OB 方言可见；其他方言显示无意义）
  ...paletteConns.value
    .filter((c) => c.dialect === DbDialect.OceanBase)
    .map((c) => ({
      id: `act:obtopo:${c.id}`,
      label: `${t('pal.obTopology')} · ${c.name || c.dialect}`,
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
  // #8 NDJSON 文件查看器（参考 dbgate）
  { id: 'act:ndjson-viewer', label: t('pal.ndjsonViewer'), group: t('pal.groupActions') },
  // #6 可视化查询构建器（参考 dbgate Query Designer），按连接生成
  ...paletteConns.value.map((c) => ({
    id: `act:vqd:${c.id}`,
    label: `${t('pal.vqd')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // Oracle → DM 迁移向导（信创外包高频）
  { id: 'act:o2dm', label: t('o2dm.title'), group: t('pal.groupActions') },
  // 信创迁移评估（源库画像 + 等级 + AI 转换）
  { id: 'act:mig-assess', label: t('mig.title'), group: t('pal.groupActions') },
  // 慢查询日志分析（按连接）
  ...paletteConns.value.map((c) => ({
    id: `act:slowq:${c.id}`,
    label: `${t('slowq.title')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // 存储容量趋势 + 预测（按连接）
  ...paletteConns.value.map((c) => ({
    id: `act:capacity:${c.id}`,
    label: `${t('capacity.title')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
  // 等保 2.0 合规检查（按连接）
  ...paletteConns.value.map((c) => ({
    id: `act:compliance:${c.id}`,
    label: `${t('pal.compliance')} · ${c.name || c.dialect}`,
    group: t('pal.groupActions'),
  })),
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
  { id: 'act:lint-rules', label: t('lintrules.title'), group: t('pal.groupActions') },
  { id: 'act:sql-lineage', label: t('sqllineage.title'), group: t('pal.groupActions') },
  { id: 'act:notebook', label: t('notebook.title'), group: t('pal.groupActions') },
  { id: 'act:result-diff', label: t('resultdiff.title'), group: t('pal.groupActions') },
  { id: 'act:rag', label: t('rag.title'), group: t('pal.groupActions') },
  { id: 'act:er-diagram', label: t('er.title'), group: t('pal.groupActions') },
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
  } else if (item.id.startsWith('act:obtopo:')) {
    const cid = item.id.slice('act:obtopo:'.length)
    void openObTopology(cid)
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
  else if (item.id === 'act:ndjson-viewer') void openNdjsonViewer()
  else if (item.id === 'act:o2dm') o2dmRef.value?.open?.()
  else if (item.id === 'act:mig-assess') migAssessRef.value?.open?.()
  else if (item.id.startsWith('act:slowq:')) {
    const cid = item.id.slice('act:slowq:'.length)
    void openSlowQuery(cid)
  } else if (item.id.startsWith('act:capacity:')) {
    void openStorageTrend(item.id.slice('act:capacity:'.length))
  } else if (item.id.startsWith('act:compliance:')) {
    const cid = item.id.slice('act:compliance:'.length)
    void openCompliance(cid)
  } else if (item.id.startsWith('act:vqd:')) {
    const cid = item.id.slice('act:vqd:'.length)
    void openVqd(cid)
  } else if (item.id.startsWith('act:search-value:')) {
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
  else if (item.id === 'act:lint-rules') lintRulesOpen.value = true
  else if (item.id === 'act:sql-lineage') sqlLineageOpen.value = true
  else if (item.id === 'act:notebook') notebookOpen.value = true
  else if (item.id === 'act:result-diff') resultDiffOpen.value = true
  else if (item.id === 'act:rag') ragOpen.value = true
  else if (item.id === 'act:er-diagram') erOpen.value = true
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
    reportError(e, { tag: 'ws.importConnsFail' })
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

// 双击 Shift 全局触发全文搜索:相邻两次 Shift 间隔 < 350ms 算"双击"
let lastShiftAt = 0
const DOUBLE_SHIFT_WINDOW_MS = 350

function onKeydown(e: KeyboardEvent): void {
  // 双击 Shift → 全文搜索(任何 focus 都生效;编辑器里也行)
  // 只在 Shift 键单独按时触发(不带 Ctrl/Meta/Alt + 不带其它字符键)
  if (e.key === 'Shift' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
    const now = performance.now()
    if (now - lastShiftAt < DOUBLE_SHIFT_WINDOW_MS) {
      lastShiftAt = 0
      // 双击命中:打开全文搜索;连接 id 用当前活跃 tab 的连接,没有则空
      const activeConnId =
        (tabsRef.value?.activeConnId as unknown as { value: string } | undefined)?.value ?? ''
      searchValueOpen.value = { connId: activeConnId }
      e.preventDefault()
      e.stopPropagation()
      return
    }
    lastShiftAt = now
  }

  // K1:先查用户自定义快捷键。若 chord 命中一个已知命令,执行后 return。
  // 用户未改的 chord 会等同 DEFAULT_KEY_BINDINGS → 下面硬编码分支仍可命中(双保险)。
  const chord = chordFromEvent(e)
  if (chord) {
    const bindings = getBindings(settings.keyBindings)
    for (const [cmdId, c] of Object.entries(bindings)) {
      if (c !== chord) continue
      if (dispatchCommand(cmdId)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      break
    }
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    // Monaco 编辑器自己绑了 Cmd+K(deleteLines 等),这里 capture 阶段抢先
    // + stopPropagation 阻止它接收到。
    e.preventDefault()
    e.stopPropagation()
    if (paletteOpen.value) paletteOpen.value = false
    else void openPalette()
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
    // ⌘/Ctrl+Shift+V → Excel/CSV 粘贴智能导入
    e.preventDefault()
    e.stopPropagation()
    const activeConnId =
      (tabsRef.value?.activeConnId as unknown as { value: string } | undefined)?.value ?? ''
    pasteImportOpen.value = { preferConnId: activeConnId }
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
// capture 阶段注册,优先级高于 Monaco 编辑器自己注册的 keydown,
// 让 Cmd+K / 双击 Shift 等全局快捷键不会被编辑器吃掉。
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

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
  // 这一程新增功能的菜单入口(都是全局动作,直接复用 act:)
  monitor: 'act:monitor',
  privileges: 'act:privileges',
  'er-diagram': 'act:er-diagram',
  'mig-assess': 'act:mig-assess',
  notebook: 'act:notebook',
  'result-diff': 'act:result-diff',
  'sql-lineage': 'act:sql-lineage',
  'lint-rules': 'act:lint-rules',
  rag: 'act:rag',
  translate: 'act:translate',
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

// 启动时预取环境摘要，让后续 reportError() 能在报告中带上 OS/Electron/app 元数据
onMounted(async () => {
  try {
    const api = (
      window as unknown as { api?: { system?: { getEnvSummary?: () => Promise<EnvSummary> } } }
    ).api
    const env = await api?.system?.getEnvSummary?.()
    if (env) primeEnvCache(env)
  } catch (e) {
    // Boot-race fallback is built into reportError; just log so we know it failed.
    console.error('[Workspace/envCache] prefetch failed:', e)
  }
})
</script>

<template>
  <!-- Dev-mode badge: fixed top-right, only when running under electron-vite dev.
       Tells the user at a glance the running app is NOT a release build, so e.g.
       any data they wreck is in the dev profile / dev sqlite, not the prod one. -->
  <div v-if="isDevBuild" class="dev-badge" title="electron-vite dev / not a packaged build">DEV</div>
  <NavTree
    ref="navRef"
    @new-conn="onNew"
    @new-conn-in-group="onNewConnInGroup"
    @edit-conn="onEditConn"
    @select-conn="onSelectConn"
    @new-query="onNewQuery"
    @delete-conn="onDeleteConn"
    @duplicate-conn="onDuplicateConn"
    @copy-conn-info="onCopyConnInfo"
    @run-sql="onRunSql"
    @conn-error="onConnError"
    @new-object="onNewObject"
    @drop-object="onDropObject"
    @view-structure="onViewStructure"
    @object-deps="onViewDependencies"
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
    @migrate-assess="(cid) => migAssessRef?.open?.({ srcConnId: cid })"
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
    @bulk-truncate="onBulkTruncate"
    @bulk-copy-select="onBulkCopySelect"
    @bulk-export-ddl="onBulkExportDdl"
    @bulk-delete-connections="onBulkDeleteConnections"
    @bulk-move-to-group="onBulkMoveToGroup"
    @bulk-test-connections="onBulkTestConnections"
    @open-redis-key="onOpenRedisKey"
    @focus-redis-key="onFocusRedisKey"
    @delete-redis-key="onDeleteRedisKey"
    @flush-redis-db="onFlushRedisDb"
    @flush-redis-all="onFlushRedisAll"
    @new-redis-key="onNewRedisKey"
    @new-database="onNewDatabase"
    @new-schema="onNewSchema"
    @open-cluster-topology="(cid) => client.connections.get(cid).then(c => { clusterTopoOpen = { conn: c } })"
    @open-pg-advanced="(cid, db) => client.connections.get(cid).then(c => { pgAdvOpen = { conn: c, database: db } })"
    @open-click-house-advanced="(cid, db) => client.connections.get(cid).then(c => { chAdvOpen = { conn: c, database: db } })"
    @open-mpp-partition="(cid, db, tbl) => client.connections.get(cid).then(c => { mppPartOpen = { conn: c, database: db, table: tbl } })"
    @open-mysql-advanced="(cid) => client.connections.get(cid).then(c => { mysqlAdvOpen = { conn: c } })"
    @open-pii-scanner="(cid, db, sch) => client.connections.get(cid).then(c => { piiScanOpen = { conn: c, database: db, schema: sch } })"
    @open-masking-view="(cid, db, sch, tbl) => client.connections.get(cid).then(c => { maskingViewOpen = { conn: c, database: db, schema: sch, table: tbl } })"
    @open-ai-insights="(cid, sql, err, tab) => client.connections.get(cid).then(c => { aiInsightsOpen = { conn: c, prefillSql: sql, prefillError: err, initialTab: tab } })"
    @open-ai-schema-reverse="(cid, db) => client.connections.get(cid).then(c => { aiSchemaRevOpen = { conn: c, database: db } })"
    @open-ai-schema-architect="(cid, db) => client.connections.get(cid).then(c => { aiArchOpen = { conn: c, database: db } })"
    @open-workspace-export="wsExportOpen = true"
    @configure-nav-filter="onConfigureNavFilter"
    @open-process-list="onOpenProcessList"
    @open-settings="settingsOpen = true"
    @toggle-ai-chat="aiChatOpen = !aiChatOpen"
  />

  <!-- #17 nav resizer: 4px draggable column between NavTree and main.
       Visible only on hover (subtle purple band) so it doesn't add visual
       weight at rest. Cursor switches to col-resize over its hit area,
       which is widened to 8px via `::before` overlay so users can actually
       grab the 4px line without pixel hunting. -->
  <div
    class="nav-resizer"
    :class="{ 'nav-resizer-active': navResizing }"
    @mousedown.prevent="onNavResizerDown"
    @dblclick="onNavResizerReset"
    title="拖动调整导航宽度 · 双击重置 300px"
  ></div>

  <main class="main">
    <QueryTabs
      ref="tabsRef"
      @conn-error="onConnError"
      @refresh="onTreeRefresh"
      @ai="onAiFromPane"
      @ask-ai-about-error="onAskAiAboutError"
      @search-value="(p) => { searchValueOpen = { connId: p.connId, value: p.value } }"
      @open-chart="onOpenChart"
      @redis-open-search="(c) => { redisSearchOpen = { conn: c } }"
      @redis-open-import="(c, db) => { redisIeOpen = { conn: c, dbIndex: db, mode: 'import' } }"
      @redis-open-export="(c, db) => { redisIeOpen = { conn: c, dbIndex: db, mode: 'export' } }"
      @redis-open-server-info="(c) => { redisServerInfoOpen = { conn: c } }"
      @redis-open-big-keys="(c, db) => { redisBigKeysOpen = { conn: c, dbIndex: db } }"
      @redis-open-script="(c, db) => { redisScriptOpen = { conn: c, dbIndex: db } }"
      @redis-open-monitor="(c) => { redisMonitorOpen = { conn: c } }"
      @mongo-open-info="(c, d, col) => { mongoCollInfoOpen = { conn: c, database: d, collection: col } }"
      @mongo-open-agg="(c, d, col) => { mongoAggOpen = { conn: c, database: d, collection: col } }"
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
      :prefill-group="editing.prefillGroup"
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

  <!-- Generic batch-run progress modal (#25) — used by TRUNCATE / DDL export.
       Shows the planned actions in order, ticks them off as each succeeds.
       On error, halts with the message + a "继续" button so the user can
       resume after fixing the root cause. -->
  <Modal v-if="bulkRunState" :title="bulkRunState.title" @close="dismissBulkRun">
    <div class="confirm">
      <p>{{ `共 ${bulkRunState.labels.length} 个动作, 顺序执行 — 任一报错即停.` }}</p>
      <ul class="bulk-list">
        <li
          v-for="(label, i) in bulkRunState.labels"
          :key="i"
          :class="{ gone: i < bulkRunState.done, current: i === bulkRunState.done && bulkRunState.busy }"
        >{{ label }}</li>
      </ul>
      <div v-if="bulkRunState.error" class="banner err">
        {{ `第 ${bulkRunState.done + 1} / ${bulkRunState.labels.length} 失败: ${bulkRunState.error}` }}
      </div>
      <div class="actions">
        <button class="primary" :disabled="bulkRunState.busy" @click="confirmBulkRun">
          {{
            bulkRunState.busy
              ? `执行中 ${bulkRunState.done} / ${bulkRunState.labels.length}`
              : bulkRunState.error
                ? '继续'
                : `开始 (${bulkRunState.labels.length})`
          }}
        </button>
        <button class="ghost" :disabled="bulkRunState.busy" @click="dismissBulkRun">{{ t('common.cancel') }}</button>
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

  <!-- OceanBase 集群拓扑（信创差异化能力） -->
  <OceanBaseTopologyDialog
    v-if="obTopoOpen"
    :conn="obTopoOpen.conn"
    @close="obTopoOpen = null"
  />

  <!-- Oracle → DM 迁移向导（信创外包） -->
  <OracleToDmWizard ref="o2dmRef" />

  <!-- 信创迁移评估（源库画像 + 等级 + AI 转换） -->
  <MigrationAssessWizard ref="migAssessRef" />

  <!-- 等保 2.0 合规检查（按连接） -->
  <ComplianceDialog
    v-if="complianceOpen"
    :conn="complianceOpen.conn"
    :open="true"
    @close="complianceOpen = null"
  />

  <!-- 慢查询日志分析（按连接） -->
  <SlowQueryDialog
    v-if="slowOpen"
    :conn="slowOpen.conn"
    :open="true"
    @close="slowOpen = null"
    @open-sql="onSlowOpenSql"
  />

  <!-- 存储容量趋势 + 预测（按连接） -->
  <StorageCapacityDialog
    v-if="storageOpen"
    :conn="storageOpen.conn"
    :open="true"
    @close="storageOpen = null"
  />

  <!-- #6 可视化查询构建器 -->
  <VisualQueryDialog
    v-if="vqdState"
    :conn="vqdState.conn"
    @open-sql="onVqdOpenSql"
    @close="vqdState = null"
  />

  <!-- #8 NDJSON 文件查看器 -->
  <NdjsonViewerDialog
    v-if="ndjsonState"
    :file="ndjsonState"
    @close="ndjsonState = null"
  />

  <!-- 测试数据生成 v2：按语义配置每列 + 配置持久化 -->
  <MockDataDialog
    v-if="mockState"
    :conn="mockState.conn"
    :table-ref="mockState.tableRef"
    :table-name="mockState.tableName"
    :base-columns="mockState.baseColumns"
    @generate="onMockGenerated"
    @execute="onMockExecute"
    @close="mockState = null"
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

  <!-- Redis 新建 key -->
  <RedisNewKeyDialog
    v-if="redisNewKeyOpen"
    :open="!!redisNewKeyOpen"
    :conn="redisNewKeyOpen.conn"
    :db-index="redisNewKeyOpen.dbIndex"
    @close="redisNewKeyOpen = null"
    @created="onRedisKeyCreated"
  />

  <!-- Redis 跨库搜索 -->
  <RedisSearchDialog
    v-if="redisSearchOpen"
    :open="!!redisSearchOpen"
    :conn="redisSearchOpen.conn"
    @close="redisSearchOpen = null"
    @pick="(db, key) => { tabsRef?.openRedisDb(redisSearchOpen!.conn, db, key); redisSearchOpen = null }"
  />

  <!-- Redis 导入/导出 JSON -->
  <RedisImportExportDialog
    v-if="redisIeOpen"
    :open="!!redisIeOpen"
    :conn="redisIeOpen.conn"
    :db-index="redisIeOpen.dbIndex"
    :mode="redisIeOpen.mode"
    @close="redisIeOpen = null"
  />

  <!-- Redis 服务器信息面板 -->
  <RedisServerInfoDialog
    v-if="redisServerInfoOpen"
    :open="!!redisServerInfoOpen"
    :conn="redisServerInfoOpen.conn"
    @close="redisServerInfoOpen = null"
  />

  <!-- Redis 大 key 排行 -->
  <RedisBigKeysDialog
    v-if="redisBigKeysOpen"
    :open="!!redisBigKeysOpen"
    :conn="redisBigKeysOpen.conn"
    :db-index="redisBigKeysOpen.dbIndex"
    @close="redisBigKeysOpen = null"
  />

  <!-- Redis Lua / Functions -->
  <RedisScriptDialog
    v-if="redisScriptOpen"
    :open="!!redisScriptOpen"
    :conn="redisScriptOpen.conn"
    :db-index="redisScriptOpen.dbIndex"
    @close="redisScriptOpen = null"
  />

  <!-- Redis 实时监控 -->
  <RedisMonitorDialog
    v-if="redisMonitorOpen"
    :open="!!redisMonitorOpen"
    :conn="redisMonitorOpen.conn"
    @close="redisMonitorOpen = null"
  />

  <!-- Mongo 集合统计 / 索引 -->
  <MongoCollectionInfoDialog
    v-if="mongoCollInfoOpen"
    :open="!!mongoCollInfoOpen"
    :conn="mongoCollInfoOpen.conn"
    :database="mongoCollInfoOpen.database"
    :collection="mongoCollInfoOpen.collection"
    @close="mongoCollInfoOpen = null"
  />

  <!-- Mongo aggregation -->
  <MongoAggregationDialog
    v-if="mongoAggOpen"
    :open="!!mongoAggOpen"
    :conn="mongoAggOpen.conn"
    :database="mongoAggOpen.database"
    :collection="mongoAggOpen.collection"
    @close="mongoAggOpen = null"
  />

  <!-- OB/TiDB 集群拓扑 -->
  <ClusterTopologyDialog
    v-if="clusterTopoOpen"
    :open="!!clusterTopoOpen"
    :conn="clusterTopoOpen.conn"
    @close="clusterTopoOpen = null"
  />

  <!-- PG 高级面板 -->
  <PgAdvancedDialog
    v-if="pgAdvOpen"
    :open="!!pgAdvOpen"
    :conn="pgAdvOpen.conn"
    :database="pgAdvOpen.database"
    @close="pgAdvOpen = null"
  />

  <!-- ClickHouse 高级面板 -->
  <ClickHouseAdvancedDialog
    v-if="chAdvOpen"
    :open="!!chAdvOpen"
    :conn="chAdvOpen.conn"
    :database="chAdvOpen.database"
    @close="chAdvOpen = null"
  />

  <!-- Doris/StarRocks 分区管理 -->
  <MppPartitionDialog
    v-if="mppPartOpen"
    :open="!!mppPartOpen"
    :conn="mppPartOpen.conn"
    :database="mppPartOpen.database"
    :table="mppPartOpen.table"
    @close="mppPartOpen = null"
  />

  <!-- MySQL 高级面板 -->
  <MysqlAdvancedDialog
    v-if="mysqlAdvOpen"
    :open="!!mysqlAdvOpen"
    :conn="mysqlAdvOpen.conn"
    @close="mysqlAdvOpen = null"
  />

  <!-- PII 扫描 -->
  <PiiScannerDialog
    v-if="piiScanOpen"
    :open="!!piiScanOpen"
    :conn="piiScanOpen.conn"
    :database="piiScanOpen.database"
    :schema="piiScanOpen.schema"
    @close="piiScanOpen = null"
  />

  <!-- 数据脱敏视图 -->
  <DataMaskingViewDialog
    v-if="maskingViewOpen"
    :open="!!maskingViewOpen"
    :conn="maskingViewOpen.conn"
    :database="maskingViewOpen.database"
    :schema="maskingViewOpen.schema"
    :table="maskingViewOpen.table"
    @close="maskingViewOpen = null"
  />

  <!-- AI Insights -->
  <AiInsightsDialog
    v-if="aiInsightsOpen"
    :open="!!aiInsightsOpen"
    :conn="aiInsightsOpen.conn"
    :prefill-sql="aiInsightsOpen.prefillSql"
    :prefill-error="aiInsightsOpen.prefillError"
    :initial-tab="aiInsightsOpen.initialTab"
    @close="aiInsightsOpen = null"
  />

  <!-- AI schema 反向 -->
  <AiSchemaReverseDialog
    v-if="aiSchemaRevOpen"
    :open="!!aiSchemaRevOpen"
    :conn="aiSchemaRevOpen.conn"
    :database="aiSchemaRevOpen.database"
    @close="aiSchemaRevOpen = null"
  />

  <!-- Excel/CSV 粘贴智能导入(⌘+Shift+V 触发) -->
  <PasteImportDialog
    v-if="pasteImportOpen"
    :open="!!pasteImportOpen"
    :prefer-conn-id="pasteImportOpen.preferConnId"
    :prefill-rows="pasteImportOpen.prefillRows"
    @close="pasteImportOpen = null"
  />

  <!-- AI 建表助手 -->
  <AiSchemaArchitectDialog
    v-if="aiArchOpen"
    :open="!!aiArchOpen"
    :conn="aiArchOpen.conn"
    :database="aiArchOpen.database"
    @close="aiArchOpen = null"
  />

  <!-- Workspace 导出/导入 -->
  <WorkspaceExportDialog
    v-if="wsExportOpen"
    :open="wsExportOpen"
    @close="wsExportOpen = false"
    @imported="navRef?.reload()"
  />

  <!-- #24 配置可见库/Schema 过滤 -->
  <NavFilterDialog
    v-if="navFilterOpen"
    :conn="navFilterOpen"
    @close="navFilterOpen = null"
    @saved="navRef?.reload()"
  />

  <!-- #D 进程/会话列表 + Kill -->
  <ProcessListDialog
    v-if="processListOpen"
    :conn="processListOpen"
    @close="processListOpen = null"
  />

  <!-- #B 结果集图表 viewer (ECharts) -->
  <ChartViewerDialog v-if="chartOpen" :result="chartOpen" @close="chartOpen = null" />

  <!-- 新建数据库 -->
  <NewDatabaseDialog
    v-if="newDbOpen"
    :open="!!newDbOpen"
    :conn="newDbOpen.conn"
    @close="newDbOpen = null"
    @created="onDatabaseCreated"
  />

  <!-- 新建 Schema -->
  <NewSchemaDialog
    v-if="newSchemaOpen"
    :open="!!newSchemaOpen"
    :conn="newSchemaOpen.conn"
    :database="newSchemaOpen.database"
    @close="newSchemaOpen = null"
    @created="onSchemaCreated"
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
  <LintRulesDialog v-if="lintRulesOpen" :open="true" @close="lintRulesOpen = false" />
  <SqlLineageDialog v-if="sqlLineageOpen" :open="true" @close="sqlLineageOpen = false" />
  <NotebookDialog v-if="notebookOpen" :open="true" @close="notebookOpen = false" />
  <ResultDiffDialog v-if="resultDiffOpen" :open="true" @close="resultDiffOpen = false" />
  <RagDialog v-if="ragOpen" :open="true" @close="ragOpen = false" />
  <ErDiagramDialog v-if="erOpen" :open="true" @close="erOpen = false" />

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
          <a href="#" class="issue-link" @click.prevent="openIssuesWithEnv">{{ t('about.fileIssue') }}</a>
        </div>
        <div class="about-row">
          <span>{{ t('about.update') }}</span>
          <span class="upd-cell">
            <button
              class="ghost"
              :disabled="updateStatus.kind === 'checking' || updateStatus.kind === 'downloading'"
              @click="onUpdateBtnClick"
            >
              {{ updateBtnLabel }}
            </button>

            <!-- 进度条:仅 downloading 时显示 -->
            <span v-if="updateStatus.kind === 'downloading'" class="upd-progress">
              <span class="upd-bar"><span class="upd-bar-fill" :style="{ width: `${updateStatus.percent}%` }" /></span>
              <span class="upd-bps">{{ (updateStatus.bytesPerSecond / 1024 / 1024).toFixed(1) }} MB/s</span>
            </span>

            <span v-else-if="updateStatus.kind === 'not-available'" class="upd-ok">
              {{ t('about.upToDate') }}
            </span>
            <span v-else-if="updateStatus.kind === 'available'" class="upd-new-block">
              <span class="upd-new">✨ 发现新版本 v{{ updateStatus.info.version }}</span>
              <span v-if="updateStatus.info.releaseDate" class="upd-date">
                发布于 {{ formatReleaseDate(updateStatus.info.releaseDate) }}
              </span>
              <details v-if="updateStatus.info.releaseNotes?.trim()" class="upd-notes">
                <summary>查看更新说明</summary>
                <pre class="upd-notes-body">{{ updateStatus.info.releaseNotes }}</pre>
              </details>
              <a
                v-else
                class="upd-notes-link"
                :href="`https://github.com/duhbbx/SkylerX/releases/tag/v${updateStatus.info.version}`"
                target="_blank"
                rel="noopener"
              >
                在 GitHub 查看完整 Release Notes →
              </a>
            </span>
            <span v-else-if="updateStatus.kind === 'downloaded'" class="upd-new">
              v{{ updateStatus.info.version }} 已下载,点按钮重启完成安装
            </span>
            <span v-else-if="updateStatus.kind === 'error'" class="upd-err">
              {{ updateStatus.message }}
            </span>

            <!-- dev 模式 fallback:autoUpdater 不可用,只能看版本号 + 跳 GitHub -->
            <template v-if="updateDevMode">
              <span v-if="updateDevError" class="upd-err">{{ updateDevError }}</span>
              <template v-else-if="updateDevLatest">
                <span v-if="updateDevLatest === APP_VERSION" class="upd-ok">{{ t('about.upToDate') }}</span>
                <a
                  v-else
                  :href="`https://github.com/duhbbx/SkylerX/releases/tag/v${updateDevLatest}`"
                  target="_blank"
                  rel="noopener"
                >dev 模式:在 GitHub 下载 v{{ updateDevLatest }}</a>
              </template>
            </template>
          </span>
        </div>
        <!-- 检查更新调试日志面板:显示 setFeedURL 走 OSS 还是 GitHub / 拉哪个 yml / 服务器返回什么版本 / 错误细节 -->
        <div v-if="updateLogs.length" class="about-row upd-log-row">
          <span>调试日志</span>
          <span class="upd-log-cell">
            <!-- 工具栏: 收起 + 复制 同一行右对齐, pre 单独下一行占满 -->
            <div class="upd-log-toolbar">
              <button class="upd-log-toggle" @click="showUpdateLogs = !showUpdateLogs">
                {{ showUpdateLogs ? '收起' : `展开 (${updateLogs.length} 条)` }}
              </button>
              <button v-if="showUpdateLogs" class="upd-log-toggle" @click="copyUpdateLogs">📋 复制</button>
            </div>
            <!-- pre 内部不能换行/缩进, 否则首行会渲染出 leading 空格/换行 -->
            <pre v-if="showUpdateLogs" class="upd-log-body"><template v-for="l in updateLogs" :key="l.ts + ':' + l.msg">{{ fmtLogTime(l.ts) }} [{{ l.level }}] {{ l.msg }}
</template></pre>
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
/*
 * 删除/二次确认 modal 的按钮布局: 危险按钮(删除)推到左,取消推到右
 * 防回车误删 — 用户的 Enter 默认会聚焦在第一个按钮,把它放在左、远离右下角"取消"
 * 是用户报告的"删除放左边、取消放右边"统一规范。
 */
.confirm .actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.confirm .actions .danger {
  margin-right: auto; /* 推到最左 */
}
.confirm .actions button {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
}
.confirm .actions .danger {
  background: var(--err, #e04050);
  color: #fff;
  border-color: var(--err, #e04050);
}
.confirm .actions .danger:hover {
  filter: brightness(1.1);
}
.confirm .actions .danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.confirm .actions .ghost {
  background: transparent;
  color: var(--text);
}
.confirm .actions .ghost:hover {
  background: rgba(124, 108, 255, 0.1);
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
  font-family: var(--font-mono);
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
  font-family: var(--font-mono);
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
/* Dev-mode badge — top-right corner, only visible under `electron-vite dev`. */
.dev-badge {
  position: fixed;
  top: 6px;
  right: 8px;
  z-index: 9999;
  padding: 2px 7px;
  background: rgba(255, 152, 0, 0.92); /* orange = warning, distinct from any UI accent */
  color: #1a1a1a;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  letter-spacing: 1.5px;
  border-radius: 3px;
  pointer-events: none;
  user-select: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

/* #17 NavTree resizer — sits between .tree and .main as a 4px column.
   At rest it's transparent; hover and active drag tint it accent-purple.
   The ::before extends the hit area to 8px (4px each side) so the line
   is grabbable without millimeter precision; the visible line stays 4px. */
.nav-resizer {
  flex: none;
  width: 4px;
  position: relative;
  cursor: col-resize;
  background: transparent;
  transition: background 0.12s ease-in-out;
  z-index: 5;
}
.nav-resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -2px;
  right: -2px;
}
.nav-resizer:hover,
.nav-resizer-active {
  background: var(--accent, #7c6cff);
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
  align-items: flex-start; /* 多行错误时上对齐,不让 "更新" label 被拉到中间 */
  gap: 12px;
  padding: 4px 2px;
  border-bottom: 1px solid var(--border);
}
.about-row > span:first-child {
  flex: none; /* 左侧 label 不收缩 */
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
  /* 错误文本可能很长(Windows 没签的多行 stacktrace),让 cell 允许换行 */
  flex-wrap: wrap;
  justify-content: flex-end;
  /* 不限 max-width, 跟 about-row 右列宽度走, 让长文本(release notes
     摘要 / 错误堆栈)有更多横向空间;
     about-row 的 grid 已经把右列宽度兜住, 不会撑破 Modal. */
  flex: 1 1 auto;
  min-width: 0;
}
.upd-cell button {
  padding: 3px 10px;
  font-size: 12px;
  flex: none;
}
.upd-ok {
  color: #4caf50;
  font-size: 12px;
  flex: none;
}
.upd-err {
  color: var(--err, #e04050);
  font-size: 11px;
  /* 长 stacktrace 允许换行 + 单词内断行(英文长串路径不会撑出框) */
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1 1 100%;
  max-height: 96px;
  overflow-y: auto;
  background: rgba(224, 64, 80, 0.06);
  padding: 4px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
}
.upd-new {
  color: var(--accent);
  font-size: 12px;
  flex: none;
}
/* available 时整块详细信息布局 */
.upd-new-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 100%;
  font-size: 12px;
  min-width: 0;
}
.upd-new-block .upd-new {
  font-weight: 600;
}
.upd-date {
  color: var(--muted);
  font-size: 11px;
}
.upd-notes {
  margin-top: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  max-width: 100%;
}
.upd-notes > summary {
  cursor: pointer;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--accent);
  user-select: none;
}
.upd-notes > summary:hover {
  background: rgba(124, 108, 255, 0.08);
}
.upd-notes-body {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  color: var(--text);
  line-height: 1.5;
}
.upd-notes-link {
  font-size: 11px;
  color: var(--accent);
}
.upd-log-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
  /* 让子元素自己控对齐 — toolbar 内部 justify-content: flex-end, pre 占满 */
  width: 100%;
  min-width: 0;
}
.upd-log-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  width: 100%;
}
.upd-log-toggle {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.upd-log-toggle:hover {
  color: var(--text);
  border-color: var(--accent);
}
.upd-log-body {
  width: 100%;
  margin: 4px 0 0;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 10px;
  font-family: var(--font-mono);
  max-height: 220px;
  overflow-y: auto;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
}
.upd-progress {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.upd-bar {
  position: relative;
  display: inline-block;
  width: 120px;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.upd-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: var(--accent);
  transition: width 0.15s ease-out;
}
.upd-bps {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
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
  font-family: var(--font-mono);
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

