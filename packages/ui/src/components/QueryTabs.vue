<script setup lang="ts">
import type { ConnectionConfig } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { OBJECT_LABEL, type ObjectKind, type TableContext } from '../ddl'
import { confirm as appConfirm } from '../dialog'
import { t as tr } from '../i18n'
import DdlEditor from './DdlEditor.vue'
import ErdView from './ErdView.vue'
import QueryPane from './QueryPane.vue'
import TableDesigner from './TableDesigner.vue'
import TableStructure from './TableStructure.vue'
import type { TreeNode } from './treeNode'

interface Tab {
  id: number
  kind: 'query' | 'structure' | 'erd' | ObjectKind
  conn: ConnectionConfig
  title: string
  pending: { sql: string; seq: number } | null // query
  ctx?: TableContext // designer
  refreshTarget?: TreeNode // designer：成功后刷新的树节点
  node?: TreeNode // structure：要查看的表/视图节点；table designer：改表时载入用
  mode?: 'create' | 'alter' | 'edit' // table designer：新建/改表；DDL 编辑器：新建/编辑
  draft?: string // query：初始草稿 SQL（只填入不执行，如「查看定义」）
  pinned?: boolean // 固定标签：排在最前，不显示关闭按钮（双击切换）
}

const emit = defineEmits<{
  connError: [string, string]
  refresh: [TreeNode, string]
  ai: [string, string, string]
  askAiAboutError: [payload: { connId: string; connName?: string; sql: string; error: string }]
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
function newQuery(conn: ConnectionConfig, ctx?: TableContext): void {
  push({
    kind: 'query',
    conn,
    title: `${conn.name || conn.dialect} #${tabSeq + 1}`,
    pending: null,
    ctx,
  })
}
function runSql(conn: ConnectionConfig, sql: string): void {
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

/** 打开一个带初始 SQL 的查询页（不执行，如「查看定义」）。 */
function openDraft(conn: ConnectionConfig, sql: string, title: string): void {
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
const dirtyRefs = new Map<number, { isDirty?: () => boolean }>()
function setDirtyRef(id: number, el: unknown): void {
  if (el && typeof (el as { isDirty?: unknown }).isDirty === 'function') {
    dirtyRefs.set(id, el as { isDirty: () => boolean })
  } else {
    dirtyRefs.delete(id)
  }
}
async function close(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id)
  if (!tab) return
  // 仅设计器 / DDL 编辑器需要检查；查询页/结构页/ER 图 无未保存概念，直接关
  const checkable =
    tab.kind === 'table' ||
    tab.kind === 'view' ||
    tab.kind === 'function' ||
    tab.kind === 'procedure' ||
    tab.kind === 'trigger'
  if (checkable && dirtyRefs.get(id)?.isDirty?.()) {
    if (!(await appConfirm({ message: tr('common.unsavedConfirm'), variant: 'warn' }))) return
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

function onCreated(tab: Tab): void {
  if (tab.refreshTarget) emit('refresh', tab.refreshTarget, tab.conn.id)
  close(tab.id)
}

/** 暴露给父组件用：当前激活 tab 的连接 id（用于右侧 AI 聊天默认连接跟随）；computed 自带响应式 */
const activeConnId = computed(() => active.value?.conn.id ?? '')

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
  closeConnTabs,
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
            @conn-error="(id, msg) => emit('connError', id, msg)"
            @ai="(sql, cid, errMsg) => emit('ai', sql, cid, errMsg)"
            @new-draft="(sql, title) => openDraft(t.conn, sql, title)"
            @ask-ai-about-error="(p) => emit('askAiAboutError', p)"
          />
          <TableDesigner
            v-else-if="t.kind === 'table'"
            :ref="(el) => setDirtyRef(t.id, el)"
            :conn-id="t.conn.id"
            :dialect="t.conn.dialect"
            :ctx="t.ctx!"
            :mode="t.mode === 'alter' ? 'alter' : 'create'"
            :node="t.node"
            @created="onCreated(t)"
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
            :object-kind="t.kind"
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
