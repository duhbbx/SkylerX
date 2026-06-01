<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  DbDialect,
  DbKind,
  type QueryResult,
  dialectKind,
} from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { OBJECT_LABEL, type ObjectKind, type TableContext } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { t as tr } from '../i18n'
import DdlEditor from './DdlEditor.vue'
import DialectIcon from './DialectIcon.vue'
import ElasticPane from './ElasticPane.vue'
import ErdView from './ErdView.vue'
import MongoPane from './MongoPane.vue'
import QueryPane from './QueryPane.vue'
import RedisPane from './RedisPane.vue'
import TableDesigner from './TableDesigner.vue'
import TableStructure from './TableStructure.vue'
import type { TreeNode } from './treeNode'

interface Tab {
  id: number
  kind: 'query' | 'structure' | 'erd' | ObjectKind | 'mongoCollection' | 'redisDb' | 'esIndex'
  conn: ConnectionConfig
  title: string
  pending: { sql: string; seq: number } | null // query
  ctx?: TableContext // designer
  refreshTarget?: TreeNode // designer：成功后刷新的树节点
  node?: TreeNode // structure：要查看的表/视图节点；table designer：改表时载入用
  mode?: 'create' | 'alter' | 'edit' // table designer：新建/改表；DDL 编辑器：新建/编辑
  draft?: string // query：初始草稿 SQL（只填入不执行，如「查看定义」）
  pinned?: boolean // 固定标签：排在最前，不显示关闭按钮（双击切换）
  /** NoSQL：Mongo 集合 tab 的库/集合 */
  mongo?: { database: string; collection: string }
  /** NoSQL：Redis tab 的逻辑库索引 + 可选待选中 key(外部双击触发) */
  redis?: { dbIndex: number; pendingKey?: string | null }
  /** NoSQL：Elasticsearch index tab */
  es?: { index: string }
}

const emit = defineEmits<{
  connError: [string, string]
  refresh: [TreeNode, string]
  ai: [string, string, string]
  askAiAboutError: [payload: { connId: string; connName?: string; sql: string; error: string }]
  searchValue: [payload: { connId: string; value: string }]
  /** #B 打开结果集图表 viewer */
  openChart: [result: QueryResult]
  // Redis 顶栏入口转发给 Workspace
  redisOpenSearch: [conn: ConnectionConfig]
  redisOpenImport: [conn: ConnectionConfig, dbIndex: number]
  redisOpenExport: [conn: ConnectionConfig, dbIndex: number]
  redisOpenServerInfo: [conn: ConnectionConfig]
  redisOpenBigKeys: [conn: ConnectionConfig, dbIndex: number]
  redisOpenScript: [conn: ConnectionConfig, dbIndex: number]
  redisOpenMonitor: [conn: ConnectionConfig]
  // Mongo 顶栏入口
  mongoOpenInfo: [conn: ConnectionConfig, database: string, collection: string]
  mongoOpenAgg: [conn: ConnectionConfig, database: string, collection: string]
}>()

const tabs = ref<Tab[]>([])
const activeId = ref(0)
let tabSeq = 0
let pendSeq = 0

const active = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)

// 固定标签排在最前（组内保持插入顺序）
const orderedTabs = computed(() => [
  ...tabs.value.filter((t) => t.pinned),
  ...tabs.value.filter((t) => !t.pinned),
])

function togglePin(id: number): void {
  const tab = tabs.value.find((t) => t.id === id)
  if (tab) tab.pinned = !tab.pinned
}

function push(tab: Omit<Tab, 'id'>): void {
  const id = ++tabSeq
  tabs.value.push({ ...tab, id })
  activeId.value = id
}

// ── 查询页 ──
function openConnection(conn: ConnectionConfig): void {
  // NoSQL 没有"SQL 查询页":
  //   - Redis  → 默认开 db0 的 key 浏览器
  //   - Mongo  → 没有"默认集合",提示用户从树里展开选 collection
  //   - ES     → 同上,提示选 index
  if (dialectKind(conn.dialect) === DbKind.NoSql) {
    if (conn.dialect === DbDialect.Redis) {
      openRedisDb(conn, 0)
      return
    }
    const hint =
      conn.dialect === DbDialect.MongoDB
        ? '请在左侧展开连接,双击 collection 打开数据浏览器'
        : conn.dialect === DbDialect.Elasticsearch
          ? '请在左侧展开连接,双击 index 打开数据浏览器'
          : '该方言不支持 SQL 查询页'
    toast.warn(hint)
    return
  }
  const existing = tabs.value.find((t) => t.kind === 'query' && t.conn.id === conn.id)
  if (existing) activeId.value = existing.id
  else
    push({
      kind: 'query',
      conn,
      title: `${conn.name || conn.dialect} #${tabSeq + 1}`,
      pending: null,
    })
}
/** NoSQL(Redis/Mongo/ES)不能开 SQL 查询页;路由到对应 Pane 或提示。 */
function isNoSqlConn(conn: ConnectionConfig): boolean {
  return dialectKind(conn.dialect) === DbKind.NoSql
}

