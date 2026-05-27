<script setup lang="ts">
import { t } from '../i18n'
import type { TreeAction } from './tree-actions'

defineProps<{ x: number; y: number; actions: TreeAction[] }>()
const emit = defineEmits<{ pick: [TreeAction]; close: [] }>()
</script>

<template>
  <div class="cm-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')">
    <ul class="cm" :style="{ left: x + 'px', top: y + 'px' }" @click.stop>
      <li v-if="!actions.length" class="empty">{{ t('ctx.empty') }}</li>
      <li
        v-for="a in actions"
        :key="a.id"
        :class="{ danger: a.danger }"
        @click="emit('pick', a)"
      >
        {{ a.label }}
      </li>
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
  min-width: 150px;
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
</style>
