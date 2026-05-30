<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 自定义下拉选择器,替代原生 <select>:
 *  - 触发器和下拉面板都跟随主题(原生 select 的 option 列表样式由 OS 决定无法主题化)
 *  - 面板用 teleport to=body + fixed 定位,不被父级 overflow:hidden 裁切
 *  - 键盘 ↑↓Enter Esc;选项 > 8 个自动显示过滤搜索框
 *  - 点击外部 / Esc / 选中即关
 *
 * 使用:
 *  <ThemedSelect v-model="selectedDb" :options="dbOptions" placeholder="(默认库)" />
 *  options:Array<{ value: string; label: string }>
 */
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from 'vue'

interface Option {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: Option[]
  placeholder?: string
  /** 下拉面板最大高度(px),默认 280 */
  maxHeight?: number
  /** 触发器尺寸(等同 .ctx 的 max-width),默认 180 */
  width?: number
  /** 触发器无边框样式(嵌在 toolbar 时去掉边框更紧凑) */
  ghost?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  change: [string]
}>()

const open = ref(false)
const triggerRef = useTemplateRef<HTMLButtonElement>('triggerEl')
const panelPos = ref<{ left: number; top: number; width: number } | null>(null)
const focusedIdx = ref(-1)
const filterText = ref('')

const filtered = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  return q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options
})

const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)

function openPanel(): void {
  if (props.disabled) return
  const r = triggerRef.value?.getBoundingClientRect()
  if (!r) return
  const w = Math.max(r.width, props.width ?? 180)
  // 避免超出视口右侧 / 底部
  let left = r.left
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
  let top = r.bottom + 2
  const maxH = props.maxHeight ?? 280
  if (top + maxH > window.innerHeight - 8) top = r.top - maxH - 2
  panelPos.value = { left, top, width: w }
  open.value = true
  focusedIdx.value = filtered.value.findIndex((o) => o.value === props.modelValue)
  // 滚动到选中项
  void nextTick(() => {
    const el = document.querySelector(`.ts-option[data-idx="${focusedIdx.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function close(): void {
  open.value = false
  filterText.value = ''
  focusedIdx.value = -1
}

function toggle(): void {
  if (open.value) close()
  else openPanel()
}

function pick(v: string): void {
  emit('update:modelValue', v)
  emit('change', v)
  close()
}

function onKey(e: KeyboardEvent): void {
  if (!open.value && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    openPanel()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusedIdx.value = Math.min(filtered.value.length - 1, focusedIdx.value + 1)
    scrollIntoFocused()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusedIdx.value = Math.max(0, focusedIdx.value - 1)
    scrollIntoFocused()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = filtered.value[focusedIdx.value]
    if (o) pick(o.value)
  } else if (e.key === 'Home') {
    e.preventDefault()
    focusedIdx.value = 0
    scrollIntoFocused()
  } else if (e.key === 'End') {
    e.preventDefault()
    focusedIdx.value = filtered.value.length - 1
    scrollIntoFocused()
  }
}

function scrollIntoFocused(): void {
  void nextTick(() => {
    const el = document.querySelector(`.ts-option[data-idx="${focusedIdx.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

/** 点击外部关闭 */
function onDocMouseDown(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as HTMLElement
  if (triggerRef.value?.contains(t)) return
  if (t.closest('.ts-panel')) return
  close()
}

/** 窗口尺寸变化/滚动:关掉避免错位 */
function onWindowChange(): void {
  if (open.value) close()
}

watch(open, async (v) => {
  if (v) {
    await nextTick()
    document.addEventListener('mousedown', onDocMouseDown, true)
    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)
  } else {
    document.removeEventListener('mousedown', onDocMouseDown, true)
    window.removeEventListener('resize', onWindowChange)
    window.removeEventListener('scroll', onWindowChange, true)
  }
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  window.removeEventListener('resize', onWindowChange)
  window.removeEventListener('scroll', onWindowChange, true)
})
</script>

<template>
  <button
    ref="triggerEl"
    class="ts-trigger"
    :class="{ open, ghost, disabled }"
    :disabled="disabled"
    :title="currentLabel || placeholder || ''"
    @click="toggle"
    @keydown="onKey"
  >
    <span class="ts-val" :class="{ ph: !currentLabel }">
      {{ currentLabel || placeholder || '—' }}
    </span>
    <span class="ts-caret" :class="{ open }">▾</span>
  </button>
  <Teleport to="body">
    <div
      v-if="open && panelPos"
      class="ts-panel"
      :style="{
        left: panelPos.left + 'px',
        top: panelPos.top + 'px',
        width: panelPos.width + 'px',
        maxHeight: (maxHeight ?? 280) + 'px',
      }"
      @mousedown.stop
    >
      <input
        v-if="options.length > 8"
        v-model="filterText"
        class="ts-search"
        placeholder="过滤..."
        @click.stop
        @keydown="onKey"
      />
      <div class="ts-list">
        <div
          v-for="(o, i) in filtered"
          :key="o.value"
          :data-idx="i"
          class="ts-option"
          :class="{ on: o.value === modelValue, focus: i === focusedIdx }"
          @click="pick(o.value)"
          @mouseenter="focusedIdx = i"
        >
          <span class="ts-opt-label">{{ o.label }}</span>
          <span v-if="o.value === modelValue" class="ts-check">✓</span>
        </div>
        <div v-if="!filtered.length" class="ts-empty">无匹配项</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ts-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  min-width: 100px;
  max-width: 200px;
  font-family: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
}
.ts-trigger.ghost {
  background: transparent;
  border-color: transparent;
}
.ts-trigger.ghost:hover {
  background: var(--panel);
  border-color: var(--border);
}
.ts-trigger:hover {
  border-color: var(--accent);
}
.ts-trigger:focus,
.ts-trigger.open {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(124, 108, 255, 0.18);
}
.ts-trigger.disabled,
.ts-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ts-val {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ts-val.ph {
  color: var(--muted);
}
.ts-caret {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.15s ease-out;
}
.ts-caret.open {
  transform: rotate(180deg);
}
</style>

<!-- 面板用 teleport 跑出 scoped scope,样式 :global / 全局 selector -->
<style>
.ts-panel {
  position: fixed;
  background: var(--panel, #25262b);
  border: 1px solid var(--border, #3a3b40);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-size: 12px;
}
.ts-search {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg, #1d1e22);
  border: none;
  border-bottom: 1px solid var(--border, #3a3b40);
  color: var(--text, #fff);
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.ts-list {
  flex: 1;
  overflow-y: auto;
}
.ts-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
  cursor: pointer;
  color: var(--text, #fff);
  white-space: nowrap;
}
.ts-option.focus {
  background: rgba(124, 108, 255, 0.18);
}
.ts-option.on {
  color: var(--accent, #7c6cff);
  font-weight: 500;
}
.ts-opt-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ts-check {
  color: var(--accent, #7c6cff);
  flex: 0 0 auto;
}
.ts-empty {
  padding: 10px 12px;
  color: var(--muted, #888);
  text-align: center;
  font-style: italic;
}
</style>