function newQuery(conn: ConnectionConfig, ctx?: TableContext): void {
  // NoSQL 连接:不开 SQL Tab,直接走对应 Pane
  if (isNoSqlConn(conn)) {
    openConnection(conn)
    return
  }
  push({
    kind: 'query',
    conn,
    title: `${conn.name || conn.dialect} #${tabSeq + 1}`,
    pending: null,
    ctx,
  })
}
function runSql(conn: ConnectionConfig, sql: string): void {
  if (isNoSqlConn(conn)) {
    toast.warn('NoSQL 连接不支持执行 SQL,请用 ⚙ 服务器 → CONFIG / RedisPane 命令输入框')
    return
  }
  const cur = active.value
  if (cur && cur.kind === 'query' && cur.conn.id === conn.id) cur.pending = { sql, seq: ++pendSeq }
  else
    push({
      kind: 'query',
      conn,
      title: `${conn.name || conn.dialect} #${tabSeq + 1}`,
      pending: { sql, seq: ++pendSeq },
    })
}
function newForCurrent(): void {
  if (active.value) newQuery(active.value.conn)
}

/** 打开一个带初始 SQL 的查询页(不执行,如"查看定义")。NoSQL 连接拦截 */
function openDraft(conn: ConnectionConfig, sql: string, title: string): void {
  if (isNoSqlConn(conn)) {
    toast.warn('NoSQL 连接不支持 SQL 草稿页')
    return
  }
  push({ kind: 'query', conn, title, pending: null, draft: sql })
}

// ── 新建对象设计器页（表 / 视图 / 函数 / 存储过程）──
function newObject(
  conn: ConnectionConfig,
  kind: ObjectKind,
  ctx: TableContext,
  refreshTarget: TreeNode,
): void {
  push({
    kind,
    conn,
    title: `${OBJECT_LABEL[kind]} @ ${conn.name || conn.dialect}`,
    pending: null,
    ctx,
    refreshTarget,
  })
}

/** 打开表/视图结构查看页（已有则聚焦）。 */
function openStructure(conn: ConnectionConfig, node: TreeNode): void {
  const key = node.sqlName ?? node.name
  const existing = tabs.value.find(
    (t) => t.kind === 'structure' && (t.node?.sqlName ?? t.node?.name) === key,
  )
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({
    kind: 'structure',
    conn,
    title: tr('tabs.titleStructure', { name: node.name }),
    pending: null,
    node,
  })
}

/** 打开 ER 图页（按库/schema）。 */
function openErd(conn: ConnectionConfig, ctx: TableContext, node: TreeNode): void {
  const label = ctx.schema || ctx.database || node.name
  const existing = tabs.value.find((t) => t.kind === 'erd' && t.title === `ER · ${label}`)
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({ kind: 'erd', conn, title: `ER · ${label}`, pending: null, ctx })
}

/** 打开 Mongo 集合浏览器页（同库.集合已开则聚焦）。 */
function openMongoCollection(conn: ConnectionConfig, database: string, collection: string): void {
  const existing = tabs.value.find(
    (t) =>
      t.kind === 'mongoCollection' &&
      t.conn.id === conn.id &&
      t.mongo?.database === database &&
      t.mongo?.collection === collection,
  )
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({
    kind: 'mongoCollection',
    conn,
    title: `${database}.${collection}`,
    pending: null,
    mongo: { database, collection },
  })
}

/** 打开 Elasticsearch index 浏览器页（同连接.index 已开则聚焦）。 */
function openEsIndex(conn: ConnectionConfig, index: string): void {
  const existing = tabs.value.find(
    (t) => t.kind === 'esIndex' && t.conn.id === conn.id && t.es?.index === index,
  )
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({
    kind: 'esIndex',
    conn,
    title: `${conn.name || conn.dialect} · ${index}`,
    pending: null,
    es: { index },
  })
}

/**
 * 打开 Redis 逻辑库页(同连接.dbIndex 已开则聚焦)。
 * 传 pendingKey 时,RedisPane 内部会自动选中并展示该 key 的值。
 */
