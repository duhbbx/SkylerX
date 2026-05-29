<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 自引用树形展示（A5）：用户指定 idCol / parentCol / labelCol → 把结果集渲染为树。
 *
 * 算法：先扫一遍按 id 建索引，再扫一遍把孩子挂到父亲下；root = 父 id 不在索引里的节点（含 NULL）。
 * 不限制深度；环检测：如果某条链回到自己就标"⚠ 环"。
 */
import type { QueryResult } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ result: QueryResult }>()
const emit = defineEmits<{ close: [] }>()

const cols = computed(() => props.result.columns.map((c) => c.name))
const idCol = ref<string>('')
const parentCol = ref<string>('')
const labelCol = ref<string>('')

watch(
  () => props.result,
  () => {
    // 智能默认：id / parent_id / name 或 title
    idCol.value = cols.value.find((c) => /^id$/i.test(c)) ?? cols.value[0] ?? ''
    parentCol.value = cols.value.find((c) => /parent[_-]?id|pid/i.test(c)) ?? ''
    labelCol.value = cols.value.find((c) => /^(name|title|label)$/i.test(c)) ?? idCol.value
  },
  { immediate: true },
)

interface TreeNode {
  id: string
  label: string
  raw: Record<string, unknown>
  children: TreeNode[]
  depth: number
  cycle?: boolean
}

const tree = computed<TreeNode[]>(() => {
  if (!idCol.value || !parentCol.value || !labelCol.value) return []
  const byId = new Map<string, TreeNode>()
  for (const r of props.result.rows) {
    const id = String(r[idCol.value] ?? '')
    if (!id) continue
    byId.set(id, {
      id,
      label: String(r[labelCol.value] ?? id),
      raw: r,
      children: [],
      depth: 0,
    })
  }
  const roots: TreeNode[] = []
  for (const r of props.result.rows) {
    const id = String(r[idCol.value] ?? '')
    const pid = r[parentCol.value] != null ? String(r[parentCol.value]) : ''
    const n = byId.get(id)
    if (!n) continue
    const parent = pid && byId.get(pid)
    if (parent && parent !== n) parent.children.push(n)
    else roots.push(n)
  }
  // 设置 depth + 环检测
  const seen = new Set<string>()
  const walk = (n: TreeNode, depth: number): void => {
    if (seen.has(n.id)) {
      n.cycle = true
      return
    }
    seen.add(n.id)
    n.depth = depth
    for (const c of n.children) walk(c, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return roots
})

const flat = computed(() => {
  const out: TreeNode[] = []
  const walk = (n: TreeNode): void => {
    out.push(n)
    for (const c of n.children) walk(c)
  }
  for (const r of tree.value) walk(r)
  return out
})
</script>

<template>
  <Modal :title="t('tree.title')" @close="emit('close')">
    <div class="tree">
      <div class="cfg">
        <label><span>id</span><select v-model="idCol"><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>parent</span><select v-model="parentCol"><option value="">—</option><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <label><span>label</span><select v-model="labelCol"><option v-for="c in cols" :key="c" :value="c">{{ c }}</option></select></label>
        <span class="muted">{{ t('tree.nodes', { n: flat.length }) }}</span>
      </div>
      <div class="tree-body">
        <div v-if="!flat.length" class="empty">{{ t('tree.empty') }}</div>
        <div v-for="n in flat" :key="n.id" class="tnode" :style="{ paddingLeft: `${12 + n.depth * 18}px` }">
          <span class="tip">{{ n.children.length ? '▸' : '·' }}</span>
          <span class="tlabel" :title="JSON.stringify(n.raw, null, 2)">{{ n.label }}</span>
          <span v-if="n.cycle" class="cycle" :title="t('tree.cycle')">⚠</span>
          <span class="tid">#{{ n.id }}</span>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.tree { min-width: 600px; min-height: 480px; max-height: 75vh; display: flex; flex-direction: column; gap: 8px; }
.cfg { display: flex; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); align-items: center; flex-wrap: wrap; }
.cfg label { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color: var(--muted); }
.cfg select { padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.muted { color: var(--muted); font-size: 11px; margin-left: auto; }
.tree-body { flex: 1; overflow-y: auto; font-family: ui-monospace, monospace; font-size: 12px; }
.tnode { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.tip { color: var(--muted); }
.tlabel { font-weight: 600; cursor: help; }
.tid { color: var(--muted); font-size: 10px; margin-left: 6px; }
.cycle { color: #e0a020; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
</style>
