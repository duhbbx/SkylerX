<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { useDataClient } from './data-client'
import CommandPalette, { type PaletteItem } from './components/CommandPalette.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import DataTransferDialog from './components/DataTransferDialog.vue'
import ExportOptionsDialog from './components/ExportOptionsDialog.vue'
import ImportDialog from './components/ImportDialog.vue'
import Modal from './components/Modal.vue'
import NavTree from './components/NavTree.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import QueryTabs from './components/QueryTabs.vue'
import type { TreeNode } from './components/treeNode'
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { buildTableDump } from './dump'
import {
  type ObjectKind,
  type SqlTemplateKind,
  type TableContext,
  buildDrop,
  buildSqlTemplate,
  definitionQuery,
  deriveContext,
  dropSupportsCascade,
  erdContext,
  extractDefinition,
  objectKindLabel,
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

async function onNewQuery(id: string): Promise<void> {
  const conn = await client.connections.get(id)
  tabsRef.value?.newQuery(conn)
}

async function onRunSql(connId: string, sql: string): Promise<void> {
  const conn = await client.connections.get(connId)
  tabsRef.value?.runSql(conn, sql)
}

async function onDeleteConn(id: string): Promise<void> {
  if (!window.confirm('确定删除该连接？')) return
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
    window.alert('该对象暂不支持查看定义')
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
      window.alert('未取到定义')
      return
    }
    tabsRef.value?.openDraft(conn, extractDefinition(conn.dialect, node, f.mode, row), `${node.name} · 定义`)
  } catch (e) {
    window.alert(`查看定义失败：${e instanceof Error ? e.message : String(e)}`)
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
    window.alert(`生成 SQL 失败：${e instanceof Error ? e.message : String(e)}`)
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
    window.alert('文件接口未就绪：请完整重启应用（preload 更新需重启，非热更新）。')
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
    window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`)
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
      window.alert('该库/schema 下没有表')
      return
    }
    const parts: string[] = []
    for (const t of tables) {
      const cols = await client.connections.metadata(connId, {
        parentKind: MetaNodeKind.Group,
        path: [...t.path],
        group: 'columns',
      })
      const ref = t.sqlName ?? t.name
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
      content: `-- SkylerX 库导出：${label}（${tables.length} 表）\n\n${parts.join('\n\n')}`,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    })
  } catch (e) {
    window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// 数据传输 → 弹对话框
async function onTransferData(connId: string, node: TreeNode): Promise<void> {
  const conn = await client.connections.get(connId)
  transferring.value = { connId, node, dialect: conn.dialect, ctx: deriveContext(conn.dialect, node) }
}
function onTransferDone(count: number): void {
  transferring.value = null
  window.alert(`数据传输完成：${count} 行`)
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
  const conn = await client.connections.get(connId)
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

// ── ⌘K 命令面板 ──
const paletteOpen = ref(false)
const paletteConns = ref<ConnectionConfig[]>([])

const paletteItems = computed<PaletteItem[]>(() => [
  { id: 'act:new-conn', label: '新建连接', group: '操作' },
  { id: 'act:settings', label: '设置', group: '操作' },
  { id: 'act:export-conns', label: '导出连接配置', group: '操作' },
  { id: 'act:import-conns', label: '导入连接配置', group: '操作' },
  { id: 'act:refresh', label: '刷新导航树', group: '操作' },
  ...paletteConns.value.map((c) => ({
    id: `conn:${c.id}`,
    label: c.name || '(未命名)',
    hint: c.dialect,
    group: '连接',
  })),
])

async function openPalette(): Promise<void> {
  paletteConns.value = await client.connections.list()
  paletteOpen.value = true
}

async function onPaletteSelect(item: PaletteItem): Promise<void> {
  paletteOpen.value = false
  if (item.id === 'act:new-conn') onNew()
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
    window.alert(`导入 ${n} 个连接（密码未含，请逐个补填）`)
  } catch (e) {
    window.alert(`导入失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (paletteOpen.value) paletteOpen.value = false
    else void openPalette()
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

  <Modal v-if="bulkDropState" title="批量删除确认" @close="bulkDropState = null">
    <div class="confirm">
      <p>
        确定删除以下 <b>{{ bulkDropState.items.length }}</b> 个对象吗？此操作不可撤销。
      </p>
      <ul class="bulk-list">
        <li v-for="(it, i) in bulkDropState.items" :key="i" :class="{ gone: i < bulkDropState.done }">
          {{ objectKindLabel(it.node.kind) }} · {{ it.node.sqlName ?? it.node.name }}
        </li>
      </ul>
      <label class="cascade">
        <input v-model="bulkDropState.cascade" type="checkbox" />
        级联删除（CASCADE，对支持的对象连同依赖一并删除）
      </label>
      <div v-if="bulkDropState.error" class="banner err">
        ✗ 已删除 {{ bulkDropState.done }}/{{ bulkDropState.items.length }}，中断于：{{ bulkDropState.error }}
      </div>
      <div class="actions">
        <button class="danger" :disabled="bulkDropState.busy" @click="confirmBulkDrop">
          {{
            bulkDropState.busy
              ? `删除中… ${bulkDropState.done}/${bulkDropState.items.length}`
              : bulkDropState.error
                ? '继续删除'
                : `删除 ${bulkDropState.items.length} 项`
          }}
        </button>
        <button class="ghost" @click="bulkDropState = null">取消</button>
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
    :title="exportReq.scope === 'schema' ? `导出库 ${exportReq.node.name} 为 SQL` : `导出表 ${exportReq.node.name} 为 SQL`"
    @pick="onExportPick"
    @close="exportReq = null"
  />

  <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
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
</style>

