<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionEnv, MetaNodeKind } from '@db-tool/shared-types'
import { computed, inject } from 'vue'
import { connStatus } from '../conn-status'
import { ENV_META } from '../connEnv'
import { t } from '../i18n'
import { bumpUsage, getUsage, navUsageVersion } from '../nav-usage'
import { settings } from '../settings'
import DialectIcon from './DialectIcon.vue'
import { TreeControllerKey } from './tree-controller'
import { type TreeNode, iconFor } from './treeNode'

const props = defineProps<{
  node: TreeNode
  connId: string
  depth: number
  env?: ConnectionEnv
  /** 仅连接节点 (kind=connection) 使用：显示对应数据库 logo（替代默认 🔌） */
  dialect?: string
}>()

// 注入控制器：任意深度直接调用，无需逐层 emit 冒泡
const ctrl = inject(TreeControllerKey)!

/**
 * 用户报告 #7：开启 navSortByUsage 时，把当前节点的 Database / Schema 子节点
 * 按使用频率降序重排。其他类型（Group / Table / Column）保持原序——
 * 表列字典序比频率更直观。
 *
 * #24: 同一处再加可见库/Schema 白名单过滤 — 仅在 Connection 节点直挂的
 * Database / Schema 那一层生效 (因为白名单存在连接级 extra 上,
 * 子层级 schema 不在 v1 范围). 过滤先做,再走 usage 排序.
 *
 * 依赖 navUsageVersion 触发响应式重算（cache 本身是 plain object 不是 reactive）。
 */