function openRedisDb(conn: ConnectionConfig, dbIndex: number, pendingKey?: string): void {
  const existing = tabs.value.find(
    (t) => t.kind === 'redisDb' && t.conn.id === conn.id && t.redis?.dbIndex === dbIndex,
  )
  if (existing) {
    activeId.value = existing.id
    // 已有 tab 也要把 pendingKey 顶上去触发 RedisPane 重新选中
    if (existing.redis) existing.redis = { dbIndex, pendingKey: pendingKey ?? null }
    return
  }
  push({
    kind: 'redisDb',
    conn,
    title: `${conn.name || conn.dialect} · db${dbIndex}`,
    pending: null,
    redis: { dbIndex, pendingKey: pendingKey ?? null },
  })
}

/**
 * #19: link-only focus — if a redisDb tab for (connId, dbIndex) already exists,
 * activate it and push pendingKey to select that key in the pane.
 * Returns true if focused, false if no matching tab is open. Does NOT create
 * a new tab (that's openRedisDb's job, called from the double-click path).
 * Used by NavTree's single-click handler so users can scan keys in the tree
 * and the open Redis tab follows along, without spawning tabs on every click.
 */
function focusRedisDb(connId: string, dbIndex: number, pendingKey: string): boolean {
  const existing = tabs.value.find(
    (t) => t.kind === 'redisDb' && t.conn.id === connId && t.redis?.dbIndex === dbIndex,
  )
  if (!existing) return false
  activeId.value = existing.id
  if (existing.redis) existing.redis = { dbIndex, pendingKey }
  return true
}

/** 打开「编辑视图/函数/过程」页（DDL 编辑器 edit 模式）。 */
function editObject(
  conn: ConnectionConfig,
  kind: ObjectKind,
  ctx: TableContext,
  node: TreeNode,
): void {
  push({
    kind,
    mode: 'edit',
    conn,
    title: tr('tabs.titleEdit', { name: node.name }),
    pending: null,
    ctx,
    node,
    refreshTarget: node.parent ?? node,
  })
}

/** 打开「设计表 / 改表」页（alter 模式，已有则聚焦）。 */
function editTable(conn: ConnectionConfig, ctx: TableContext, node: TreeNode): void {
  const key = node.sqlName ?? node.name
  const existing = tabs.value.find(
    (t) => t.kind === 'table' && t.mode === 'alter' && (t.node?.sqlName ?? t.node?.name) === key,
  )
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({
    kind: 'table',
    mode: 'alter',
    conn,
    title: tr('tabs.titleDesign', { name: node.name }),
    pending: null,
    ctx,
    node,
    refreshTarget: node.parent ?? node,
  })
}

/**
 * 关闭 tab 之前的脏检查：表设计器 / DDL 编辑器 tab 都对外 expose 了 isDirty()，
 * 若有未保存改动，先弹 confirm（同连接表单/设置弹窗的一致体验）。
 */
interface TabRefShape {
  isDirty?: () => boolean
  /** QueryPane 暴露：未提交事务 flush 用 */
  flushSession?: (decision: 'commit' | 'rollback') => Promise<void>
}
const dirtyRefs = new Map<number, TabRefShape>()
function setDirtyRef(id: number, el: unknown): void {
  if (el && typeof (el as TabRefShape).isDirty === 'function') {
    dirtyRefs.set(id, el as TabRefShape)
  } else {
    dirtyRefs.delete(id)
  }
}
async function close(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return
  const ref = dirtyRefs.get(id)
  if (tab.kind === 'query') {
    // 手动提交模式下 QueryPane 暴露 isDirty + flushSession：让用户选「提交 / 回滚 / 取消关闭」
    if (ref?.isDirty?.() && ref.flushSession) {
      // 三选一：提交 / 回滚 / 取消（取消用户用 Esc 即可，confirm 只给"提交/回滚"两选项）
      const doCommit = await appConfirm({
        title: tr('commit.closePendingTitle'),
        message: tr('commit.closePending'),
        confirmText: tr('commit.commit'),
        cancelText: tr('commit.rollback'),
        variant: 'warn',
      })
      try {
        await ref.flushSession(doCommit ? 'commit' : 'rollback')
      } catch {
        /* flush 失败也仍允许关 tab；endSession 会兜底 ROLLBACK */
      }
    }
  } else {
    // 设计器 / DDL 编辑器：原有的「未保存改动」拦截
    const checkable =
      tab.kind === 'table' ||
      tab.kind === 'view' ||
      tab.kind === 'function' ||
      tab.kind === 'procedure' ||
      tab.kind === 'trigger'
    if (checkable && ref?.isDirty?.()) {
      if (!(await appConfirm({ message: tr('common.unsavedConfirm'), variant: 'warn' }))) return
    }
  }
  const i = tabs.value.findIndex((t) => t.id === id)
  if (i < 0) return
  dirtyRefs.delete(id)
  tabs.value.splice(i, 1)
  if (activeId.value === id) activeId.value = tabs.value[Math.max(0, i - 1)]?.id ?? 0
}

