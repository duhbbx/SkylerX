<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionEnv, MetaNodeKind } from '@db-tool/shared-types'
import { computed, inject } from 'vue'
import { ENV_META } from '../connEnv'
import { t } from '../i18n'
import { bumpUsage, getUsage, navUsageVersion } from '../nav-usage'
import { settings } from '../settings'
import { TreeControllerKey } from './tree-controller'
import { type TreeNode, iconFor } from './treeNode'

const props = defineProps<{ node: TreeNode; connId: string; depth: number; env?: ConnectionEnv }>()

// 注入控制器：任意深度直接调用，无需逐层 emit 冒泡
const ctrl = inject(TreeControllerKey)!

/**
 * 用户报告 #7：开启 navSortByUsage 时，把当前节点的 Database / Schema 子节点
 * 按使用频率降序重排。其他类型（Group / Table / Column）保持原序——
 * 表列字典序比频率更直观。
 *
 * 依赖 navUsageVersion 触发响应式重算（cache 本身是 plain object 不是 reactive）。
 */
const displayChildren = computed<TreeNode[]>(() => {
  void navUsageVersion.value // 触发依赖
  const kids = props.node.children || []
  if (!settings.navSortByUsage || kids.length < 2) return kids
  const sortable = kids.every(
    (k) => k.kind === MetaNodeKind.Database || k.kind === MetaNodeKind.Schema,
  )
  if (!sortable) return kids
  return [...kids].sort((a, b) => {
    const ua = getUsage(props.connId, a.path)
    const ub = getUsage(props.connId, b.path)
    if (ub !== ua) return ub - ua
    return a.name.localeCompare(b.name)
  })
})

async function toggle(): Promise<void> {
  const node = props.node
  if (!node.hasChildren) return
  node.expanded = !node.expanded
  // 用户报告 #7：展开 Database / Schema 算一次「使用」累计计数
  if (node.expanded && (node.kind === MetaNodeKind.Database || node.kind === MetaNodeKind.Schema)) {
    bumpUsage(props.connId, node.path)
  }
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
      <span
        v-if="node.kind === 'connection' && env"
        class="env-dot"
        :style="{ background: ENV_META[env].color }"
        :title="t('env.dotTitle', { label: t('env.' + env) })"
      />
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
        {{ t('nav.loading') }}
      </div>
      <TreeItem
        v-for="child in displayChildren"
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
.env-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
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
