<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { t } from '../i18n'

export interface PaletteItem {
  id: string
  label: string
  hint?: string
  group?: string
}

const props = defineProps<{ items: PaletteItem[] }>()
const emit = defineEmits<{ select: [PaletteItem]; close: [] }>()

const query = ref('')
const active = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
  return list.slice(0, 50)
})

function move(delta: number): void {
  const n = filtered.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
}
function choose(item?: PaletteItem): void {
  const it = item ?? filtered.value[active.value]
  if (it) emit('select', it)
}

onMounted(() => {
  void nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <div class="cp-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="cp">
      <input
        ref="inputEl"
        v-model="query"
        class="cp-input"
        :placeholder="t('palette.ph')"
        @input="active = 0"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="choose()"
        @keydown.esc.prevent="emit('close')"
      />
      <div class="cp-list">
        <div v-if="!filtered.length" class="cp-empty">{{ t('palette.empty') }}</div>
        <div
          v-for="(it, i) in filtered"
          :key="it.id"
          class="cp-item"
          :class="{ active: i === active }"
          @mouseenter="active = i"
          @click="choose(it)"
        >
          <span class="cp-label">{{ it.label }}</span>
          <span v-if="it.hint" class="cp-hint">{{ it.hint }}</span>
          <span v-if="it.group" class="cp-group">{{ it.group }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}
.cp {
  width: 560px;
  max-width: calc(100vw - 40px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.cp-input {
  width: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 15px;
  outline: none;
}
.cp-list {
  max-height: 50vh;
  overflow-y: auto;
}
.cp-empty {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
.cp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  cursor: pointer;
  font-size: 13px;
}
.cp-item.active {
  background: var(--accent);
  color: #fff;
}
.cp-label {
  flex: 1;
}
.cp-hint {
  font-size: 11px;
  opacity: 0.7;
}
.cp-group {
  font-size: 11px;
  opacity: 0.6;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 5px;
}
</style>
