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
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { onSchemaChanged } from '../chat-bus'
import { setConnStatus } from '../conn-status'
import { connEnv } from '../connEnv'
import { isConnectionError } from '../connError'
import { useDataClient } from '../data-client'
import type { ObjectKind, SqlTemplateKind } from '../ddl'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError } from '../errorReporter'
import { t } from '../i18n'
import {
  type IndexHit,
  type SearchOpts,
  buildIndex,
  buildMatcher,
  getCached,
  invalidate as invalidateIndex,
  isStale,
  searchAllIndexes,
} from '../nav-object-index'
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
  createTemplateDraft: [
    'sequence' | 'event' | 'trigger' | 'package' | 'type' | 'synonym',
    string,
    TreeNode,
  ]
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
  /** 批量 TRUNCATE TABLE (#25). 只对 table 类型节点有意义. */
  bulkTruncate: [{ connId: string; node: TreeNode }[]]
  /** 批量复制 SELECT * FROM <name>; 模板, 便于贴进查询页 (#25). */
  bulkCopySelect: [{ connId: string; node: TreeNode }[]]
  /** 批量导出 CREATE DDL 到单个 .sql 文件 (#25). */
  bulkExportDdl: [{ connId: string; node: TreeNode }[]]
  /** 批量删除连接节点 (Connection kind) (#25). */
  bulkDeleteConnections: [string[]]
  /** 批量把连接移动到某分组(undefined = 未分组) (#25). */
  bulkMoveToGroup: [string[]]
  /** 批量并行测试连接 (#25). */
  bulkTestConnections: [string[]]
  /** Redis 专属:双击 key 节点 → 打开对应 db 的 RedisPane 并定位 key */
  openRedisKey: [connId: string, dbIndex: number, key: string]
  /** Redis 专属(#19):单击 key 节点 → 若已有匹配 RedisPane,激活并选中该 key;
   *  无匹配 tab 则什么都不做(不要单击就自动开 tab). */
  focusRedisKey: [connId: string, dbIndex: number, key: string]
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
  /** #24: 打开 "配置可见库/Schema" 对话框 */
  configureNavFilter: [connId: string]
  /** #D: 打开 "进程/会话列表" 对话框 */
  openProcessList: [connId: string]
}>()

// 批量可选的对象类型(与可删除类型一致). Connection 单独走另一套(connection multi-set)
// 因为连接没有 TreeNode.kind, 用空字符串占位 + 单独的 multiSelConn.
const MULTI_KINDS: MetaNodeKind[] = [
  MetaNodeKind.Table,
  MetaNodeKind.View,
  MetaNodeKind.Function,
  MetaNodeKind.Procedure,
  MetaNodeKind.Sequence,
  MetaNodeKind.Trigger,
  MetaNodeKind.Event,
  MetaNodeKind.Database,
  MetaNodeKind.Schema,
  MetaNodeKind.Index,
]
// 批量选择集：key → {node, connId}（保留 connId 以支持跨连接批量）
const multiSel = reactive(new Map<string, { node: TreeNode; connId: string }>())

/**
 * 同辈兄弟判定 (#multi-select sibling-only): 两个节点能一起多选当且仅当:
 *   - 同连接 (connId 相等) — 跨连接的批量 DROP 半天定位不出来 ref;
 *   - 同 kind — DROP TABLE 和 DROP VIEW 等价语法不一样, 不能混;
 *   - 同 parent path — node.path 去掉自己那段后剩下的祖先链相等 (e.g. 都在
 *     schema=A 的"表"组下). 跨 schema / 跨 group 的"同 kind"不算兄弟.
 */
function isSiblingOf(
  a: { node: TreeNode; connId: string },
  b: { node: TreeNode; connId: string },
): boolean {
  if (a.connId !== b.connId) return false
  if (a.node.kind !== b.node.kind) return false
  const pa = a.node.path.slice(0, -1).join('')
  const pb = b.node.path.slice(0, -1).join('')
  return pa === pb
}

/**
 * 批量选连接(独立于 multiSel — connection 没有 TreeNode 概念).
 * key = connectionId. 用户 Ctrl-click 连接条目时进这个集合;
 * 跟 multiSel 互斥(一次只能批量一种家族).
 */
const multiSelConn = reactive(new Set<string>())

/**
 * 最后一次单击的节点 key, 用于 Shift-click 范围选择 — Shift+click 会从
 * lastClickedKey 到当前节点的可见连续区间全部加进选择. visibleFlat 计算缓存了
 * 当前可见节点的扁平顺序, 区间端点都用 nodeKey 索引.
 */
const lastClickedKey = ref<string | null>(null)

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
  /** #24: 可见库/Schema 白名单 (从 extra.visibleDatabases 抄过来). 非空时
   *  TreeItem.displayChildren 用它过滤 Connection 节点直挂的 Database / Schema. */
  visibleDatabases?: string[]
  /** #24: 配置过滤时 snapshot 的总数 (top-level database/schema 数量).
   *  用于 N/M chip 在连接未展开时也能立即显示分母. 跟 visibleDatabases 一起进/出. */
  visibleDatabasesTotal?: number
  /** #24 v2: 每个库下的可见 schema 白名单. key=database name, value=schema names.
   *  unset/缺 key = 该库下全显; 空数组 = 该库下全隐 (罕见但允许). 仅对支持库→schema
   *  两层结构的方言有效 (PG 系 / MSSQL / ClickHouse), Oracle/DM 这种 conn 直挂 schema
   *  的方言走顶层 visibleDatabases 已经覆盖. */
  visibleSchemas?: Record<string, string[]>
}

const roots = ref<ConnRoot[]>([])
const expandedGroups = ref<Set<string>>(new Set())

/**
 * NavTree 内 search box (#A): 实时按名字过滤可见节点 — 仅匹配已加载的节点子树
 * (children===null 的懒加载分支不强制 fetch). 过滤算法在 TreeItem 里读
 * controller.search()/nodeMatchesSearch() 后跑, 连接根级在下面 groupList/ungrouped
 * computed 里也过滤. 匹配节点的祖先链整链显示, 即使祖先名字不匹配 — 否则用户找不到
 * 路径. 清空 = 恢复全树. */
