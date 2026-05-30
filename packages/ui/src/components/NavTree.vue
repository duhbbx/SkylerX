<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  type ConnectionEnv,
  type DbDialect,
  MetaNodeKind,
} from '@db-tool/shared-types'
import { computed, nextTick, onMounted, provide, reactive, ref } from 'vue'
import { connEnv } from '../connEnv'
import { isConnectionError } from '../connError'
import { useDataClient } from '../data-client'
import type { ObjectKind, SqlTemplateKind } from '../ddl'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { t } from '../i18n'
import { settings } from '../settings'
import ContextMenu from './ContextMenu.vue'
import TreeItem from './TreeItem.vue'
import { type MenuEntry, type TreeAction, menuEntriesFor } from './tree-actions'
import { type TreeController, TreeControllerKey } from './tree-controller'
import { type TreeNode, fromMetadata, rootNode } from './treeNode'

const client = useDataClient()

// 上抛给 App 的高层事件（动作原语桥接到这里）
const emit = defineEmits<{
  selectConn: [string]
  newQuery: [string, TreeNode]
  editConn: [string]
  newConn: []
  deleteConn: [string]
  duplicateConn: [string]
  runSql: [string, string]
  connError: [string, string]
  newObject: [ObjectKind, string, TreeNode]
  dropObject: [string, TreeNode]
  viewStructure: [string, TreeNode]
  designTable: [string, TreeNode]
  tableStats: [string, TreeNode]
  mockData: [string, TreeNode]
  deps: [string, TreeNode]
  copyDdl: [string, TreeNode]
  toggleFavorite: [string, TreeNode]
  copyObjectDdl: [string, TreeNode]
  emptyTable: [string, TreeNode]
  truncateTable: [string, TreeNode]
  inspectTable: [string, TreeNode]
  fixupTable: [string, TreeNode]
  aiCommentTable: [string, TreeNode]
  aiHealthCheck: [string]
  indexRecommender: [string]
  renameTable: [string, TreeNode]
  copyTable: [string, TreeNode, boolean]
  toggleProdMark: [string]
  createTemplateDraft: ['sequence' | 'event', string, TreeNode]
  dataDict: [string, TreeNode]
  dataDictHtml: [string, TreeNode]
  editObject: [string, TreeNode]
  viewDefinition: [string, TreeNode]
  generateSql: [SqlTemplateKind, string, TreeNode]
  importData: [string, TreeNode]
  exportSql: [string, TreeNode]
  exportSchemaSql: [string, TreeNode]
  transferData: [string, TreeNode]
  previewTable: [string, TreeNode]
  openErd: [string, TreeNode]
  openSettings: []
  toggleAiChat: []
  bulkDrop: [{ connId: string; node: TreeNode }[]]
  /** Redis 专属:双击 key 节点 → 打开对应 db 的 RedisPane 并定位 key */
  openRedisKey: [connId: string, dbIndex: number, key: string]
  /** Redis 专属:右键删除 key */
  deleteRedisKey: [connId: string, dbIndex: number, key: string, parent: TreeNode]
  /** Redis 专属:清空指定逻辑库 dbN */
  flushRedisDb: [connId: string, dbIndex: number, dbNode: TreeNode]
  /** Redis 专属:清空整个 Redis 实例(所有 16 个库) */
  flushRedisAll: [connId: string, connNode: TreeNode]
  /** Redis 专属:在 db 下新建 key */
  newRedisKey: [connId: string, dbIndex: number, parent: TreeNode]
  /** 新建数据库 */
  newDatabase: [connId: string, parent: TreeNode]
  /** 新建 Schema */
  newSchema: [connId: string, parent: TreeNode]
  /** OB/TiDB:打开集群拓扑 */
  openClusterTopology: [connId: string]
  /** PG 系:打开扩展/复制/复制槽面板 */
  openPgAdvanced: [connId: string, database?: string]
  /** ClickHouse 高级 */
  openClickHouseAdvanced: [connId: string, database?: string]
  /** Doris/StarRocks 分区 */
  openMppPartition: [connId: string, database?: string, table?: string]
  /** MySQL 高级(binlog/主从/变量) */
  openMysqlAdvanced: [connId: string]
  /** PII 扫描 */
  openPiiScanner: [connId: string, database?: string, schema?: string]
  /** 脱敏视图 */
  openMaskingView: [connId: string, database?: string, schema?: string, table?: string]
  /** AI Insights */
  openAiInsights: [
    connId: string,
    prefillSql?: string,
    prefillError?: string,
    tab?: 'slow' | 'error',
  ]
  /** AI 反向 schema */
  openAiSchemaReverse: [connId: string, database?: string]
  /** AI 建表助手 */
  openAiSchemaArchitect: [connId: string, database?: string]
  /** 在指定分组下新建连接(空白菜单 → 新建连接 → 预填 group) */
  newConnInGroup: [groupName: string]
  /** 打开 Workspace 导出/导入对话框 */
  openWorkspaceExport: []
}>()

