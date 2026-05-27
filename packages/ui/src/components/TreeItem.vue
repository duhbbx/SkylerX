<script setup lang="ts">
import { inject } from 'vue'
import { TreeControllerKey } from './tree-controller'
import { type TreeNode, iconFor } from './treeNode'

const props = defineProps<{ node: TreeNode; connId: string; depth: number }>()

// 注入控制器：任意深度直接调用，无需逐层 emit 冒泡
const ctrl = inject(TreeControllerKey)!

async function toggle(): Promise<void> {
  const node = props.node
  if (!node.hasChildren) return
  node.expanded = !node.expanded
  if (node.expanded && node.children === null) await ctrl.loadChildren(node, props.connId)
}

// 单击：Ctrl/⌘ 切换批量选择；普通单击清空批量集并单选
function onSelect(e: MouseEvent): void {
  if (e.metaKey || e.ctrlKey) {
    ctrl.toggleMulti(props.node, props.connId)
    return
  }
  ctrl.clearMulti()
  ctrl.select(props.node, props.connId)
}

// 双击：选中 + 打开节点（连接/表）+ 展开折叠
function onOpen(): void {
  ctrl.clearMulti()
  ctrl.select(props.node, props.connId)
  ctrl.openNode(props.node, props.connId)
  void toggle()
}

function onContext(e: MouseEvent): void {
  e.preventDefault()
  ctrl.select(props.node, props.connId)
  ctrl.openContextMenu(e.clientX, e.clientY, props.node, props.connId)
}
</script>

<template>
  <div class="tree-item">
    <div
      class="tree-node"
      :class="{
        conn: node.kind === 'connection',
        selected: ctrl.isSelected(node, connId),
        multi: ctrl.isMultiSelected(node, connId),
      }"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="onSelect"
      @dblclick="onOpen"
      @contextmenu="onContext"
    >
      <span class="caret" @click.stop="toggle" @dblclick.stop>
        {{ node.hasChildren ? (node.expanded ? '▾' : '▸') : '' }}
      </span>
      <span class="ico">{{ iconFor(node) }}</span>
      <span class="label">{{ node.name }}</span>
      <span v-if="node.count != null" class="count">({{ node.count }})</span>
      <span v-if="node.detail?.dataType" class="col-type">{{ node.detail.dataType }}</span>
      <button
        v-if="node.kind === 'connection'"
        class="edit-btn"
        title="编辑连接"
        @click.stop="ctrl.editConnection(connId)"
      >
        ✎
      </button>
    </div>

    <template v-if="node.expanded">
      <div v-if="node.loading" class="tree-msg" :style="{ paddingLeft: (depth + 1) * 14 + 8 + 'px' }">
        加载中…
      </div>
      <TreeItem
        v-for="child in node.children || []"
        :key="child.kind + ':' + child.group + ':' + child.name"
        :node="child"
        :conn-id="connId"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
  user-select: none;
}
.tree-node:hover {
  background: rgba(124, 108, 255, 0.12);
}
.tree-node.selected {
  background: rgba(124, 108, 255, 0.28);
}
.tree-node.multi {
  background: rgba(124, 108, 255, 0.18);
  box-shadow: inset 3px 0 0 var(--accent, #7c6cff);
}
.tree-node.conn {
  font-weight: 600;
}
.tree-node .edit-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  padding: 0 4px;
}
.tree-node.conn:hover .edit-btn {
  opacity: 1;
}
.caret {
  width: 12px;
  flex: none;
  color: var(--muted);
}
.ico {
  width: 16px;
  flex: none;
  text-align: center;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  color: var(--muted);
  margin-left: 6px;
  font-size: 11px;
}
.col-type {
  color: var(--muted);
  margin-left: 6px;
  font-size: 11px;
}
.tree-msg {
  padding: 3px 8px;
  color: var(--muted);
  font-size: 12px;
}
.tree-err {
  padding: 4px 8px 4px 24px;
  color: var(--err);
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