const searchQuery = ref('')
const searchVisible = ref(false)
const searchInputEl = ref<HTMLInputElement>()
const searchLower = computed(() => searchQuery.value.trim().toLowerCase())
/** VSCode 风格搜索选项 — 三按钮 Aa / \b / .* . 全 off = 历史行为 (大小写不敏感 + contains). */
const searchOpts = ref<SearchOpts>({ caseSensitive: false, wholeWord: false, useRegex: false })
function toggleCase(): void {
  searchOpts.value = { ...searchOpts.value, caseSensitive: !searchOpts.value.caseSensitive }
}
function toggleWord(): void {
  searchOpts.value = { ...searchOpts.value, wholeWord: !searchOpts.value.wholeWord }
}
function toggleRegex(): void {
  searchOpts.value = { ...searchOpts.value, useRegex: !searchOpts.value.useRegex }
}
/** 编译当前 query+opts 一次, 复用给 nodeMatchesSearch (树本地) 用. */
const localMatch = computed(() => buildMatcher(searchQuery.value, searchOpts.value))
/** 用于 catalog 命中 watch / globalHits 触发 — opts 一变就重算 */
const optsSignature = computed(
  () =>
    `${searchOpts.value.caseSensitive ? 'C' : 'c'}${searchOpts.value.wholeWord ? 'W' : 'w'}${searchOpts.value.useRegex ? 'R' : 'r'}`,
)

function toggleSearch(): void {
  if (searchQuery.value) {
    // 有内容时 🔍 按钮 = 清空 + 关闭
    searchQuery.value = ''
    searchVisible.value = false
    return
  }
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    void nextTick(() => searchInputEl.value?.focus())
  }
}
function closeSearch(): void {
  searchQuery.value = ''
  searchVisible.value = false
}

// ── 全库对象索引 (#A v2) — 跨连接 catalog 缓存 ─────────────────────────
/** 当前正在 build 索引的 connId 集合 — 进度条 + 防重入 */
const buildingIndexes = ref<Set<string>>(new Set())
/** 触发响应式 — getCached() 不是 reactive, 用一个递增计数让 globalHits 能跟着更新 */
const indexVersion = ref(0)

/**
 * 后台静默 build — 失败永远不弹模态 / 不 toast 警告. 索引构建只服务于搜索, 失败
 * 等于该连接的对象暂时搜不到, 不是用户能立即处理的状态, 不打扰. 仅 console.debug
 * 留痕给开发者诊断. ObjectIndexNotSupported 同样静默 (用户改不了方言).
 *
 * 失败的连接会被 isStale() 判定为 stale, 下次 searchQuery 变化时 watch 会再尝试
 * 一次 — 不浪费机会, 但不刷屏.
 */
async function buildConnIndex(connId: string): Promise<void> {
  if (buildingIndexes.value.has(connId)) return
  const root = roots.value.find((r) => r.id === connId)
  if (!root) return
  buildingIndexes.value = new Set([...buildingIndexes.value, connId])
  try {
    await buildIndex(client, connId, root.dialect as DbDialect)
    indexVersion.value++
  } catch (e) {
    // 静默 — 见上方注释. 写一条 debug 行方便开发模式下 DevTools 看
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV === true) {
      console.debug('[nav-object-index] build failed for', root.node.name, e)
    }
  } finally {
    const next = new Set(buildingIndexes.value)
    next.delete(connId)
    buildingIndexes.value = next
  }
}

function rebuildConnIndex(connId: string): void {
  invalidateIndex(connId)
  void buildConnIndex(connId)
}

/**
 * 用户开始搜索时, 后台并发触发所有 stale 连接的索引构建. 默认行为, 不需要任何
 * UI prompt. 重复搜索不重复 build (buildingIndexes Set + isStale 双重保护).
 * 防抖 150ms — 用户连打几个字符不要每个字符触发一波. */
let searchAutoBuildTimer: ReturnType<typeof setTimeout> | null = null
watch(searchLower, (q) => {
  if (!q) return
  if (searchAutoBuildTimer) clearTimeout(searchAutoBuildTimer)
  searchAutoBuildTimer = setTimeout(() => {
    for (const r of roots.value) {
      if (isStale(getCached(r.id)) && !buildingIndexes.value.has(r.id)) {
        void buildConnIndex(r.id)
      }
    }
  }, 150)
})

/**
 * 当前 query 在已建索引里的全局命中. 触发 indexVersion 时重算. searchAllIndexes
 * 只按 name 匹配, 这里再过 kind 过滤 (用户在 pill 行勾选要看的对象类型).
 * 上限 200 条避免 UI 卡; 大量结果让用户细化 query.
 */
const ALL_INDEX_KINDS = [
  'table',
  'view',
  'function',
  'procedure',
  'sequence',
  'trigger',
  'index',
] as const
type IndexKind = (typeof ALL_INDEX_KINDS)[number]
const KIND_META: Record<IndexKind, { icon: string; label: string }> = {
  table: { icon: '🗃', label: '表' },
  view: { icon: '👁', label: '视图' },
  function: { icon: 'ƒ', label: '函数' },
  procedure: { icon: '⚙', label: '过程' },
  sequence: { icon: '#', label: '序列' },
  trigger: { icon: '⚡', label: '触发器' },
  index: { icon: '∝', label: '索引' },
}
/** 用户勾选的 kind 集合 — 默认全选 */
const enabledKinds = ref<Set<IndexKind>>(new Set(ALL_INDEX_KINDS))

/** 当前 query 的所有 name-match 命中, 用于:
 *  (a) globalHits = enabledKinds 过滤后的最终列表
 *  (b) kindCounts = 各 kind 下的总数 (用户决定要不要勾选这个 kind 看更多) */
const rawHits = computed<IndexHit[]>(() => {
  void indexVersion.value
  void optsSignature.value // VSCode 按钮变化也要触发重算
  const q = searchQuery.value.trim()
  if (!q) return []
  // 上限给宽一些 — kind 过滤后才截 200, 否则用户取消勾选某 kind 可能导致看似为空
  return searchAllIndexes(q, 1000, searchOpts.value)
})

const globalHits = computed<IndexHit[]>(() => {
  return rawHits.value.filter((h) => enabledKinds.value.has(h.kind as IndexKind)).slice(0, 200)
})

const kindCounts = computed<Record<IndexKind, number>>(() => {
  const out = {
    table: 0,
    view: 0,
    function: 0,
    procedure: 0,
    sequence: 0,
    trigger: 0,
    index: 0,
  } as Record<IndexKind, number>
  for (const h of rawHits.value) {
    if (h.kind in out) out[h.kind as IndexKind]++
  }
  return out
})