// 批量可选的对象类型（与可删除类型一致）
const MULTI_KINDS: MetaNodeKind[] = [
  MetaNodeKind.Table,
  MetaNodeKind.View,
  MetaNodeKind.Function,
  MetaNodeKind.Procedure,
  MetaNodeKind.Sequence,
  MetaNodeKind.Trigger,
  MetaNodeKind.Event,
]
// 批量选择集：key → {node, connId}（保留 connId 以支持跨连接批量）
const multiSel = reactive(new Map<string, { node: TreeNode; connId: string }>())

interface ConnRoot {
  id: string
  node: TreeNode
  group?: string
  env?: ConnectionEnv
  /** 方言（用于 TreeItem 显示数据库品牌 logo） */
  dialect: string
  /** 拖拽排序用 */
  sortIndex?: number
  createdAt?: number
}

const roots = ref<ConnRoot[]>([])
const expandedGroups = ref<Set<string>>(new Set())

/**
 * 按 group 聚合,并按 settings.groupOrder 排序:
 *  - groupOrder 数组里的顺序优先(用户拖动的顺序);未列出的从连接 group 字段冒出来的追加在后
 *  - 空分组(只在 groupOrder 里出现但没有任何连接)也显示 —— 支持"先建组再分进去"流程
 *  - 同分组内连接按 sortIndex 升序(缺省走 createdAt)
 */
const groupList = computed(() => {
  const m = new Map<string, ConnRoot[]>()
  for (const r of roots.value) {
    if (!r.group) continue
    const arr = m.get(r.group)
    if (arr) arr.push(r)
    else m.set(r.group, [r])
  }
  // 把 settings.groupOrder 里"还没冒出来"的空组也加进去 (空数组)
  for (const g of settings.groupOrder) {
    if (!m.has(g)) m.set(g, [])
  }
  // 排序:先 groupOrder 列表序,然后未列出的按字典序
  const order = new Map(settings.groupOrder.map((n, i) => [n, i]))
  const ordered = [...m.entries()].sort(([a], [b]) => {
    const ia = order.get(a)
    const ib = order.get(b)
    if (ia != null && ib != null) return ia - ib
    if (ia != null) return -1
    if (ib != null) return 1
    return a.localeCompare(b)
  })
  return ordered.map(([name, conns]) => ({ name, conns: sortRoots(conns) }))
})
const ungrouped = computed(() => sortRoots(roots.value.filter((r) => !r.group)))

function sortRoots(arr: ConnRoot[]): ConnRoot[] {
  return [...arr].sort((a, b) => {
    const ai = a.sortIndex ?? Number.POSITIVE_INFINITY
    const bi = b.sortIndex ?? Number.POSITIVE_INFINITY
    if (ai !== bi) return ai - bi
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })
}