function closeConnTabs(connId: string): void {
  tabs.value = tabs.value.filter((t) => t.conn.id !== connId)
  if (!tabs.value.some((t) => t.id === activeId.value)) activeId.value = tabs.value[0]?.id ?? 0
}

/**
 * 设计器/DDL 编辑器保存成功的统一回调。
 *
 * `keepOpen=true`(TableDesigner 新建保存): 不关 tab,内部已切到 alter 模式,
 *   只刷新树即可,让用户继续在同一 tab 改这个新表。
 * `keepOpen=false`(改表 / DDL 编辑器保存等): 沿用旧行为,关掉 tab。
 */
function onCreated(tab: Tab, opts?: { keepOpen?: boolean }): void {
  if (tab.refreshTarget) emit('refresh', tab.refreshTarget, tab.conn.id)
  if (!opts?.keepOpen) close(tab.id)
}

/** 暴露给父组件用：当前激活 tab 的连接 id（用于右侧 AI 聊天默认连接跟随）；computed 自带响应式 */
const activeConnId = computed(() => active.value?.conn.id ?? '')

/** K1：关当前活跃 tab（菜单 / 快捷键 close-tab 触发） */
function closeActive(): void {
  if (activeId.value) void close(activeId.value)
}

defineExpose({
  openConnection,
  newQuery,
  runSql,
  newForCurrent,
  newObject,
  openStructure,
  editTable,
  editObject,
  openErd,
  openDraft,
  openMongoCollection,
  openRedisDb,
  focusRedisDb,
  openEsIndex,
  closeConnTabs,
  closeActive,
  activeConnId,
})

// ── 布局持久化：仅记录查询页（connId + pinned），下次启动自动重开 ──
const LAYOUT_KEY = 'skylerx.workspace.tabs'
interface SavedTab {
  connId: string
  pinned?: boolean
}
const client = useDataClient()
let restored = false

function saveLayout(): void {
  if (!restored) return
  const items: SavedTab[] = tabs.value
    .filter((t) => t.kind === 'query')
    .map((t) => ({ connId: t.conn.id, pinned: t.pinned }))
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(items))
  } catch {
    /* 忽略 */
  }
}

async function restoreLayout(): Promise<void> {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return
    const items = JSON.parse(raw) as SavedTab[]
    for (const it of items) {
      try {
        const conn = await client.connections.get(it.connId)
        push({
          kind: 'query',
          conn,
          title: `${conn.name || conn.dialect} #${tabSeq + 1}`,
          pending: null,
          pinned: it.pinned,
        })
      } catch {
        /* 连接已删除 → 跳过 */
      }
    }
  } catch {
    /* 忽略损坏的布局 */
  } finally {
    restored = true
  }
}

onMounted(restoreLayout)
watch(tabs, saveLayout, { deep: true })
</script>