function toggleKind(k: IndexKind): void {
  const next = new Set(enabledKinds.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  enabledKinds.value = next
}

/** 搜索激活但还有连接正在后台 build 索引 — UI 上用静默 dot 提示 (不抢操作) */
const isAnyIndexBuilding = computed(() => buildingIndexes.value.size > 0)

/** 当前已构建索引的总对象数 — 用户搜不到时给个 "我们到底搜了多少东西" 的反馈,
 *  避免 "目录里没找到" 这种模糊提示让人怀疑功能没工作. */
const indexedTotal = computed(() => {
  void indexVersion.value
  let n = 0
  for (const r of roots.value) {
    n += getCached(r.id)?.entries.length ?? 0
  }
  return n
})

/** Reveal 一个 IndexHit 到树里, 失败给 toast 提示. */
async function revealIndexHit(hit: IndexHit): Promise<void> {
  // 当前 revealObject 仅认 tables/views; functions/procedures 等先 fallback
  // 到 toast (后续 v2 扩展 walkReveal 也认它们).
  if (hit.kind !== 'table' && hit.kind !== 'view') {
    toast.warn(
      `已找到 ${hit.kind} ${hit.name} (定位到 ${hit.db || hit.schema || ''}, 自动展开暂未支持)`,
    )
    return
  }
  // PG 用 schema 作"库"参数 (revealObject 内部 walkReveal 会按方言判定);
  // 其它方言 hit.db 就是导航首层.
  const schemaForReveal = hit.schema || hit.db
  const ok = await revealObject(hit.connId, schemaForReveal, hit.name)
  if (!ok) {
    toast.warn(`未在树中找到 ${schemaForReveal}.${hit.name} (可能已被过滤或刚被删除)`)
    return
  }
  // 命中后顺手收起搜索栏, 让用户看到选中节点 (不清空 query — 万一还想看别的)
  searchVisible.value = false
}

/** 递归判断: 该节点自身名字命中, 或任何已加载的后代命中. 用 localMatch (含
 *  VSCode 风格 case/word/regex 选项) 做实际匹配; 空 query 时 buildMatcher 返
 *  回 () => true, 所有节点都通过. */
function nodeMatchesSearch(node: TreeNode): boolean {
  if (!searchQuery.value.trim()) return true
  if (localMatch.value(node.name)) return true
  const kids = node.children
  if (kids == null) return false
  return kids.some(nodeMatchesSearch)
}

/**
 * 按 group 聚合,并按 settings.groupOrder 排序:
 *  - groupOrder 数组里的顺序优先(用户拖动的顺序);未列出的从连接 group 字段冒出来的追加在后
 *  - 空分组(只在 groupOrder 里出现但没有任何连接)也显示 —— 支持"先建组再分进去"流程
 *  - 同分组内连接按 sortIndex 升序(缺省走 createdAt)
 */
/** 应用搜索过滤到一个连接根列表 — 跟内部 nodeMatchesSearch 同语义:
 *  连接名命中 / 已展开的子树有命中 → 保留; 严格匹配, 不渲染懒加载未触发的连接. */
function applyConnSearch(list: ConnRoot[]): ConnRoot[] {
  if (!searchLower.value) return list
  return list.filter((r) => nodeMatchesSearch(r.node))
}

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
  return ordered.map(([name, conns]) => ({ name, conns: applyConnSearch(sortRoots(conns)) }))
})
const ungrouped = computed(() => applyConnSearch(sortRoots(roots.value.filter((r) => !r.group))))

/**
 * Visible flat list of expandable / selectable object-nodes inside connections,
 * in DOM order. Used by Shift+click range select (#25) — controller.rangeSelect
 * walks the visible nodes between the anchor and the clicked one, adding each
 * eligible object to multiSel.
 *
 * Only includes nodes whose ancestors are all expanded (so collapsed branches
 * don't surprise-multi-select dozens of hidden tables).
 */
