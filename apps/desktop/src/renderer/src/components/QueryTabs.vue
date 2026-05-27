<script setup lang="ts">
import type { ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { OBJECT_LABEL, type ObjectKind, type TableContext } from '../ddl'
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
}

const emit = defineEmits<{ connError: [string, string]; refresh: [TreeNode, string] }>()

const tabs = ref<Tab[]>([])
const activeId = ref(0)
let tabSeq = 0
let pendSeq = 0

const active = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null)

function push(tab: Omit<Tab, 'id'>): void {
  const id = ++tabSeq
  tabs.value.push({ ...tab, id })
  activeId.value = id
}

// ── 查询页 ──
function openConnection(conn: ConnectionConfig): void {
  const existing = tabs.value.find((t) => t.kind === 'query' && t.conn.id === conn.id)
  if (existing) activeId.value = existing.id
  else push({ kind: 'query', conn, title: `${conn.name || conn.dialect} #${tabSeq + 1}`, pending: null })
}
function newQuery(conn: ConnectionConfig): void {
  push({ kind: 'query', conn, title: `${conn.name || conn.dialect} #${tabSeq + 1}`, pending: null })
}
function runSql(conn: ConnectionConfig, sql: string): void {
  const cur = active.value
  if (cur && cur.kind === 'query' && cur.conn.id === conn.id) cur.pending = { sql, seq: ++pendSeq }
  else push({ kind: 'query', conn, title: `${conn.name || conn.dialect} #${tabSeq + 1}`, pending: { sql, seq: ++pendSeq } })
}
function newForCurrent(): void {
  if (active.value) newQuery(active.value.conn)
}

// ── 新建对象设计器页（表 / 视图 / 函数 / 存储过程）──
function newObject(
  conn: ConnectionConfig,
  kind: ObjectKind,
  ctx: TableContext,
  refreshTarget: TreeNode,
): void {
  push({ kind, conn, title: `${OBJECT_LABEL[kind]} @ ${conn.name || conn.dialect}`, pending: null, ctx, refreshTarget })
}

/** 打开表/视图结构查看页（已有则聚焦）。 */
function openStructure(conn: ConnectionConfig, node: TreeNode): void {
  const key = node.sqlName ?? node.name
  const existing = tabs.value.find((t) => t.kind === 'structure' && (t.node?.sqlName ?? t.node?.name) === key)
  if (existing) {
    activeId.value = existing.id
    return
  }
  push({ kind: 'structure', conn, title: `${node.name} · 结构`, pending: null, node })
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
function editObject(conn: ConnectionConfig, kind: ObjectKind, ctx: TableContext, node: TreeNode): void {
  push({
    kind,
    mode: 'edit',
    conn,
    title: `${node.name} · 编辑`,
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
    title: `${node.name} · 设计`,
    pending: null,
    ctx,
    node,
    refreshTarget: node.parent ?? node,
  })
}

function close(id: number): void {
  const i = tabs.value.findIndex((t) => t.id === id)
  if (i < 0) return
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

defineExpose({ openConnection, newQuery, runSql, newForCurrent, newObject, openStructure, editTable, editObject, openErd, closeConnTabs })
</script>

<template>
  <div class="qtabs">
    <div v-if="!tabs.length" class="placeholder">
      展开左侧连接，右键「新建查询 / 新建表…」或双击连接开始
    </div>
    <template v-else>
      <div class="qtab-bar">
        <div
          v-for="t in tabs"
          :key="t.id"
          class="qtab"
          :class="{ active: t.id === activeId }"
          @click="activeId = t.id"
        >
          <span class="t-title">{{ t.title }}</span>
          <button class="t-close" title="关闭" @click.stop="close(t.id)">×</button>
        </div>
        <button class="qtab-add" title="新建查询" @click="newForCurrent">＋</button>
      </div>
      <div class="qtab-body">
        <div v-for="t in tabs" v-show="t.id === activeId" :key="t.id" class="pane-wrap">
          <QueryPane
            v-if="t.kind === 'query'"
            :conn="t.conn"
            :pending="t.pending"
            @conn-error="(id, msg) => emit('connError', id, msg)"
          />
          <TableDesigner
            v-else-if="t.kind === 'table'"
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
          />
          <ErdView
            v-else-if="t.kind === 'erd'"
            :conn-id="t.conn.id"
            :dialect="t.conn.dialect"
            :ctx="t.ctx!"
          />
          <DdlEditor
            v-else
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