function toggleGroup(name: string): void {
  const s = new Set(expandedGroups.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  expandedGroups.value = s
}

const menu = reactive<{
  visible: boolean
  x: number
  y: number
  entries: MenuEntry[]
  node: TreeNode | null
  connId: string
}>({ visible: false, x: 0, y: 0, entries: [], node: null, connId: '' })

const selectedKey = ref<string | null>(null)
function nodeKey(node: TreeNode, connId: string): string {
  return `${connId}::${node.kind}::${node.path.join('/')}::${node.group ?? ''}`
}

// 唯一的控制器实例：provide 给整棵树；动作原语桥接到 App
const controller: TreeController = {
  async loadChildren(node, connId) {
    node.loading = true
    node.error = null
    try {
      const children = await client.connections.metadata(connId, {
        parentKind: node.kind,
        path: [...node.path],
        group: node.group,
      })
      node.children = children.map((n) => {
        const child = fromMetadata(n)
        child.parent = node
        return child
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 不在树里显示错误：收起该节点，错误只通过弹窗呈现
      node.children = null
      node.expanded = false
      // 连接节点打不开，或任意层级的连接级错误 → 弹出该连接编辑框
      if (node.kind === MetaNodeKind.Connection || isConnectionError(msg)) {
        emit('connError', connId, msg)
      }
    } finally {
      node.loading = false
    }
  },
  select(node, connId) {
    selectedKey.value = nodeKey(node, connId)
  },
  isSelected(node, connId) {
    return selectedKey.value === nodeKey(node, connId)
  },
  toggleMulti(node, connId) {
    if (!MULTI_KINDS.includes(node.kind)) return
    const k = nodeKey(node, connId)
    if (multiSel.has(k)) multiSel.delete(k)
    else multiSel.set(k, { node, connId })
  },
  isMultiSelected(node, connId) {
    return multiSel.has(nodeKey(node, connId))
  },
  clearMulti() {
    multiSel.clear()
  },
  openNode(node, connId) {
    // 双击连接 = 打开连接；双击表/视图等其它节点仅展开/折叠（由 TreeItem toggle 处理），
    // 不查询、不改编辑器。查表数据请用右键「查询前 200 行」。
    if (node.kind === MetaNodeKind.Connection) {
      emit('selectConn', connId)
      return
    }
    // Redis 专属:双击 key 节点 → 打开 RedisPane 并定位
    // path = [dbIndex, type, key],group='redis-key' 由 redis 驱动写入
    if (node.kind === MetaNodeKind.Column && node.group === 'redis-key' && node.path.length >= 3) {
      const dbIndex = Number(node.path[0]) || 0
      emit('openRedisKey', connId, dbIndex, node.name)
    }
  },
  openContextMenu(x, y, node, connId) {
    menu.x = x
    menu.y = y
    menu.node = node
    menu.connId = connId
    // 查 ConnRoot 取方言,菜单按方言过滤(隐藏 NoSQL 不适用的 ER 图 / 导出 SQL / 数据字典等)
    const root = roots.value.find((r) => r.id === connId)
    menu.entries = menuEntriesFor(node, root?.dialect as DbDialect | undefined)
    menu.visible = true
  },
  openConnection: (connId) => emit('selectConn', connId),
  newQuery: (node, connId) => emit('newQuery', connId, node),
  createObject: (kind, node, connId) => emit('newObject', kind, connId, node),
  dropObject: (node, connId) => emit('dropObject', connId, node),
  viewStructure: (node, connId) => emit('viewStructure', connId, node),
  previewTable: (node, connId) => emit('previewTable', connId, node),
  designTable: (node, connId) => emit('designTable', connId, node),
  tableStats: (node, connId) => emit('tableStats', connId, node),
  generateMockData: (node, connId) => emit('mockData', connId, node),
  viewDependencies: (node, connId) => emit('deps', connId, node),
  copyDdl: (node, connId) => emit('copyDdl', connId, node),
  toggleFavorite: (node, connId) => emit('toggleFavorite', connId, node),
  copyObjectDdl: (node, connId) => emit('copyObjectDdl', connId, node),
  emptyTable: (node, connId) => emit('emptyTable', connId, node),
  truncateTable: (node, connId) => emit('truncateTable', connId, node),
  renameTable: (node, connId) => emit('renameTable', connId, node),
  copyTable: (node, connId, withData) => emit('copyTable', connId, node, withData),
  toggleProdMark: (connId) => emit('toggleProdMark', connId),
  createTemplateDraft: (kind, node, connId) => emit('createTemplateDraft', kind, connId, node),
  dataDict: (node, connId) => emit('dataDict', connId, node),
  dataDictHtml: (node, connId) => emit('dataDictHtml', connId, node),
  editObject: (node, connId) => emit('editObject', connId, node),
  viewDefinition: (node, connId) => emit('viewDefinition', connId, node),
  generateSql: (kind, node, connId) => emit('generateSql', kind, connId, node),
  openErd: (node, connId) => emit('openErd', connId, node),
  importData: (node, connId) => emit('importData', connId, node),
  exportSql: (node, connId) => emit('exportSql', connId, node),
  exportSchemaSql: (node, connId) => emit('exportSchemaSql', connId, node),
  transferData: (node, connId) => emit('transferData', connId, node),
  editConnection: (connId) => emit('editConn', connId),
  newConnection: () => emit('newConn'),
  deleteConnection: (connId) => emit('deleteConn', connId),
  duplicateConnection: (connId) => emit('duplicateConn', connId),
  runSql: (connId, sql) => emit('runSql', connId, sql),
  async refreshNode(node, connId) {
    node.children = null
    if (node.expanded) await this.loadChildren(node, connId)
    // count（"表 (15)" 这种数字）是父库元数据拉取时存好的；增删后用实际 children.length 同步
    // 注：TS 看不到 loadChildren 的副作用，children 类型仍被收窄为 null，所以这里走 unknown 中转
    const reloaded = node.children as unknown as TreeNode[] | null
    if (node.kind === MetaNodeKind.Group && reloaded) {
      node.count = reloaded.length
    }
  },
  copyText: (text) => void navigator.clipboard?.writeText(text),
  inspectTable: (node, connId) => emit('inspectTable', connId, node),
  fixupTable: (node, connId) => emit('fixupTable', connId, node),
  aiCommentTable: (node, connId) => emit('aiCommentTable', connId, node),
  aiHealthCheck: (connId) => emit('aiHealthCheck', connId),
  indexRecommender: (connId) => emit('indexRecommender', connId),
  openRedisKey: (connId, dbIndex, key) => emit('openRedisKey', connId, dbIndex, key),
  deleteRedisKey: (connId, dbIndex, key, parent) =>
    emit('deleteRedisKey', connId, dbIndex, key, parent),
  flushRedisDb: (connId, dbIndex, dbNode) => emit('flushRedisDb', connId, dbIndex, dbNode),
  flushRedisAll: (connId, connNode) => emit('flushRedisAll', connId, connNode),
  newRedisKey: (connId, dbIndex, parent) => emit('newRedisKey', connId, dbIndex, parent),
  newDatabase: (connId, parent) => emit('newDatabase', connId, parent),
  newSchema: (connId, parent) => emit('newSchema', connId, parent),
  openClusterTopology: (connId) => emit('openClusterTopology', connId),
  openPgAdvanced: (connId, database) => emit('openPgAdvanced', connId, database),
  openClickHouseAdvanced: (connId, database) => emit('openClickHouseAdvanced', connId, database),
  openMppPartition: (connId, database, table) => emit('openMppPartition', connId, database, table),
  openMysqlAdvanced: (connId) => emit('openMysqlAdvanced', connId),
  openPiiScanner: (connId, database, schema) => emit('openPiiScanner', connId, database, schema),
  openMaskingView: (connId, database, schema, table) =>
    emit('openMaskingView', connId, database, schema, table),
  openAiInsights: (connId, prefillSql, prefillError, tab) =>
    emit('openAiInsights', connId, prefillSql, prefillError, tab),
  openAiSchemaReverse: (connId, database) => emit('openAiSchemaReverse', connId, database),
  openAiSchemaArchitect: (connId, database) => emit('openAiSchemaArchitect', connId, database),
}

provide(TreeControllerKey, controller)

/** 空白区右键:新建连接 / 新建分组 / 刷新。 */
function onTreeBodyContextmenu(e: MouseEvent): void {
  // 在 tree-node / group-row 上的右键由它们自己拦截,这里只处理空白区
  const target = e.target as HTMLElement | null
  if (target?.closest('.tree-node') || target?.closest('.group-row')) return
  e.preventDefault()
  menu.x = e.clientX
  menu.y = e.clientY
  menu.node = null
  menu.connId = ''
  menu.entries = [
    {
      id: 'new-conn-blank',
      label: 'ctx.new-conn',
      kinds: [],
      run: () => emit('newConn'),
    } as TreeAction,
    {
      id: 'new-group-blank',
      label: 'ctx.new-group',
      kinds: [],
      run: () => void onNewGroup(),
    } as TreeAction,
    { divider: true, id: 'd-blank-1' },
    {
      id: 'refresh-tree-blank',
      label: 'ctx.refresh',
      kinds: [],
      run: () => void reload(),
    } as TreeAction,
  ]
  menu.visible = true
}

/** 分组行右键:重命名 / 在此组新建连接 / 删除分组。 */
function onGroupContextmenu(e: MouseEvent, groupName: string): void {
  e.preventDefault()
  e.stopPropagation()
  menu.x = e.clientX
  menu.y = e.clientY
  menu.node = null
  menu.connId = ''
  menu.entries = [
    {
      id: 'rename-group',
      label: 'ctx.rename-group',
      kinds: [],
      run: () => void onRenameGroup(groupName),
    } as TreeAction,
    {
      id: 'new-conn-in-group',
      label: 'ctx.new-conn-in-group',
      kinds: [],
      run: () => emit('newConnInGroup', groupName),
    } as TreeAction,
    { divider: true, id: 'd-group-1' },
    {
      id: 'delete-group',
      label: 'ctx.delete-group',
      kinds: [],
      section: 'danger',
      danger: true,
      run: () => void onDeleteGroup(groupName),
    } as TreeAction,
  ]
  menu.visible = true
}

async function onNewGroup(): Promise<void> {
  const name = await appPrompt({ message: t('ctx.new-group'), defaultValue: '新分组' })
  const trimmed = name?.trim()
  if (!trimmed) return
  // 持久化空分组到 settings.groupOrder,即使下面还没连接也立刻出现在树里
  // (旧实现 = 立刻弹"新建连接"对话框,用户报告体验割裂)。
  if (settings.groupOrder.includes(trimmed)) {
    toast.warn(`分组 "${trimmed}" 已存在`)
    return
  }
  settings.groupOrder = [...settings.groupOrder, trimmed]
  expandedGroups.value = new Set([...expandedGroups.value, trimmed])
  toast.success(`已新建分组: ${trimmed}`)
}

async function onRenameGroup(oldName: string): Promise<void> {
  const newName = await appPrompt({ message: t('ctx.rename-group'), defaultValue: oldName })
  if (!newName?.trim() || newName.trim() === oldName) return
  const next = newName.trim()
  try {
    const conns: ConnectionConfig[] = await client.connections.list()
    for (const c of conns) {
      if (c.group === oldName) {
        const full = await client.connections.get(c.id)
        full.group = next
        await client.connections.update(full)
      }
    }
    // 同步 groupOrder: 替换名字,保留位置
    if (settings.groupOrder.includes(oldName)) {
      settings.groupOrder = settings.groupOrder.map((g) => (g === oldName ? next : g))
    }
    await reload()
    toast.success(`${oldName} → ${next}`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function onDeleteGroup(name: string): Promise<void> {
  if (
    !(await appConfirm({
      message: `从所有连接中移除分组 "${name}" ?连接保留,只清掉 group 标签`,
      variant: 'danger',
    }))
  )
    return
  try {
    const conns: ConnectionConfig[] = await client.connections.list()
    for (const c of conns) {
      if (c.group === name) {
        const full = await client.connections.get(c.id)
        full.group = undefined
        await client.connections.update(full)
      }
    }
    // 从持久化 groupOrder 移除(空组也走这里)
    settings.groupOrder = settings.groupOrder.filter((g) => g !== name)
    await reload()
    toast.success(`已删除分组 "${name}"`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

function onMenuPick(action: TreeAction): void {
  if (menu.node) {
    action.run({ node: menu.node, connId: menu.connId, ctrl: controller })
  } else {
    // 空白区 / 分组行的 action.run 不依赖 ctx,签名是 () => void
    ;(action.run as unknown as () => void)()
  }
  menu.visible = false
}

async function reload(): Promise<void> {
  const conns: ConnectionConfig[] = await client.connections.list()
  const prev = new Map(roots.value.map((r) => [r.id, r.node]))
  roots.value = conns.map((c) => {
    // 已有 root 复用 TreeNode 实例保留展开状态/子节点缓存,但要同步刷新 name —
    // 用户报告:编辑连接改了名字后导航树仍是旧名,根因就是这里直接 reuse 不同步 name。
    const reused = prev.get(c.id)
    const node = reused ?? rootNode(c.name || t('common.untitled'))
    if (reused) reused.name = c.name || t('common.untitled')
    return {
      id: c.id,
      node,
      group: c.group,
      env: connEnv(c),
      dialect: c.dialect,
      sortIndex: c.sortIndex,
      createdAt: c.createdAt,
    }
  })
  // 新出现的分组默认展开（保留用户已折叠的）
  const s = new Set(expandedGroups.value)
  const known = new Set(roots.value.map((r) => r.group).filter(Boolean) as string[])
  for (const g of known) if (!seenGroups.has(g)) s.add(g)
  seenGroups = known
  expandedGroups.value = s
}
let seenGroups = new Set<string>()

/** 刷新某节点（如新建表后刷新所属"表"目录）。 */
function refreshNode(node: TreeNode, connId: string): void {
  void controller.refreshNode(node, connId)
}

// ── 全局对象搜索：在树中逐层展开并选中目标对象 ──
const treeBodyEl = ref<HTMLElement>()

async function ensureLoaded(node: TreeNode, connId: string): Promise<void> {
  if (node.hasChildren && node.children === null) await controller.loadChildren(node, connId)
}

function selectReveal(node: TreeNode, connId: string): void {
  controller.select(node, connId)
  void nextTick(() => {
    treeBodyEl.value?.querySelector('.tree-node.selected')?.scrollIntoView({ block: 'center' })
  })
}

/** 在节点下递归查找目标表/视图：schemaOk 表示已进入正确的库/schema 层。 */
async function walkReveal(
  node: TreeNode,
  connId: string,
  schema: string,
  table: string,
  schemaOk: boolean,
): Promise<boolean> {
  await ensureLoaded(node, connId)
  const kids = node.children ?? []
  const isObj = (c: TreeNode) => c.kind === MetaNodeKind.Table || c.kind === MetaNodeKind.View
  if (schemaOk) {
    const direct = kids.find((c) => isObj(c) && c.name === table)
    if (direct) {
      selectReveal(direct, connId)
      return true
    }
    for (const g of kids) {
      if (g.kind === MetaNodeKind.Group && (g.group === 'tables' || g.group === 'views')) {
        g.expanded = true
        await ensureLoaded(g, connId)
        const hit = (g.children ?? []).find((c) => isObj(c) && c.name === table)
        if (hit) {
          selectReveal(hit, connId)
          return true
        }
      }
    }
    return false
  }
  for (const c of kids) {
    if (c.kind === MetaNodeKind.Schema) {
      if (c.name !== schema) continue
      c.expanded = true
      if (await walkReveal(c, connId, schema, table, true)) return true
    } else if (c.kind === MetaNodeKind.Database) {
      // 用户报告：之前每个 db 都 expand + ensureLoaded → 触发 5 个 group count(*) 查询，
      // MySQL 系（无独立 schema 层 / database 即 schema）下相当于「定位一个表就把所有库都打开」。
      // 修法：先轻量探测 db 的下级判断是 MySQL 系还是 PG 系：
      //   - MySQL 系：name === schema 才展开（其他 db 完全不动，省 N-1 倍 IO）
      //   - PG 系：单连接通常只挂 1 个 db，原样展开找 schema（多 db 场景下也只 expand
      //     候选 db，因为外层 selectReveal 命中就 return true 提前止损）
      await ensureLoaded(c, connId)
      const nested = (c.children ?? []).some((x) => x.kind === MetaNodeKind.Schema)
      if (!nested) {
        // MySQL 系：跳过名字不匹配的 db
        if (c.name !== schema) continue
        c.expanded = true
        if (await walkReveal(c, connId, schema, table, true)) return true
      } else {
        // PG 系：保留递归找 schema
        c.expanded = true
        if (await walkReveal(c, connId, schema, table, false)) return true
      }
    }
  }
  return false
}

/** 展开连接并定位到 schema.table 对象（供全局对象搜索点击跳转）。 */
async function revealObject(connId: string, schema: string, table: string): Promise<boolean> {
  const root = roots.value.find((r) => r.id === connId)?.node
  if (!root) return false
  root.expanded = true
  return walkReveal(root, connId, schema, table, false)
}

// ── 批量操作 ──
function bulkDrop(): void {
  emit('bulkDrop', [...multiSel.values()])
}
function bulkCopyNames(): void {
  const text = [...multiSel.values()].map((s) => s.node.sqlName ?? s.node.name).join('\n')
  void navigator.clipboard?.writeText(text)
}

/**
 * 展开全部：打开所有分组文件夹 + 所有根连接节点（只到根连接层；再深入会触发
 * 大量 information_schema 查询，对千张表的库不友好，用户想细看再点）。
 */
function expandAll(): void {
  const allGroups = new Set(roots.value.map((r) => r.group).filter(Boolean) as string[])
  expandedGroups.value = allGroups
  for (const r of roots.value) r.node.expanded = true
}
/** 收起全部：关分组 + 递归把所有 TreeNode.expanded 置 false（不动数据缓存）。 */
function collapseAll(): void {
  expandedGroups.value = new Set()
  const walk = (n: TreeNode): void => {
    n.expanded = false
    if (Array.isArray(n.children)) for (const c of n.children) walk(c)
  }
  for (const r of roots.value) walk(r.node)
}

defineExpose({
  reload,
  refreshNode,
  clearMulti: () => multiSel.clear(),
  revealObject,
  expandAll,
  collapseAll,
})
onMounted(reload)

// ─── 拖拽排序 ──────────────────────────────────────────────────────
// 两个独立的拖拽通道:
//   1. 连接 row:同组内 / 跨组 / 拖回未分组,用 ConnRoot.id 标识
//   2. 分组 row:整组排序,改 settings.groupOrder
// 没用第三方库,简单的 dataTransfer 字符串 + dragenter 高亮足够。
//
// 视觉:被拖项 .dragging(半透);hover 时目标 .drag-over(顶/底 2px 紫色边)。
const dragState = ref<{ kind: 'conn' | 'group'; id: string } | null>(null)
const dragOverKey = ref<string | null>(null)

function onConnDragStart(e: DragEvent, root: ConnRoot): void {
  // 阻止冒泡 — 防被父级 TreeItem 的 @dragstart(若有)吃掉.
  // 同时 stopImmediatePropagation 避免多个 listener 冲突.
  e.stopPropagation()
  dragState.value = { kind: 'conn', id: root.id }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // 设两种 type 兼容性更好(Electron / Safari / Firefox)
    try {
      e.dataTransfer.setData('text/plain', `conn:${root.id}`)
      e.dataTransfer.setData('application/x-skylerx-conn', root.id)
    } catch {
      /* 某些环境下 setData 可能失败,不致命 */
    }
  }
}
function onGroupDragStart(e: DragEvent, name: string): void {
  e.stopPropagation()
  dragState.value = { kind: 'group', id: name }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', `group:${name}`)
      e.dataTransfer.setData('application/x-skylerx-group', name)
    } catch {
      /* ignore */
    }
  }
}
function onDragOver(e: DragEvent, key: string): void {
  if (!dragState.value) return
  e.preventDefault()
  dragOverKey.value = key
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}
function onDragLeave(key: string): void {
  if (dragOverKey.value === key) dragOverKey.value = null
}
function clearDrag(): void {
  dragState.value = null
  dragOverKey.value = null
}

/**
 * 把连接 drop 到目标连接位置:把源 sortIndex 设为 (prev + target) / 2,
 * 同时如果跨组需要同步 group 字段。落库后 reload 拉回最新顺序。
 */
async function onConnDrop(targetRoot: ConnRoot, targetGroup: string | undefined): Promise<void> {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'conn' || src.id === targetRoot.id) return
  try {
    const full = await client.connections.get(src.id)
    full.group = targetGroup
    // 用 target.sortIndex - 0.5 让源插到目标之前;reload 后会按 0.5/1.5/2.5 排好
    const targetIdx = targetRoot.sortIndex ?? targetRoot.createdAt ?? Date.now()
    full.sortIndex = targetIdx - 0.5
    full.updatedAt = Date.now()
    await client.connections.update(full)
    await reload()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** 把连接 drop 到一个分组(整组容器 / 未分组区)末尾。 */
async function onConnDropToGroup(targetGroup: string | undefined): Promise<void> {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'conn') return
  try {
    const full = await client.connections.get(src.id)
    full.group = targetGroup
    // 末尾:max sortIndex + 1;空组就给 0
    const peers = roots.value.filter((r) => r.group === targetGroup && r.id !== src.id)
    const max = peers.reduce((m, r) => Math.max(m, r.sortIndex ?? 0), 0)
    full.sortIndex = max + 1
    full.updatedAt = Date.now()
    await client.connections.update(full)
    await reload()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

/** 把分组 drop 到另一分组位置(只改 settings.groupOrder)。 */
function onGroupDrop(targetGroup: string): void {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'group' || src.id === targetGroup) return
  const list = [...settings.groupOrder]
  // 把所有 known 分组合并 — 包括连接里冒出来但还没 persist 的
  for (const r of roots.value) if (r.group && !list.includes(r.group)) list.push(r.group)
  const fromIdx = list.indexOf(src.id)
  const toIdx = list.indexOf(targetGroup)
  if (fromIdx === -1 || toIdx === -1) return
  list.splice(fromIdx, 1)
  // 拖动后,源插到目标之前
  list.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, src.id)
  settings.groupOrder = list
}
</script>

<template>
  <div class="tree">
    <div class="tree-head">
      <span>{{ t('nav.title') }}</span>
      <span class="head-actions">
        <button class="icon" :title="t('nav.newConn')" @click="controller.newConnection()">+</button>
        <button class="icon" :title="t('nav.refresh')" @click="reload">⟳</button>
        <button class="icon" :title="t('nav.expandAll')" @click="expandAll">⊞</button>
        <button class="icon" :title="t('nav.collapseAll')" @click="collapseAll">⊟</button>
        <!-- 截图模式:一键切脱敏视图(masking.ts 规则集对 phone/email/idcard/bankcard 等列名匹配),
             给老板看截图前打开,看完关掉,所有窗口立即生效 -->
        <button
          class="icon"
          :class="{ on: settings.maskingEnabled }"
          :title="settings.maskingEnabled ? '截图模式 ON — 点关闭' : '截图模式 OFF — 点开启脱敏'"
          @click="settings.maskingEnabled = !settings.maskingEnabled"
        >{{ settings.maskingEnabled ? '🙈' : '👁' }}</button>
        <!-- Workspace 导出/导入(换电脑 / 团队共享) -->
        <button class="icon" title="导出/导入 workspace(连接 + Snippets)" @click="emit('openWorkspaceExport')">💾</button>
      </span>
    </div>
    <div ref="treeBodyEl" class="tree-body" @contextmenu="onTreeBodyContextmenu">
      <div v-if="!roots.length" class="tree-status">{{ t('nav.empty') }}</div>

      <template v-for="g in groupList" :key="'g:' + g.name">
        <!-- 分组行:整组拖拽 + 接收连接 drop(让用户把连接拖进这个组的标题) -->
        <div
          class="group-row"
          :class="{ 'drag-over': dragOverKey === 'g:' + g.name, dragging: dragState?.kind === 'group' && dragState.id === g.name }"
          draggable="true"
          @click="toggleGroup(g.name)"
          @contextmenu="onGroupContextmenu($event, g.name)"
          @dragstart="onGroupDragStart($event, g.name)"
          @dragover="onDragOver($event, 'g:' + g.name)"
          @dragleave="onDragLeave('g:' + g.name)"
          @drop="dragState?.kind === 'conn' ? onConnDropToGroup(g.name) : onGroupDrop(g.name)"
          @dragend="clearDrag"
        >
          <span class="caret">{{ expandedGroups.has(g.name) ? '▾' : '▸' }}</span>
          <span class="folder">📁</span>
          <span class="gname">{{ g.name }}</span>
          <span class="gcount">{{ g.conns.length }}</span>
        </div>
        <div v-show="expandedGroups.has(g.name)">
          <div
            v-for="r in g.conns"
            :key="r.id"
            class="conn-drag-wrap"
            :class="{ 'drag-over': dragOverKey === 'c:' + r.id, dragging: dragState?.kind === 'conn' && dragState.id === r.id }"
            draggable="true"
            @dragstart="onConnDragStart($event, r)"
            @dragover="onDragOver($event, 'c:' + r.id)"
            @dragleave="onDragLeave('c:' + r.id)"
            @drop="onConnDrop(r, g.name)"
            @dragend="clearDrag"
          >
            <TreeItem :node="r.node" :conn-id="r.id" :depth="1" :env="r.env" :dialect="r.dialect" />
          </div>
        </div>
      </template>

      <div
        v-for="r in ungrouped"
        :key="r.id"
        class="conn-drag-wrap"
        :class="{ 'drag-over': dragOverKey === 'c:' + r.id, dragging: dragState?.kind === 'conn' && dragState.id === r.id }"
        draggable="true"
        @dragstart="onConnDragStart($event, r)"
        @dragover="onDragOver($event, 'c:' + r.id)"
        @dragleave="onDragLeave('c:' + r.id)"
        @drop="onConnDrop(r, undefined)"
        @dragend="clearDrag"
      >
        <TreeItem :node="r.node" :conn-id="r.id" :depth="0" :env="r.env" :dialect="r.dialect" />
      </div>
    </div>

    <div v-if="multiSel.size" class="bulk-bar">
      <span class="bcount">{{ t('bulk.selected', { n: multiSel.size }) }}</span>
      <button class="danger" :title="t('bulk.delete')" @click="bulkDrop">{{ t('bulk.delete') }}</button>
      <button :title="t('bulk.copyNames')" @click="bulkCopyNames">{{ t('bulk.copyNames') }}</button>
      <button class="ghost" :title="t('common.cancel')" @click="controller.clearMulti()">✕</button>
    </div>

    <ContextMenu
      v-if="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :entries="menu.entries"
      @pick="onMenuPick"
      @close="menu.visible = false"
    />
  </div>
</template>

<style scoped>
.tree {
  width: 300px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--panel);
}
.tree-head {
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head-actions {
  display: flex;
  gap: 6px;
}
.head-actions .icon {
  padding: 2px 6px;
  font-size: 13px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
}
.head-actions .icon:hover {
  background: rgba(124, 108, 255, 0.12);
  color: var(--text);
}
.head-actions .icon.on {
  background: rgba(124, 108, 255, 0.22);
  color: var(--accent);
  border-color: var(--accent);
}
.tree-body {
  flex: 1;
  overflow: auto;
}
.tree-status {
  padding: 16px 12px;
  color: var(--muted);
  font-size: 13px;
}
.group-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  color: var(--text);
}
.group-row:hover {
  background: var(--hover, rgba(124, 108, 255, 0.1));
}
.group-row .caret {
  width: 12px;
  color: var(--muted);
  font-size: 10px;
}
.group-row .gname {
  flex: 1;
  font-weight: 500;
}
.group-row .gcount {
  color: var(--muted);
  font-size: 11px;
}
/* ── 拖拽视觉 ──
   draggable=true 时,鼠标 hover 显示 grab cursor 让用户清楚 "可以拖";
   按住开始拖时变 grabbing.
   之前用户反馈"拖动无效",一部分原因是没视觉反馈,以为没生效 */
.conn-drag-wrap,
.group-row {
  position: relative;
  cursor: grab;
}
.conn-drag-wrap:active,
.group-row:active {
  cursor: grabbing;
}
.conn-drag-wrap.dragging,
.group-row.dragging {
  opacity: 0.35;
  transform: scale(0.98);
  transition: transform 0.1s ease-out;
}
.conn-drag-wrap.drag-over,
.group-row.drag-over {
  /* 顶部一道粗紫色边 + 背景高亮表示"会插到这里之前", 用户清楚 drop target */
  box-shadow: inset 0 3px 0 0 var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.08);
}
.bulk-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
.bulk-bar .bcount {
  font-size: 12px;
  color: var(--muted);
  margin-right: auto;
}
.bulk-bar button {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
.bulk-bar button.danger {
  border-color: var(--err);
  color: var(--err);
}
.bulk-bar button.ghost {
  border: none;
  color: var(--muted);
}
</style>