const visibleObjectFlat = computed<{ node: TreeNode; connId: string }[]>(() => {
  const out: { node: TreeNode; connId: string }[] = []
  function visit(node: TreeNode, connId: string): void {
    out.push({ node, connId })
    if (!node.expanded) return
    for (const c of node.children ?? []) visit(c, connId)
  }
  for (const r of roots.value) {
    if (!r.node.expanded) continue
    for (const c of r.node.children ?? []) visit(c, r.id)
  }
  return out
})

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
/** 子树身份键（不含 connId）：深刷新重建子节点后用它把展开状态对回新节点。 */
function subtreeKey(node: TreeNode): string {
  return `${node.kind}::${node.path.join('/')}::${node.group ?? ''}`
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
      // 成功拉到元数据 → 该连接可达,记一个绿点
      setConnStatus(connId, 'ok')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 不在树里显示错误：收起该节点，错误通过弹窗 / toast 呈现
      node.children = null
      node.expanded = false
      // 连接节点打不开，或任意层级的连接级错误 → 弹出该连接编辑框
      if (node.kind === MetaNodeKind.Connection || isConnectionError(msg)) {
        setConnStatus(connId, 'error')
        emit('connError', connId, msg)
      } else {
        // 非连接级错误(权限/SQL/驱动 bug 等):用户之前报告"不报错只是节点收起",
        // 看不到任何提示以为软件无响应. Surface via reportError() → toast 显示调用位置 + 一键复制 markdown 报告.
        // TODO(v2): restore askAi: { error, connId, errorCode } context once reportError supports
        // passing structured AI-debug payloads beyond the error object. Refs #13
        reportError(new Error(msg), { tag: 'nav-tree-expand' })
      }
    } finally {
      node.loading = false
    }
  },
  select(node, connId) {
    selectedKey.value = nodeKey(node, connId)
    // #19: 单击 Redis key 节点 → 若已有匹配的 RedisPane tab,联动激活并选中该 key.
    // node.group === 'redis-key' 是 redis 驱动写入的标记(同 openNode 路径用的判别).
    // 不主动开新 tab — 那是双击 (openNode → openRedisKey) 的语义.
    if (node.kind === MetaNodeKind.Column && node.group === 'redis-key' && node.path.length >= 3) {
      const dbIndex = Number(node.path[0]) || 0
      emit('focusRedisKey', connId, dbIndex, node.name)
    }
  },
  isSelected(node, connId) {
    return selectedKey.value === nodeKey(node, connId)
  },
  toggleMulti(node, connId) {
    if (!MULTI_KINDS.includes(node.kind)) return
    // Cross-family lock: connection multi-set takes the slot whenever it's
    // non-empty. Mixing connections and objects in one batch isn't meaningful
    // (the bulk ops dispatch differently) so we just refuse the toggle.
    if (multiSelConn.size > 0) return
    // 同辈约束: 多选只在 "同一上级 + 同一 kind" 的兄弟节点之间允许. 跨 schema /
    // 跨 group / 跨 kind 的混选语义模糊(DROP TABLE 和 DROP VIEW 不一样, 跨 schema
    // 引用语法也不同), 直接拒绝, 不打扰. 用户想换一组就先取消现有再选.
    const first = multiSel.values().next().value
    if (first && !isSiblingOf(first, { node, connId })) return
    const k = nodeKey(node, connId)
    if (multiSel.has(k)) multiSel.delete(k)
    else multiSel.set(k, { node, connId })
    lastClickedKey.value = k
  },
  toggleMultiConn(connId) {
    if (multiSel.size > 0) return // same family-lock as toggleMulti
    if (multiSelConn.has(connId)) multiSelConn.delete(connId)
    else multiSelConn.add(connId)
    lastClickedKey.value = `conn:${connId}`
  },
  isMultiSelected(node, connId) {
    return multiSel.has(nodeKey(node, connId))
  },
  isMultiSelectedConn(connId) {
    return multiSelConn.has(connId)
  },
  /**
   * Shift+click 范围选择 — visibleFlat 列出当前可见的同家族节点(对象或连接),
   * 从 lastClickedKey 到 (node, connId) 区间整段加进 multiSel(已选保持).
   * 若 lastClickedKey 不存在/不同家族, 退化为单击 toggle.
   */
  rangeSelect(node, connId) {
    const me = nodeKey(node, connId)
    if (!lastClickedKey.value || lastClickedKey.value === me) {
      // No anchor or same node → behave as a plain toggle for forgiving UX.
      controller.toggleMulti(node, connId)
      return
    }
    const flat = visibleObjectFlat.value
    const a = flat.findIndex((it) => nodeKey(it.node, it.connId) === lastClickedKey.value)
    const b = flat.findIndex((it) => nodeKey(it.node, it.connId) === me)
    if (a < 0 || b < 0) {
      controller.toggleMulti(node, connId)
      return
    }
    const anchor = flat[a]
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    for (let i = lo; i <= hi; i++) {
      const it = flat[i]
      if (!MULTI_KINDS.includes(it.node.kind)) continue
      // Shift-range 同样套同辈约束: 区间里只收跟锚点(anchor) 同 parent + 同 kind 的.
      // 这样跨 schema / 跨 group 选不到, 跟单击 toggleMulti 一致.
      if (!isSiblingOf(anchor, it)) continue
      multiSel.set(nodeKey(it.node, it.connId), { node: it.node, connId: it.connId })
    }
    lastClickedKey.value = me
  },
  rangeSelectConn(connId) {
    if (!lastClickedKey.value) {
      controller.toggleMultiConn(connId)
      return
    }
    if (lastClickedKey.value.startsWith('conn:')) {
      const anchor = lastClickedKey.value.slice('conn:'.length)
      const a = roots.value.findIndex((r) => r.id === anchor)
      const b = roots.value.findIndex((r) => r.id === connId)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        for (let i = lo; i <= hi; i++) multiSelConn.add(roots.value[i].id)
        lastClickedKey.value = `conn:${connId}`
        return
      }
    }
    controller.toggleMultiConn(connId)
  },
  clearMulti() {
    multiSel.clear()
    multiSelConn.clear()
    lastClickedKey.value = null
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
    // 多选模式 — 右键命中已选中的对象 / 连接 → 显示批量菜单, 不显示单节点菜单.
    // 选了一组表 → 右键某一张 → "批量删除 / 复制 SELECT / 导出 DDL ..." 走这里.
    // 选中集中不含被点的节点 → 当作"单选切换", 走普通单节点菜单.
    if (
      node.kind === MetaNodeKind.Connection &&
      multiSelConn.size > 0 &&
      multiSelConn.has(connId)
    ) {
      menu.entries = bulkConnMenuEntries()
      menu.visible = true
      return
    }
    if (multiSel.size > 0 && multiSel.has(nodeKey(node, connId))) {
      menu.entries = bulkObjectMenuEntries()
      menu.visible = true
      return
    }
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
  async refreshNode(node, connId, reveal = false) {
    // 折叠 / 叶子节点：默认只清缓存让下次展开重新拉取（深刷新整连接时别急着把每个
    // 折叠分组都加载一遍）。reveal=true（手动刷新 / 新建对象）时即使折叠也强制重载，
    // 这样某类对象的「第一个」(分组原本 count=0、不可展开) 也能更新计数并直接浮现。
    if (!node.expanded && !reveal) {
      node.children = null
      return
    }
    // 记录哪些子节点当前是展开的 —— loadChildren 会用新对象替换 children，
    // 重新拉完后按 subtreeKey 把展开状态对回新节点并递归刷新，避免「刷新即折叠、
    // 新建对象不浮现」。这也让手动刷新 schema 时其已展开分组里的新对象直接显示。
    const wasExpanded = new Set((node.children ?? []).filter((c) => c.expanded).map(subtreeKey))
    await this.loadChildren(node, connId)
    // 注：TS 看不到 loadChildren 的副作用，children 类型仍被收窄为 null，所以这里走 unknown 中转
    const reloaded = node.children as unknown as TreeNode[] | null
    if (reloaded) {
      // 从实际子节点同步 count（"表 (15)"）与 hasChildren —— count=0 的空分组新建首个对象后
      // 由此变为可展开；reveal 时顺手展开，让新对象立即可见。
      node.hasChildren = reloaded.length > 0
      if (node.kind === MetaNodeKind.Group) node.count = reloaded.length
      if (reveal && reloaded.length > 0) node.expanded = true
    }
    if (!reloaded) return
    for (const child of reloaded) {
      if (wasExpanded.has(subtreeKey(child))) {
        child.expanded = true
        // 子层只保留原展开状态，不强制 reveal（避免深刷新把整棵树都摊开）
        await this.refreshNode(child, connId)
      }
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
  connVisibleFilter(connId) {
    const root = roots.value.find((r) => r.id === connId)
    if (!root?.visibleDatabases || root.visibleDatabases.length === 0) return null
    return new Set(root.visibleDatabases)
  },
  connVisibleTotal(connId) {
    return roots.value.find((r) => r.id === connId)?.visibleDatabasesTotal ?? null
  },
  connVisibleSchemas(connId, database) {
    const root = roots.value.find((r) => r.id === connId)
    const map = root?.visibleSchemas
    if (!map) return null
    const list = map[database]
    if (!Array.isArray(list)) return null
    return new Set(list)
  },
  configureNavFilter: (connId) => emit('configureNavFilter', connId),
  searchActive: () => searchLower.value.length > 0,
  nodeMatchesSearch,
  openProcessList: (connId) => emit('openProcessList', connId),
  rebuildObjectIndex: (connId) => rebuildConnIndex(connId),
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
  // Validate inline so "duplicate name" feedback appears under the input
  // instead of closing the prompt and surfacing a bottom-right toast (#20).
  const name = await appPrompt({
    message: t('ctx.new-group'),
    defaultValue: '新分组',
    validator: (v) => {
      const t2 = v.trim()
      if (!t2) return '名称不能为空'
      if (settings.groupOrder.includes(t2)) return `分组 "${t2}" 已存在`
      return null
    },
  })
  const trimmed = name?.trim()
  if (!trimmed) return
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
    reportError(e)
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
    reportError(e)
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
    const extra = c.extra as
      | {
          visibleDatabases?: unknown
          visibleDatabasesTotal?: unknown
          visibleSchemas?: unknown
        }
      | undefined
    const allow = extra?.visibleDatabases
    const visibleDatabases =
      Array.isArray(allow) && allow.length > 0
        ? allow.filter((x): x is string => typeof x === 'string')
        : undefined
    const totalRaw = extra?.visibleDatabasesTotal
    const visibleDatabasesTotal =
      typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : undefined
    // visibleSchemas: 防御性 — 期望是 Record<string, string[]>, 防错码塞了别的类型
    let visibleSchemas: Record<string, string[]> | undefined
    const vs = extra?.visibleSchemas
    if (vs && typeof vs === 'object' && !Array.isArray(vs)) {
      const cleaned: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(vs)) {
        if (Array.isArray(v)) cleaned[k] = v.filter((x): x is string => typeof x === 'string')
      }
      if (Object.keys(cleaned).length > 0) visibleSchemas = cleaned
    }
    return {
      id: c.id,
      node,
      group: c.group,
      env: connEnv(c),
      dialect: c.dialect,
      sortIndex: c.sortIndex,
      createdAt: c.createdAt,
      visibleDatabases,
      visibleDatabasesTotal,
      visibleSchemas,
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
function refreshNode(node: TreeNode, connId: string, reveal = false): void {
  void controller.refreshNode(node, connId, reveal)
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

// ── 批量操作 (#25) ──
function bulkDrop(): void {
  emit('bulkDrop', [...multiSel.values()])
}
function bulkTruncate(): void {
  emit(
    'bulkTruncate',
    [...multiSel.values()].filter((v) => v.node.kind === MetaNodeKind.Table),
  )
}
function bulkCopyNames(): void {
  const text = [...multiSel.values()].map((s) => s.node.sqlName ?? s.node.name).join('\n')
  void navigator.clipboard?.writeText(text)
  toast.success(t('common.copied'))
}
function bulkCopySelect(): void {
  emit('bulkCopySelect', [...multiSel.values()])
}
function bulkExportDdl(): void {
  emit('bulkExportDdl', [...multiSel.values()])
}
function bulkDeleteConnections(): void {
  emit('bulkDeleteConnections', [...multiSelConn])
}
function bulkMoveToGroup(): void {
  emit('bulkMoveToGroup', [...multiSelConn])
}
function bulkTestConnections(): void {
  emit('bulkTestConnections', [...multiSelConn])
}

/**
 * 右键菜单 — 批量对象模式. 跟单节点 TreeAction 同一形态(id/label/run/...),
 * 但 run 不读 ctx, 直接调用本组件的 bulkXxx 函数 (它们走 emit 上抛 Workspace).
 * 表 / 视图 / 函数 / etc. 公用 删除 / 复制名 / 导出 DDL; 全选都是 Table 时多出
 * TRUNCATE 和 复制 SELECT 模板.
 *
 * MenuEntry.kinds 留单个占位 — 这条菜单只在 openContextMenu 已经决定走 bulk
 * 路径时使用, 不会过 menuEntriesFor 的 kind 过滤.
 */
function bulkObjectMenuEntries(): MenuEntry[] {
  const all = [...multiSel.values()]
  const allTables = all.length > 0 && all.every((v) => v.node.kind === MetaNodeKind.Table)
  const kindNames = new Set(all.map((v) => v.node.kind))
  const onlyKind = kindNames.size === 1 ? [...kindNames][0] : null
  const stub = (id: string, label: string, run: () => void, danger = false): TreeAction => ({
    id,
    label,
    kinds: onlyKind ? [onlyKind] : [MetaNodeKind.Table],
    section: 'misc',
    danger,
    run,
  })
  const out: MenuEntry[] = [stub('bulk-drop', `删除所选 (${all.length})`, bulkDrop, true)]
  if (allTables) {
    out.push(stub('bulk-truncate', `TRUNCATE 所选表 (${all.length})`, bulkTruncate, true))
  }
  out.push({ divider: true, id: 'd1' })
  out.push(stub('bulk-copy-names', `复制名 (${all.length})`, bulkCopyNames))
  if (allTables) {
    out.push(stub('bulk-copy-select', `复制 SELECT * 模板 (${all.length})`, bulkCopySelect))
  }
  out.push(stub('bulk-export-ddl', `导出 DDL 到文件 (${all.length})`, bulkExportDdl))
  out.push({ divider: true, id: 'd2' })
  out.push(stub('bulk-clear', '清空选择', () => controller.clearMulti()))
  return out
}

function bulkConnMenuEntries(): MenuEntry[] {
  const n = multiSelConn.size
  const stub = (id: string, label: string, run: () => void, danger = false): TreeAction => ({
    id,
    label,
    kinds: [MetaNodeKind.Connection],
    section: 'misc',
    danger,
    run,
  })
  return [
    stub('bulk-test-conns', `测试连接 (${n})`, bulkTestConnections),
    stub('bulk-move-group', `移动到分组... (${n})`, bulkMoveToGroup),
    { divider: true, id: 'd1' },
    stub('bulk-del-conns', `删除连接 (${n})`, bulkDeleteConnections, true),
    { divider: true, id: 'd2' },
    stub('bulk-clear', '清空选择', () => controller.clearMulti()),
  ]
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
  clearMulti: () => {
    multiSel.clear()
    multiSelConn.clear()
    lastClickedKey.value = null
  },
  revealObject,
  expandAll,
  collapseAll,
})
// query tab 执行 / 提交 DDL 后 → 深刷新对应连接子树（只重载已展开的节点，
// 开销受用户已展开范围约束）。schema 只是提示，这里统一深刷新整连接根：
// 能覆盖「对象落到了非预期 schema」的错配场景，让新对象在它真正所在处浮现。
const unsubSchemaChanged = onSchemaChanged(({ connId }) => {
  const root = roots.value.find((r) => r.id === connId)
  if (root) void controller.refreshNode(root.node, connId)
})
onBeforeUnmount(() => unsubSchemaChanged())

onMounted(() => {
  void reload()
  // #A: 全局 Ctrl/Cmd+F 仅在焦点不在 Monaco 编辑器内时拦截 (Monaco 自己的 find 优先).
  // 检测方式: e.target 不在 .monaco-editor 容器里就吃这个事件; 否则放行.
  function onKey(e: KeyboardEvent): void {
    if (!(e.key === 'f' || e.key === 'F')) return
    if (!(e.ctrlKey || e.metaKey)) return
    const target = e.target as HTMLElement | null
    if (target?.closest('.monaco-editor')) return // 让 Monaco 接管
    e.preventDefault()
    searchVisible.value = true
    void nextTick(() => searchInputEl.value?.focus())
  }
  window.addEventListener('keydown', onKey)
})

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
 * Group-row dragover with Y-split for connection drags:
 *   - upper half (and prevGroup exists) → drop will land in prevGroup
 *   - lower half (or no prevGroup)      → drop will land in thisGroup
 *
 * Replaces the per-group `drop-rail-tail` element that used to absorb drops
 * in the visible gap between groups — that rail occupied 10-15px of resting
 * vertical space which read as unexplained whitespace under each group.
 * Group-reorder drags (kind === 'group') don't Y-split — they always target
 * thisGroup as before.
 */
function onGroupRowDragOver(e: DragEvent, thisGroup: string, prevGroup: string | undefined): void {
  if (!dragState.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  if (dragState.value.kind === 'conn' && prevGroup !== undefined) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const isUpper = e.clientY < rect.top + rect.height / 2
    dragOverKey.value = isUpper ? `tail:g:${prevGroup}` : `g:${thisGroup}`
  } else {
    dragOverKey.value = `g:${thisGroup}`
  }
}

function onGroupRowDragLeave(thisGroup: string, prevGroup: string | undefined): void {
  if (
    dragOverKey.value === `g:${thisGroup}` ||
    (prevGroup !== undefined && dragOverKey.value === `tail:g:${prevGroup}`)
  ) {
    dragOverKey.value = null
  }
}

function onGroupRowDrop(thisGroup: string, prevGroup: string | undefined): void {
  const src = dragState.value
  if (!src) return
  if (src.kind === 'conn') {
    // Re-read dragOverKey rather than recomputing Y — the last hover position
    // is authoritative (matches what the user just saw highlighted).
    if (prevGroup !== undefined && dragOverKey.value === `tail:g:${prevGroup}`) {
      void onConnDropToGroup(prevGroup)
    } else {
      void onConnDropToGroup(thisGroup)
    }
  } else {
    onGroupDrop(thisGroup)
  }
}

/**
 * Batch reorder helper —— 给目标组里的全体 peers 按 desiredOrderIds 重新分配
 * sort_index = 1, 2, 3, ..., src 同步 group 字段（跨组拖时）。
 *
 * 为什么不是只改 src 一个 (target.sortIndex - 0.5)：
 *   之前的实现把 src.sortIndex 设成 target.sortIndex - 0.5, 但旧版后端
 *   listConnections 按 updated_at DESC 排,根本没用 sort_index → 每次拖完
 *   src 都跑到第 1 位. 现在后端改用 sort_index ASC + tie-break created_at,
 *   只改 src 一个仍会出 null 域 vs. 1.5 域混排的问题 (target sort_index 为
 *   null 时 src=null-0.5=NaN). 干脆把整组 normalize 成 1..N, 永远干净.
 *
 * N 个 IPC 并行 (Promise.all), 50 个连接也只 ~250ms.
 */
async function reorderGroup(
  desiredOrderIds: string[],
  srcId: string,
  newGroup: string | undefined,
): Promise<void> {
  await Promise.all(
    desiredOrderIds.map(async (id, i) => {
      const full = await client.connections.get(id)
      full.sortIndex = i + 1
      if (id === srcId) full.group = newGroup
      await client.connections.update(full)
    }),
  )
}

/**
 * 把连接 drop 到目标连接位置: src 插入 target 之前 (src 占据 target 当前的视觉
 * 位置, target 往下推一格)，整组重排 sort_index。落库后 reload。
 */
async function onConnDrop(targetRoot: ConnRoot, targetGroup: string | undefined): Promise<void> {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'conn' || src.id === targetRoot.id) return
  try {
    // target 组的 peers（按当前视觉顺序），剔除 src（跨组拖时 src 不在 target 组也无碍）
    const groupPeers = roots.value.filter(
      (r) => (r.group ?? '') === (targetGroup ?? '') && r.id !== src.id,
    )
    const targetIdx = groupPeers.findIndex((p) => p.id === targetRoot.id)
    if (targetIdx < 0) return
    // 把 src.id 插入到 targetIdx 位置（顶替 target，target 后移）
    const desired: string[] = [
      ...groupPeers.slice(0, targetIdx).map((p) => p.id),
      src.id,
      ...groupPeers.slice(targetIdx).map((p) => p.id),
    ]
    await reorderGroup(desired, src.id, targetGroup)
    await reload()
  } catch (e) {
    reportError(e)
  }
}

/**
 * 把连接 drop 到一个分组 / 未分组区的**最前**位置(position 0)。
 *
 * 用户报告 (#27 续):
 *   - 分组里的节点拖到所有分组之外 / 第一个位置时, 没脱离分组成为未分组首位.
 * 修法: 树顶部加一条 drop-rail, 触发这里 — src.group = undefined,
 *      并被插到 ungrouped 区第 0 位.
 */
async function onConnDropToGroupTop(targetGroup: string | undefined): Promise<void> {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'conn') return
  try {
    const groupPeers = roots.value.filter(
      (r) => (r.group ?? '') === (targetGroup ?? '') && r.id !== src.id,
    )
    const desired: string[] = [src.id, ...groupPeers.map((p) => p.id)]
    await reorderGroup(desired, src.id, targetGroup)
    await reload()
  } catch (e) {
    reportError(e)
  }
}

/** 把连接 drop 到一个分组(整组容器 / 未分组区)末尾。 */
async function onConnDropToGroup(targetGroup: string | undefined): Promise<void> {
  const src = dragState.value
  clearDrag()
  if (!src || src.kind !== 'conn') return
  try {
    const groupPeers = roots.value.filter(
      (r) => (r.group ?? '') === (targetGroup ?? '') && r.id !== src.id,
    )
    const desired: string[] = [...groupPeers.map((p) => p.id), src.id]
    await reorderGroup(desired, src.id, targetGroup)
    await reload()
  } catch (e) {
    reportError(e)
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
        <button
          class="icon"
          :class="{ on: searchQuery }"
          :title="searchQuery ? '清空搜索' : '搜索 (Ctrl/⌘+F)'"
          @click="toggleSearch"
        >🔍</button>
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
    <!-- #A: 搜索栏 — 平时隐藏, 点 🔍 / 按 Ctrl+F 展开. v-show 保留 DOM 让 input
         ref 始终拿得到, focus() 立即响应. -->
    <div v-show="searchVisible" class="tree-search-wrap">
      <input
        ref="searchInputEl"
        v-model="searchQuery"
        class="tree-search"
        type="text"
        placeholder="搜索 库 / 表 / 列..."
        @keydown.escape="closeSearch"
      />
      <!-- VSCode 风格三个选项按钮 — 跟 ⌘F 编辑器搜索行为一致 -->
      <div class="tree-search-opts">
        <button
          class="opt-btn"
          :class="{ on: searchOpts.caseSensitive }"
          title="区分大小写"
          @click="toggleCase"
        >Aa</button>
        <button
          class="opt-btn"
          :class="{ on: searchOpts.wholeWord }"
          title="全词匹配 (\b)"
          @click="toggleWord"
        >\b</button>
        <button
          class="opt-btn"
          :class="{ on: searchOpts.useRegex }"
          title="正则表达式"
          @click="toggleRegex"
        >.*</button>
        <button
          v-if="searchQuery"
          class="opt-btn opt-clear"
          title="清空"
          @click="searchQuery = ''"
        >×</button>
      </div>
    </div>
    <!-- #A v2: 全库目录命中面板. 搜索激活时自动出现; 后台静默 build 索引,
         不提示用户操作. 没有命中也显示 (区分 "没结果" vs "还在 build"). -->
    <div v-if="searchVisible && searchQuery" class="catalog-hits">
      <div class="catalog-bar">
        <span v-if="globalHits.length > 0" class="catalog-title">
          📚 命中 {{ globalHits.length }}{{ globalHits.length >= 200 ? '+' : '' }}
          <span class="catalog-sub">· 已索引 {{ indexedTotal }} 个对象</span>
        </span>
        <span v-else-if="isAnyIndexBuilding" class="catalog-title catalog-empty">
          📚 索引构建中... ({{ buildingIndexes.size }} 个连接)
        </span>
        <span v-else-if="indexedTotal > 0" class="catalog-title catalog-empty">
          📚 无匹配
          <span class="catalog-sub">· 已搜过 {{ indexedTotal }} 个对象</span>
        </span>
        <span v-else class="catalog-title catalog-empty">📚 索引尚未建立</span>
        <span v-if="isAnyIndexBuilding && globalHits.length > 0" class="catalog-dot" title="后台还有连接在建索引">●</span>
      </div>
      <!-- kind 过滤 pill 行 — 只显示 rawHits 里有的 kind, 0 count 隐藏避免噪声 -->
      <div v-if="rawHits.length > 0" class="catalog-kinds">
        <button
          v-for="k in ALL_INDEX_KINDS"
          v-show="kindCounts[k] > 0"
          :key="k"
          class="kind-pill"
          :class="{ on: enabledKinds.has(k) }"
          :title="KIND_META[k].label + ` (${kindCounts[k]})`"
          @click="toggleKind(k)"
        >
          {{ KIND_META[k].icon }} {{ kindCounts[k] }}
        </button>
      </div>
      <ul v-if="globalHits.length > 0" class="catalog-list">
        <li
          v-for="(h, hi) in globalHits"
          :key="hi + ':' + h.connId + ':' + h.kind + ':' + h.db + ':' + h.schema + ':' + h.name"
          class="catalog-row"
          :title="`${h.kind} · ${[h.db, h.schema, h.name].filter(Boolean).join('.')}`"
          @click="revealIndexHit(h)"
        >
          <span class="catalog-kind">{{
            h.kind === 'table' ? '🗃' :
            h.kind === 'view' ? '👁' :
            h.kind === 'function' ? 'ƒ' :
            h.kind === 'procedure' ? '⚙' :
            h.kind === 'sequence' ? '#' :
            h.kind === 'trigger' ? '⚡' : '·'
          }}</span>
          <span class="catalog-name">{{ h.name }}</span>
          <span class="catalog-path">
            {{ [h.db, h.schema].filter(Boolean).join(' / ') }}
            <span class="catalog-conn">@ {{ roots.find((r) => r.id === h.connId)?.node.name ?? h.connId }}</span>
          </span>
        </li>
      </ul>
    </div>
    <div ref="treeBodyEl" class="tree-body" @contextmenu="onTreeBodyContextmenu">
      <div v-if="!roots.length" class="tree-status">{{ t('nav.empty') }}</div>

      <!-- Top drop rail: dragging here drops src to ungrouped, position 0.
           Lets a connection escape its current group + land at the very top
           of the visible list (#27 follow-up). Always rendered (no v-if /
           v-show) so the DOM doesn't shift at dragstart — an earlier
           v-if version had Chromium cancelling the drag because the rail
           appearing right after dragstart pushed the source element down
           by 18px mid-event.
           Invisible by default; pointer-events ignored unless actively
           in a connection drag so it never eats clicks. -->
      <div
        class="drop-rail"
        :class="{ 'drag-active': dragState?.kind === 'conn', 'drag-over': dragOverKey === 'rail:top' }"
        @dragover="onDragOver($event, 'rail:top')"
        @dragleave="onDragLeave('rail:top')"
        @drop="onConnDropToGroupTop(undefined)"
      ></div>

      <template v-for="(g, gi) in groupList" :key="'g:' + g.name">
        <!-- 分组行:整组拖拽 + 接收连接 drop.
             连接拖拽时按光标 Y 坐标分流(替代过去的 drop-rail-tail,消除分组下方
             空白): 上半行 → 落到上一个分组(prev); 下半行 → 落到本组. 首组无 prev,
             整行都归本组. 分组拖拽时不分流, 整行还是 group-reorder 语义. -->
        <div
          class="group-row"
          :class="{
            'drag-over': dragState?.kind === 'group' && dragOverKey === 'g:' + g.name,
            'drag-over-top':
              dragState?.kind === 'conn' &&
              gi > 0 &&
              dragOverKey === 'tail:g:' + groupList[gi - 1].name,
            'drag-over-bottom': dragState?.kind === 'conn' && dragOverKey === 'g:' + g.name,
            dragging: dragState?.kind === 'group' && dragState.id === g.name,
          }"
          draggable="true"
          @click="toggleGroup(g.name)"
          @contextmenu="onGroupContextmenu($event, g.name)"
          @dragstart="onGroupDragStart($event, g.name)"
          @dragover="onGroupRowDragOver($event, g.name, gi > 0 ? groupList[gi - 1].name : undefined)"
          @dragleave="onGroupRowDragLeave(g.name, gi > 0 ? groupList[gi - 1].name : undefined)"
          @drop="onGroupRowDrop(g.name, gi > 0 ? groupList[gi - 1].name : undefined)"
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

      <!-- Bottom drop rail: dragging here drops src to ungrouped, last position.
           Same always-rendered shape as the top rail — see comment there. -->
      <div
        class="drop-rail drop-rail-bottom"
        :class="{ 'drag-active': dragState?.kind === 'conn', 'drag-over': dragOverKey === 'rail:bottom' }"
        @dragover="onDragOver($event, 'rail:bottom')"
        @dragleave="onDragLeave('rail:bottom')"
        @drop="onConnDropToGroup(undefined)"
      ></div>
    </div>

    <!-- Multi-select status footer: 只显示计数 + 清空,
         所有批量操作通过"右键已选中的节点 → 批量菜单"触发, 跟单节点菜单一致. -->
    <div v-if="multiSel.size || multiSelConn.size" class="bulk-status">
      <span class="bcount">{{ t('bulk.selected', { n: multiSel.size || multiSelConn.size }) }}{{ multiSelConn.size ? ' (连接)' : '' }}</span>
      <span class="bulk-hint">右键选中项 → 批量操作</span>
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
  /* #17: 宽度由 :root 上的 --nav-width 驱动, Workspace 的 .nav-resizer
     拖动期间直接改这个变量, settings.navWidth 兜底持久化. 300px 是历史值,
     新装/老用户都不变. */
  width: var(--nav-width, 300px);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--panel);
}
/* #A 搜索栏 — 平时隐藏 (v-show), 显示时贴在 tree-head 和 tree-body 之间 */
.tree-search-wrap {
  position: relative;
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.tree-search {
  width: 100%;
  padding: 5px 26px 5px 10px;
  font-size: 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
  box-sizing: border-box;
}
.tree-search:focus {
  border-color: var(--accent, #7c6cff);
}
/* VSCode 风格搜索选项按钮组 — 横排紧贴 input 右侧 */
.tree-search-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tree-search {
  flex: 1;
  padding-right: 8px;
}
.tree-search-opts {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.opt-btn {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 3px 4px;
  font-family: var(--font-mono, ui-monospace, monospace);
  min-width: 20px;
  text-align: center;
}
.opt-btn:hover {
  background: rgba(124, 108, 255, 0.12);
  color: var(--text);
}
.opt-btn.on {
  background: rgba(124, 108, 255, 0.18);
  color: var(--accent, #7c6cff);
  border-color: rgba(124, 108, 255, 0.4);
}
.opt-clear {
  font-size: 14px;
  color: var(--muted);
  min-width: 16px;
}

/* #A v2 全库目录命中面板 — 贴在 tree-body 上方, 控制高度别撑爆树 */
.catalog-hits {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  max-height: 240px;
  display: flex;
  flex-direction: column;
}
.catalog-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--panel);
}
.catalog-title {
  color: var(--muted);
}
.catalog-title.catalog-empty {
  color: var(--muted);
  font-style: italic;
}
.catalog-sub {
  color: var(--muted);
  font-style: normal;
  font-size: 10px;
  margin-left: 4px;
}
/* 后台索引中的静默小点 — 紫色脉动, 不抢操作 */
.catalog-dot {
  color: var(--accent, #7c6cff);
  font-size: 8px;
  animation: catalog-pulse 1.2s ease-in-out infinite;
}
@keyframes catalog-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
/* #A v2 kind 过滤 pill 行 — 紧凑横排, 点 toggle 启用/排除某类对象命中 */
.catalog-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 10px 6px;
  background: var(--panel);
  border-top: 1px dashed var(--border);
}
.kind-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  line-height: 1.2;
  padding: 2px 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.kind-pill:hover {
  border-color: var(--accent, #7c6cff);
}
.kind-pill.on {
  background: rgba(124, 108, 255, 0.14);
  border-color: var(--accent, #7c6cff);
  color: var(--accent, #7c6cff);
}
.catalog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}
.catalog-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.catalog-row:hover {
  background: rgba(124, 108, 255, 0.12);
}
.catalog-kind {
  width: 14px;
  text-align: center;
  flex: none;
  color: var(--muted);
  font-size: 11px;
}
.catalog-name {
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}
.catalog-path {
  flex: 1;
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
}
.catalog-conn {
  color: var(--accent, #7c6cff);
  margin-left: 4px;
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
  flex: none;
  color: var(--muted);
  /* Inherit .group-row's 13px font-size so this matches the tree-node caret
     inside connections (TreeItem also lets its caret inherit). Was 10px
     and looked visibly smaller than the connection-level expand arrows. */
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
/* Top / bottom drop rails — always present and stable height so DOM doesn't
   shift at dragstart (earlier v-if version silently cancelled Chromium's drag
   because the rail appearing between dragstart and first dragover pushed the
   source element down by 18px mid-drag).

   Visible footprint kept to ~0 via negative margins that pull each rail to
   overlap its neighbour:
     - .drop-rail (top): margin-top: -8px → overlaps bottom 8px of tree-head
     - .drop-rail-bottom: margin-top: -8px → overlaps bottom of last item
   At rest both are transparent + pointer-events: none, so they don't show
   and don't swallow clicks. During an active connection drag pointer-events
   turns auto, the dashed outline appears, and dragover fills purple to
   preview the drop target. Height 8px is enough to be grabbable. */
.drop-rail {
  height: 8px;
  margin: -8px 4px 0;
  border-radius: 3px;
  outline: 1px dashed transparent;
  pointer-events: none;
  position: relative;
  z-index: 1;
}
.drop-rail.drag-active {
  pointer-events: auto;
}
.drop-rail.drag-over {
  background: rgba(124, 108, 255, 0.18);
  outline-color: var(--accent, #7c6cff);
}
.drop-rail-bottom {
  /* 同样负 top margin 把视觉占位归零, 覆盖在最后一个连接/分组的底 8px */
  margin: -8px 4px 0;
}
/* Per-group tail rail was removed — its drop-catch responsibility moved
   into group-row's @dragover via Y-split (see onGroupRowDragOver). Frees
   ~15px of visible whitespace that used to sit under each group. */
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
.group-row.drag-over,
.group-row.drag-over-top {
  /* 顶部一道粗紫色边 + 背景高亮表示"会插到这里之前", 用户清楚 drop target.
     drag-over-top: 连接 Y-split 命中上半 → 落到上一个分组 (=在本分组之前). */
  box-shadow: inset 0 3px 0 0 var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.08);
}
.group-row.drag-over-bottom {
  /* 底部一道紫色边 + 背景 — 连接 Y-split 命中下半: 落到本分组(作为本组的连接). */
  box-shadow: inset 0 -3px 0 0 var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.08);
}
/* Multi-select 状态条 — 只显示计数 + 清空, 没有操作按钮. 操作走右键菜单. */
.bulk-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
}
.bulk-status .bcount {
  color: var(--accent, #7c6cff);
  font-weight: 600;
}
.bulk-status .bulk-hint {
  color: var(--muted);
  flex: 1;
  font-size: 11px;
}
.bulk-status .ghost {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  padding: 0 6px;
}
.bulk-status .ghost:hover {
  color: var(--text);
}
</style>
