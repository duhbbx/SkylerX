<script setup lang="ts">
import { type ConnectionConfig, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, provide, reactive, ref } from 'vue'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import ContextMenu from './ContextMenu.vue'
import TreeItem from './TreeItem.vue'
import { isConnectionError } from '../connError'
import type { ObjectKind, SqlTemplateKind } from '../ddl'
import { type TreeAction, actionsFor } from './tree-actions'
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
  runSql: [string, string]
  connError: [string, string]
  newObject: [ObjectKind, string, TreeNode]
  dropObject: [string, TreeNode]
  viewStructure: [string, TreeNode]
  designTable: [string, TreeNode]
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
  bulkDrop: [{ connId: string; node: TreeNode }[]]
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
}

const roots = ref<ConnRoot[]>([])
const expandedGroups = ref<Set<string>>(new Set())

// 按 group 聚合：有分组的归入文件夹，未分组的平铺
const groupList = computed(() => {
  const m = new Map<string, ConnRoot[]>()
  for (const r of roots.value) {
    if (!r.group) continue
    const arr = m.get(r.group)
    if (arr) arr.push(r)
    else m.set(r.group, [r])
  }
  return [...m.entries()].map(([name, conns]) => ({ name, conns }))
})
const ungrouped = computed(() => roots.value.filter((r) => !r.group))

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
  actions: TreeAction[]
  node: TreeNode | null
  connId: string
}>({ visible: false, x: 0, y: 0, actions: [], node: null, connId: '' })

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
    }
  },
  openContextMenu(x, y, node, connId) {
    menu.x = x
    menu.y = y
    menu.node = node
    menu.connId = connId
    menu.actions = actionsFor(node)
    menu.visible = true
  },
  openConnection: (connId) => emit('selectConn', connId),
  newQuery: (node, connId) => emit('newQuery', connId, node),
  createObject: (kind, node, connId) => emit('newObject', kind, connId, node),
  dropObject: (node, connId) => emit('dropObject', connId, node),
  viewStructure: (node, connId) => emit('viewStructure', connId, node),
  previewTable: (node, connId) => emit('previewTable', connId, node),
  designTable: (node, connId) => emit('designTable', connId, node),
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
  runSql: (connId, sql) => emit('runSql', connId, sql),
  async refreshNode(node, connId) {
    node.children = null
    if (node.expanded) await this.loadChildren(node, connId)
  },
  copyText: (text) => void navigator.clipboard?.writeText(text),
}

provide(TreeControllerKey, controller)

function onMenuPick(action: TreeAction): void {
  if (menu.node) action.run({ node: menu.node, connId: menu.connId, ctrl: controller })
  menu.visible = false
}

async function reload(): Promise<void> {
  const conns: ConnectionConfig[] = await client.connections.list()
  const prev = new Map(roots.value.map((r) => [r.id, r.node]))
  roots.value = conns.map((c) => ({
    id: c.id,
    node: prev.get(c.id) ?? rootNode(c.name || '(未命名)'),
    group: c.group,
  }))
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

// ── 批量操作 ──
function bulkDrop(): void {
  emit('bulkDrop', [...multiSel.values()])
}
function bulkCopyNames(): void {
  const text = [...multiSel.values()].map((s) => s.node.sqlName ?? s.node.name).join('\n')
  void navigator.clipboard?.writeText(text)
}

defineExpose({ reload, refreshNode, clearMulti: () => multiSel.clear() })
onMounted(reload)
</script>

<template>
  <div class="tree">
    <div class="tree-head">
      <span>{{ t('nav.title') }}</span>
      <span class="head-actions">
        <button class="icon" :title="t('nav.newConn')" @click="controller.newConnection()">+</button>
        <button class="icon" :title="t('nav.refresh')" @click="reload">⟳</button>
        <button class="icon" :title="t('nav.settings')" @click="emit('openSettings')">⚙</button>
      </span>
    </div>
    <div class="tree-body">
      <div v-if="!roots.length" class="tree-status">{{ t('nav.empty') }}</div>

      <template v-for="g in groupList" :key="'g:' + g.name">
        <div class="group-row" @click="toggleGroup(g.name)">
          <span class="caret">{{ expandedGroups.has(g.name) ? '▾' : '▸' }}</span>
          <span class="folder">📁</span>
          <span class="gname">{{ g.name }}</span>
          <span class="gcount">{{ g.conns.length }}</span>
        </div>
        <div v-show="expandedGroups.has(g.name)">
          <TreeItem v-for="r in g.conns" :key="r.id" :node="r.node" :conn-id="r.id" :depth="1" />
        </div>
      </template>

      <TreeItem v-for="r in ungrouped" :key="r.id" :node="r.node" :conn-id="r.id" :depth="0" />
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
      :actions="menu.actions"
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
