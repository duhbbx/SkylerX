<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import ConnectionForm from './components/ConnectionForm.vue'
import ImportDialog from './components/ImportDialog.vue'
import Modal from './components/Modal.vue'
import NavTree from './components/NavTree.vue'
import QueryTabs from './components/QueryTabs.vue'
import type { TreeNode } from './components/treeNode'
import { type ConnectionConfig, type DbDialect } from '@db-tool/shared-types'
import {
  type ObjectKind,
  type TableContext,
  buildDrop,
  deriveContext,
  dropSupportsCascade,
  objectKindLabel,
  previewSql,
} from './ddl'

const navRef = useTemplateRef('navRef')
const tabsRef = useTemplateRef('tabsRef')

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

// CSV 导入对话框
const importing = ref<{ connId: string; node: TreeNode; dialect: DbDialect; ctx: TableContext } | null>(
  null,
)

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
  const conn = await window.api.connections.get(id)
  tabsRef.value?.openConnection(conn)
}

async function onNewQuery(id: string): Promise<void> {
  const conn = await window.api.connections.get(id)
  tabsRef.value?.newQuery(conn)
}

async function onRunSql(connId: string, sql: string): Promise<void> {
  const conn = await window.api.connections.get(connId)
  tabsRef.value?.runSql(conn, sql)
}

async function onDeleteConn(id: string): Promise<void> {
  if (!window.confirm('确定删除该连接？')) return
  await window.api.connections.remove(id)
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
  const conn = await window.api.connections.get(connId)
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
  const conn = await window.api.connections.get(connId)
  tabsRef.value?.openStructure(conn, node)
}

// 查询前 200 行 → 按方言生成限行 SQL 并在查询页执行
async function onPreviewTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await window.api.connections.get(connId)
  tabsRef.value?.runSql(conn, previewSql(conn.dialect, node.sqlName ?? node.name, 200))
}

// 设计表（修改现有表）→ 开设计器 Tab（alter 模式，载入现有结构）
async function onDesignTable(connId: string, node: TreeNode): Promise<void> {
  const conn = await window.api.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  tabsRef.value?.editTable(conn, ctx, node)
}

// 编辑视图/函数/存储过程 → 载入定义后开 DDL 编辑器 Tab
async function onEditObject(connId: string, node: TreeNode): Promise<void> {
  const conn = await window.api.connections.get(connId)
  const ctx = deriveContext(conn.dialect, node)
  tabsRef.value?.editObject(conn, node.kind as ObjectKind, ctx, node)
}

// 导入数据（CSV → 表）→ 弹导入对话框
async function onImportData(connId: string, node: TreeNode): Promise<void> {
  const conn = await window.api.connections.get(connId)
  importing.value = { connId, node, dialect: conn.dialect, ctx: deriveContext(conn.dialect, node) }
}

function onImportDone(count: number): void {
  const imp = importing.value
  importing.value = null
  if (imp) {
    navRef.value?.refreshNode(imp.node, imp.connId)
    window.alert(`已导入 ${count} 行到 ${imp.node.name}`)
  }
}

// 删除对象 → 弹二次确认
async function onDropObject(connId: string, node: TreeNode): Promise<void> {
  const conn = await window.api.connections.get(connId)
  if (!buildDrop(conn.dialect, node)) return // 不可删除的节点
  dropConfirm.value = {
    connId,
    node,
    dialect: conn.dialect,
    label: objectKindLabel(node.kind),
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
    await window.api.connections.execute(d.connId, r.sql, [], {
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
    @edit-object="onEditObject"
    @import-data="onImportData"
  />

  <main class="main">
    <QueryTabs ref="tabsRef" @conn-error="onConnError" @refresh="onTreeRefresh" />
  </main>

  <Modal
    v-if="editing"
    :title="editing.connId ? '编辑连接' : '新建连接'"
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

  <Modal v-if="dropConfirm" title="删除确认" @close="dropConfirm = null">
    <div class="confirm">
      <p>
        确定删除{{ dropConfirm.label }} <b>{{ dropConfirm.node.name }}</b> 吗？此操作不可撤销。
      </p>
      <label v-if="dropCascadeApplicable" class="cascade">
        <input v-model="dropConfirm.cascade" type="checkbox" />
        级联删除（CASCADE，连同依赖对象一并删除）
      </label>
      <pre class="confirm-sql">{{ dropResult?.sql }}</pre>
      <div v-if="dropConfirm.error" class="banner err">✗ {{ dropConfirm.error }}</div>
      <div class="actions">
        <button class="danger" :disabled="dropConfirm.busy" @click="confirmDrop">
          {{ dropConfirm.busy ? '删除中…' : '删除' }}
        </button>
        <button class="ghost" @click="dropConfirm = null">取消</button>
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
</style>