const displayChildren = computed<TreeNode[]>(() => {
  void navUsageVersion.value // 触发依赖
  let kids = props.node.children || []
  // #24 过滤: 仅 Connection 节点的 Database / Schema 直挂子节点 (白名单)
  if (props.node.kind === MetaNodeKind.Connection) {
    const allow = ctrl.connVisibleFilter(props.connId)
    if (allow) {
      kids = kids.filter(
        (k) =>
          (k.kind !== MetaNodeKind.Database && k.kind !== MetaNodeKind.Schema) || allow.has(k.name),
      )
    }
  }
  // #24 v2: Database 节点下 Schema 子节点的二级过滤
  if (props.node.kind === MetaNodeKind.Database) {
    const schemaAllow = ctrl.connVisibleSchemas(props.connId, props.node.name)
    if (schemaAllow) {
      kids = kids.filter((k) => k.kind !== MetaNodeKind.Schema || schemaAllow.has(k.name))
    }
  }
  // #A 搜索过滤: 留下命中或有命中后代的子节点; 在 #24 白名单之后跑.
  if (ctrl.searchActive()) {
    kids = kids.filter((k) => ctrl.nodeMatchesSearch(k))
  }
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

/** #A: 搜索激活时, 已加载且至少一个子节点命中 → 强制展开, 让命中项立即可见.
 *  自身名字命中但子节点不命中的情况不强展 (那只需要本节点显示, 子层无需揭开). */
const forceExpand = computed(() => {
  if (!ctrl.searchActive()) return false
  const kids = props.node.children
  if (kids == null) return false
  return kids.some((k) => ctrl.nodeMatchesSearch(k))
})

/** #24: 连接节点旁的过滤指示器 — 启用时画一个小漏斗图标提示 */
const hasNavFilter = computed(
  () =>
    props.node.kind === MetaNodeKind.Connection && ctrl.connVisibleFilter(props.connId) !== null,
)

/**
 * #24: DataGrip-style filter chip: "N/M" when filter is active.
 *   N = filter set size (configured visible count)
 *   M = total top-level children. Two sources, in priority:
 *       a) the persisted snapshot from when the filter was last configured
 *          (always available right after save, no expand required)
 *       b) the live children count if the connection has been expanded
 *          (newer reality if dbs were added/removed since save)
 *   Priority order: prefer (b) when available since it reflects current
 *   server state; fall back to (a) so we still show N/M before first expand;
 *   last resort is just N if neither is known.
 *
 * children may contain non-database/schema nodes for some dialects, but the
 * count semantic stays right: filter only applies to Database / Schema kids,
 * so we filter on those kinds before counting.
 */
const filterChipText = computed<string>(() => {
  if (!hasNavFilter.value) return ''
  const allow = ctrl.connVisibleFilter(props.connId)
  const n = allow?.size ?? 0
  const kids = props.node.children
  if (kids != null) {
    const live = kids.filter(
      (k) => k.kind === MetaNodeKind.Database || k.kind === MetaNodeKind.Schema,
    ).length
    return `${n}/${live}`
  }
  const snapshot = ctrl.connVisibleTotal(props.connId)
  if (snapshot != null) return `${n}/${snapshot}`
  return String(n)
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

// 单击 (#25 增强):
//   - Ctrl/⌘+click  → 切换批量选择(连接节点走 toggleMultiConn, 其它走 toggleMulti)
//   - Shift+click   → 从最后一次单击锚点到当前节点的可见连续区间整段加入选择
//   - 普通单击      → 清空批量集并单选
function onSelect(e: MouseEvent): void {
  const isConn = props.node.kind === MetaNodeKind.Connection
  if (e.shiftKey) {
    if (isConn) ctrl.rangeSelectConn(props.connId)
    else ctrl.rangeSelect(props.node, props.connId)
    return
  }
  if (e.metaKey || e.ctrlKey) {
    if (isConn) ctrl.toggleMultiConn(props.connId)
    else ctrl.toggleMulti(props.node, props.connId)
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
        multi:
          ctrl.isMultiSelected(node, connId) ||
          (node.kind === 'connection' && ctrl.isMultiSelectedConn(connId)),
      }"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="onSelect"
      @dblclick="onOpen"
      @contextmenu="onContext"
    >
      <span class="caret" :class="{ loading: node.loading }" @click.stop="toggle" @dblclick.stop>
        <!-- 加载中用 caret 上的 spinner 代替单独一行 "加载中..." 提示,
             避免空目录展开瞬间下方兄弟节点闪动(那一行 ~22px 一进一出导致重排) -->
        {{ node.loading ? '⟳' : node.hasChildren ? (node.expanded ? '▾' : '▸') : '' }}
      </span>
      <!-- 连接节点：显示对应数据库品牌 logo（用户报告：一眼分清是哪个数据库）；
           其他节点保留原 emoji 字符。 -->
      <DialectIcon
        v-if="node.kind === 'connection' && dialect"
        :dialect="dialect"
        :size="14"
        class="ico-svg"
      />
      <span v-else class="ico">{{ iconFor(node) }}</span>
      <span
        v-if="node.kind === 'connection' && env"
        class="env-dot"
        :style="{ borderColor: ENV_META[env].color }"
        :title="t('env.dotTitle', { label: t('env.' + env) })"
      />
      <span
        v-if="node.kind === 'connection' && connStatus(connId)"
        class="status-dot"
        :class="connStatus(connId)"
        :title="connStatus(connId) === 'ok' ? t('conn.statusOk') : t('conn.statusError')"
      />
      <span class="label">{{ node.name }}</span>
      <span v-if="node.count != null" class="count">({{ node.count }})</span>
      <span v-if="node.detail?.dataType" class="col-type">{{ node.detail.dataType }}</span>
      <!-- #24: 过滤入口 — DataGrip 风格.
           启用时常驻显示 "N/M" chip (细紫框), 否则 hover 才浮一个 ▾ 入口.
           点击都是开同一个配置对话框. -->
      <button
        v-if="node.kind === 'connection'"
        class="filter-btn"
        :class="{ active: hasNavFilter }"
        :title="
          hasNavFilter ? '已配置过滤 · 点击修改可见库/Schema' : '配置可见库/Schema'
        "
        @click.stop="ctrl.configureNavFilter(connId)"
      >
        {{ hasNavFilter ? filterChipText : '▾' }}
      </button>
      <button
        v-if="node.kind === 'connection'"
        class="edit-btn"
        title="编辑连接"
        @click.stop="ctrl.editConnection(connId)"
      >
        ✎
      </button>
    </div>

    <template v-if="node.expanded || forceExpand">
      <!-- 之前这里有 v-if="node.loading" 的 "加载中..." 行,会引起兄弟节点重排闪烁;
           现在改为 caret 上显示 ⟳ spinner,这里只渲染真实 children。 -->
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
  /* 右对齐由前面的 .filter-btn margin-left: auto 接管, edit-btn 紧贴其后 */
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
.ico-svg {
  width: 16px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* 环境标记:空心环(○),跟实心的状态点(●)区分开 —— 否则「开发(绿)+ 已连上(绿)」
   会是两个一模一样的绿点,看着像重复/故障。颜色走内联 borderColor。 */
.env-dot {
  flex: none;
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: transparent;
  border: 2px solid;
}
/* 连接可达性小圆点：🟢 上次连上 / 🔴 上次出错（未尝试不显示）。 */
.status-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.status-dot.ok {
  background: #4caf50;
}
.status-dot.error {
  background: #e04050;
}
/* #24 过滤入口 — 两个状态:
   静态 = 不启用过滤: 透明 ▾ 入口, hover 才可见 (跟 .edit-btn 一致).
   启用过滤  : 常驻 "N/M" chip — DataGrip 风格细紫框 + 紧凑字体. */
.tree-node .filter-btn {
  margin-left: auto;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--muted);
  cursor: pointer;
  opacity: 0;
  padding: 0 4px;
  font-size: 10px;
  line-height: 1.4;
  font-family: var(--font-mono, ui-monospace, monospace);
  white-space: nowrap;
}
.tree-node.conn:hover .filter-btn,
.tree-node .filter-btn.active {
  opacity: 1;
}
.tree-node .filter-btn.active {
  color: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.08);
}
.tree-node .filter-btn.active:hover {
  background: rgba(124, 108, 255, 0.18);
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
.caret.loading {
  color: var(--accent);
  animation: caret-spin 0.8s linear infinite;
  display: inline-block;
}
@keyframes caret-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
.tree-err {
  padding: 4px 8px 4px 24px;
  color: var(--err);
  font-size: 12px;
  white-space: pre-wrap;
}
</style>
