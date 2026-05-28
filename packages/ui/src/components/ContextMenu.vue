<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { t } from '../i18n'
import type { MenuEntry, TreeAction } from './tree-actions'

const props = defineProps<{ x: number; y: number; entries: MenuEntry[] }>()
const emit = defineEmits<{ pick: [TreeAction]; close: [] }>()

function isDivider(e: MenuEntry): e is { divider: true; id: string } {
  return (e as { divider?: boolean }).divider === true
}

// 实际渲染位置：避免菜单超出视口下/右边被裁切；若空间不够则相对鼠标向上/向左翻转，
// 仍不够则贴边并附加 max-height + overflow-y 兜底。
const menuEl = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y, maxHeight: 0 })

onMounted(async () => {
  await nextTick()
  const el = menuEl.value
  if (!el) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const rect = el.getBoundingClientRect()
  const gap = 8
  // X：右越界 → 向左翻
  let left = props.x
  if (left + rect.width > vw - gap) left = Math.max(gap, vw - rect.width - gap)
  // Y：先尝试鼠标下方；下方放不下时尝试向上翻；都放不下则贴顶并启用滚动
  let top = props.y
  let maxHeight = 0
  if (top + rect.height > vh - gap) {
    const above = props.y - rect.height
    if (above >= gap) {
      top = above
    } else {
      top = gap
      maxHeight = vh - 2 * gap
    }
  }
  pos.value = { left, top, maxHeight }
})
</script>

<template>
  <div class="cm-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')">
    <ul
      ref="menuEl"
      class="cm"
      :style="{
        left: pos.left + 'px',
        top: pos.top + 'px',
        maxHeight: pos.maxHeight ? pos.maxHeight + 'px' : '80vh',
      }"
      @click.stop
    >
      <li v-if="!entries.length" class="empty">{{ t('ctx.empty') }}</li>
      <template v-for="e in entries" :key="e.id">
        <li v-if="isDivider(e)" class="divider" />
        <li
          v-else
          :class="{ danger: (e as TreeAction).danger }"
          @click="emit('pick', e as TreeAction)"
        >
          {{ t((e as TreeAction).label) }}
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.cm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.cm {
  position: fixed;
  min-width: 180px;
  max-height: 80vh;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 13px;
}
.cm li {
  padding: 6px 12px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
.cm li:hover {
  background: rgba(124, 108, 255, 0.18);
}
.cm li.danger {
  color: var(--err);
}
.cm li.empty {
  color: var(--muted);
  cursor: default;
}
.cm li.empty:hover {
  background: transparent;
}
.cm li.divider {
  height: 1px;
  padding: 0;
  margin: 4px 6px;
  background: var(--border);
  border-radius: 0;
  cursor: default;
}
.cm li.divider:hover {
  background: var(--border);
}
</style>
