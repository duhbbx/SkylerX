<script setup lang="ts">
import { t } from '../i18n'

defineProps<{ title?: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" :class="{ wide }">
      <div class="modal-head">
        <span>{{ title }}</span>
        <button class="x" :title="t('common.close')" @click="emit('close')">×</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  width: 600px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
.modal.wide {
  width: 880px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}
.modal-head .x {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.modal-head .x:hover {
  color: var(--text);
}
.modal-body {
  padding: 18px;
  overflow-y: auto;
}
</style>
