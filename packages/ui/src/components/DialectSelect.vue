<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据库方言下拉选择器（替代原 <select>，因为 native select 无法内嵌 SVG）。
 *
 * 行为：
 *  - 收起态显示当前 dialect 的品牌 logo + 显示名 + ▾
 *  - 展开态列出所有可选项，每行 logo + label，hover 高亮、当前项加 ✓
 *  - 键盘可达：Enter / Space 展开；↑↓ 在展开后选项间移动；Enter 选中；Esc 关闭
 *  - 点击外部关闭（监听 document mousedown，在自己内部时忽略）
 *  - 跟原 select 行为一致：仅触发 update:modelValue + change（值是 dialect 字符串）
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'
import DialectIcon from './DialectIcon.vue'

interface Option {
  value: string
  label: string
}

const props = defineProps<{
  modelValue: string
  options: Option[]
}>()
const emit = defineEmits<{
  'update:modelValue': [string]
  /** 与 native select 的 change 事件语义对齐，方便调用方原样接 @change="onDialectChange" */
  change: []
}>()

const open = ref(false)
const root = ref<HTMLDivElement>()
const list = ref<HTMLDivElement>()
const hover = ref(-1) // 键盘高亮的索引，-1 表示未高亮

const current = computed(() => props.options.find((o) => o.value === props.modelValue))
const currentLabel = computed(() => current.value?.label ?? props.modelValue)

function toggle(): void {
  if (open.value) close()
  else openMenu()
}
function openMenu(): void {
  open.value = true
  hover.value = props.options.findIndex((o) => o.value === props.modelValue)
  void nextTick(() => {
    // 把当前项滚到可视范围
    list.value?.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' })
  })
}
function close(): void {
  open.value = false
}
function pick(opt: Option): void {
  if (opt.value !== props.modelValue) {
    emit('update:modelValue', opt.value)
    emit('change')
  }
  close()
}

function onKeydown(e: KeyboardEvent): void {
  if (!open.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu()
    }
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    hover.value = Math.min(props.options.length - 1, hover.value + 1)
    void nextTick(() => list.value?.children[hover.value]?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    hover.value = Math.max(0, hover.value - 1)
    void nextTick(() => list.value?.children[hover.value]?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const o = props.options[hover.value]
    if (o) pick(o)
  } else if (e.key === 'Home') {
    e.preventDefault()
    hover.value = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    hover.value = props.options.length - 1
  }
}

// 点击外部关闭：判断 target 是否在 root 内
function onDocMouseDown(e: MouseEvent): void {
  if (!open.value) return
  const tgt = e.target as Node | null
  if (tgt && root.value?.contains(tgt)) return
  close()
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown))
</script>

<template>
  <div ref="root" class="dsel" :class="{ open }" @keydown="onKeydown">
    <button
      type="button"
      class="dsel-btn"
      :aria-expanded="open"
      :aria-label="t('conn.dialect')"
      @click="toggle"
    >
      <DialectIcon :dialect="modelValue" :size="16" />
      <span class="dsel-label">{{ currentLabel }}</span>
      <span class="dsel-caret">▾</span>
    </button>
    <div v-if="open" ref="list" class="dsel-list" role="listbox">
      <div
        v-for="(o, i) in options"
        :key="o.value"
        class="opt"
        :class="{ active: o.value === modelValue, hover: i === hover }"
        role="option"
        :aria-selected="o.value === modelValue"
        @click="pick(o)"
        @mouseenter="hover = i"
      >
        <DialectIcon :dialect="o.value" :size="16" />
        <span class="opt-label">{{ o.label }}</span>
        <span v-if="o.value === modelValue" class="opt-check">✓</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dsel {
  position: relative;
  display: inline-block;
  min-width: 220px;
}
.dsel-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.dsel.open .dsel-btn,
.dsel-btn:focus-visible {
  outline: none;
  border-color: var(--accent, #7c6cff);
}
.dsel-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsel-caret {
  color: var(--muted);
  font-size: 11px;
}
.dsel-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
  /* 高于其他表单元素，但低于 modal-backdrop（2000+） */
  z-index: 50;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.opt.hover,
.opt:hover {
  background: rgba(124, 108, 255, 0.10);
}
.opt.active {
  background: rgba(124, 108, 255, 0.06);
}
.opt-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opt-check {
  color: var(--accent, #7c6cff);
  font-weight: 600;
}
</style>