<template>
  <div class="qtabs">
    <div v-if="!tabs.length" class="placeholder">
      {{ tr('tabs.empty') }}
    </div>
    <template v-else>
      <div class="qtab-bar">
        <div
          v-for="t in orderedTabs"
          :key="t.id"
          class="qtab"
          :class="{ active: t.id === activeId, pinned: t.pinned }"
          :title="tr('tabs.pinHint')"
          @click="activeId = t.id"
          @dblclick="togglePin(t.id)"
        >
          <span v-if="t.pinned" class="t-pin">📌</span>
          <!-- 数据库品牌 logo：用户切换 tab 时一眼分清是哪个 dialect -->
          <DialectIcon :dialect="t.conn.dialect" :size="13" class="t-dialect" />
          <span class="t-title">{{ t.title }}</span>
          <button
            class="t-act"
            :title="t.pinned ? tr('tabs.unpin') : tr('tabs.pin')"
            @click.stop="togglePin(t.id)"
          >{{ t.pinned ? '⇲' : '⇱' }}</button>
          <button v-if="!t.pinned" class="t-close" :title="tr('common.close')" @click.stop="close(t.id)">×</button>
        </div>
        <button class="qtab-add" :title="tr('tabs.newQuery')" @click="newForCurrent">＋</button>
      </div>
      <div class="qtab-body">
        <div v-for="t in tabs" v-show="t.id === activeId" :key="t.id" class="pane-wrap">
          <QueryPane
            v-if="t.kind === 'query'"
            :conn="t.conn"
            :pending="t.pending"
            :initial-sql="t.draft"
            :initial-ctx="t.ctx"
            :ref="(el) => setDirtyRef(t.id, el)"
            @conn-error="(id, msg) => emit('connError', id, msg)"
            @ai="(sql, cid, errMsg) => emit('ai', sql, cid, errMsg)"
            @new-draft="(sql, title) => openDraft(t.conn, sql, title)"
            @ask-ai-about-error="(p) => emit('askAiAboutError', p)"
            @search-value="(p) => emit('searchValue', p)"
            @open-chart="(r) => emit('openChart', r)"
          />
          <MongoPane
            v-else-if="t.kind === 'mongoCollection' && t.mongo"
            :conn="t.conn"
            :database="t.mongo.database"
            :collection="t.mongo.collection"
            @open-info="emit('mongoOpenInfo', t.conn, t.mongo.database, t.mongo.collection)"
            @open-agg="emit('mongoOpenAgg', t.conn, t.mongo.database, t.mongo.collection)"
          />
          <RedisPane
            v-else-if="t.kind === 'redisDb' && t.redis"
            :conn="t.conn"
            :db-index="t.redis.dbIndex"
            :pending-key="t.redis.pendingKey"
            @open-search="emit('redisOpenSearch', t.conn)"
            @open-import="emit('redisOpenImport', t.conn, t.redis.dbIndex)"
            @open-export="emit('redisOpenExport', t.conn, t.redis.dbIndex)"
            @open-server-info="emit('redisOpenServerInfo', t.conn)"
            @open-big-keys="emit('redisOpenBigKeys', t.conn, t.redis.dbIndex)"
            @open-script="emit('redisOpenScript', t.conn, t.redis.dbIndex)"
            @open-monitor="emit('redisOpenMonitor', t.conn)"
          />
          <ElasticPane
            v-else-if="t.kind === 'esIndex' && t.es"
            :conn="t.conn"
            :index="t.es.index"
          />
          <TableDesigner
            v-else-if="t.kind === 'table'"
            :ref="(el) => setDirtyRef(t.id, el)"
            :conn-id="t.conn.id"
            :dialect="t.conn.dialect"
            :ctx="t.ctx!"
            :mode="t.mode === 'alter' ? 'alter' : 'create'"
            :node="t.node"
            @created="(opts) => onCreated(t, opts)"
            @cancel="close(t.id)"
          />
          <TableStructure
            v-else-if="t.kind === 'structure'"
            :conn-id="t.conn.id"
            :node="t.node!"
            :dialect="t.conn.dialect"
          />
          <ErdView
            v-else-if="t.kind === 'erd'"
            :conn-id="t.conn.id"
            :dialect="t.conn.dialect"
            :ctx="t.ctx!"
          />
          <DdlEditor
            v-else
            :ref="(el) => setDirtyRef(t.id, el)"
            :conn-id="t.conn.id"
            :dialect="t.conn.dialect"
            :object-kind="(t.kind as ObjectKind)"
            :ctx="t.ctx!"
            :mode="t.mode === 'edit' ? 'edit' : 'create'"
            :node="t.node"
            @created="onCreated(t)"
            @cancel="close(t.id)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.qtabs {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.placeholder {
  margin: auto;
  color: var(--muted);
  font-size: 15px;
}
.qtab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.qtab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 7px 7px 0 0;
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.qtab.active {
  color: var(--text);
  box-shadow: inset 0 2px 0 var(--accent);
}
.t-pin {
  font-size: 10px;
  line-height: 1;
}
.t-dialect {
  flex: none;
  margin-right: 2px;
}
.t-act {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0;
}
.qtab:hover .t-act {
  opacity: 1;
}
.t-act:hover {
  color: var(--accent);
}
.t-close {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
.t-close:hover {
  color: var(--err);
}
.qtab-add {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 16px;
  padding: 0 8px;
}
.qtab-add:hover {
  color: var(--text);
}
.qtab-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.pane-wrap {
  position: absolute;
  inset: 0;
}
.designer-wrap {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 16px 18px;
}
</style>
