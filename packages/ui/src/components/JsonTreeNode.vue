<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * JSON 树节点(递归组件)。
 *
 * 把 unknown 渲染成可折叠的树:
 *  - object → {} + 字段递归
 *  - array  → [] + 元素递归(标 [0] [1] ...)
 *  - 原子   → 直接显示值(字符串/数字/null/boolean 上色)
 *
 * 每行右侧显示对应的 JSON Path(`$.a.b[0].c`),hover 显示,点击复制 SQL extract。
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  /** 当前节点值 */
  data: unknown
  /** 父节点拼到当前位置的 JSON path 前缀(根从 '$' 开始,内部递归追加 .key 或 [i]) */
  path: string
  /** 字段名;数组元素用 [i] 形式 */
  label?: string
  /** 列名(给生成 SQL extract 用) */
  column: string
  /** 方言:用于生成正确的 extract 语法 */
  dialect: 'mysql' | 'pg' | 'sqlserver' | 'sqlite' | 'other'
  /** 根节点默认展开;深层只展开 2 层 */
  depth?: number
}>()

const emit = defineEmits<{
  /** 路径被点击 → 由父冒泡到顶层 viewer 处理(复制 SQL) */
  pickPath: [path: string]
}>()

const depth = computed(() => props.depth ?? 0)
const expanded = ref(depth.value < 2)

const type = computed<'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'>(() => {
  if (props.data === null) return 'null'
  if (Array.isArray(props.data)) return 'array'
  return typeof props.data as 'object' | 'string' | 'number' | 'boolean'
})

const isContainer = computed(() => type.value === 'object' || type.value === 'array')

const entries = computed<[string, unknown][]>(() => {
  if (type.value === 'object') return Object.entries(props.data as Record<string, unknown>)
  if (type.value === 'array') return (props.data as unknown[]).map((v, i) => [`[${i}]`, v])
  return []
})

const summary = computed(() => {
  if (type.value === 'object') return `{${Object.keys(props.data as object).length}}`
  if (type.value === 'array') return `[${(props.data as unknown[]).length}]`
  return ''
})

function childPath(label: string): string {
  // path = '$.a.b';label = 'c' 或 '[0]'
  if (label.startsWith('[')) return props.path + label
  // 如果 key 不合法标识符,用 ["key"] 否则 .key
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(label)) return `${props.path}.${label}`
  return `${props.path}["${label.replace(/"/g, '\\"')}"]`
}

function onPickPath(): void {
  emit('pickPath', props.path)
}
</script>

<template>
  <div class="jt-node">
    <div class="jt-row" :class="{ container: isContainer }" @click.stop="isContainer ? (expanded = !expanded) : onPickPath()">
      <span v-if="isContainer" class="caret">{{ expanded ? '▾' : '▸' }}</span>
      <span v-else class="caret-ph"></span>
      <span v-if="label" class="key">{{ label.startsWith('[') ? label : `"${label}":` }}</span>
      <span v-if="isContainer" class="summary">{{ type === 'object' ? '{' : '[' }} <span class="meta">{{ summary }}</span>{{ expanded ? '' : (type === 'object' ? ' }' : ' ]') }}</span>
      <template v-else>
        <span class="value" :data-t="type">
          <template v-if="type === 'string'">"{{ data }}"</template>
          <template v-else>{{ data === null ? 'null' : String(data) }}</template>
        </span>
      </template>
      <span class="path-tip" :title="`点路径复制 SQL extract`" @click.stop="onPickPath">{{ path }}</span>
    </div>
    <div v-if="isContainer && expanded" class="jt-children">
      <JsonTreeNode
        v-for="[k, v] in entries"
        :key="k"
        :data="v"
        :path="childPath(k)"
        :label="k"
        :column="column"
        :dialect="dialect"
        :depth="depth + 1"
        @pick-path="(p) => emit('pickPath', p)"
      />
      <div v-if="isContainer && expanded" class="close-bracket">{{ type === 'object' ? '}' : ']' }}</div>
    </div>
  </div>
</template>

<style scoped>
.jt-node { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; }
.jt-row { display: flex; align-items: baseline; gap: 4px; padding: 0 4px; cursor: pointer; }
.jt-row:hover { background: rgba(124, 108, 255, 0.08); }
.caret { width: 12px; color: var(--accent); flex: none; font-size: 10px; }
.caret-ph { width: 12px; flex: none; }
.key { color: var(--accent); }
.value[data-t='string'] { color: #4caf50; }
.value[data-t='number'] { color: #e0a020; }
.value[data-t='boolean'] { color: #03a9f4; }
.value[data-t='null'] { color: var(--muted); font-style: italic; }
.summary { color: var(--text); }
.meta { color: var(--muted); font-size: 10px; }
.path-tip {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
  opacity: 0;
  font-family: var(--font-mono);
  padding: 0 4px;
  border-radius: 2px;
  user-select: all;
}
.jt-row:hover .path-tip {
  opacity: 1;
  background: rgba(124, 108, 255, 0.12);
  color: var(--accent);
}
.jt-children {
  padding-left: 16px;
  border-left: 1px dashed rgba(124, 108, 255, 0.2);
  margin-left: 5px;
}
.close-bracket { color: var(--text); padding: 0 4px; }
</style>
