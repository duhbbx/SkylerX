<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { nextTick, ref, watch } from 'vue'
import { dialogState, dismissToast, toasts } from '../dialog'
import { t } from '../i18n'

// 自动聚焦：confirm 默认按钮、prompt 输入框
const inputRef = ref<HTMLInputElement>()
const confirmBtnRef = ref<HTMLButtonElement>()

watch(
  () => dialogState.open,
  async (v) => {
    if (!v) return
    await nextTick()
    if (dialogState.kind === 'prompt') inputRef.value?.focus()
    else confirmBtnRef.value?.focus()
  },
)

function onConfirm(): void {
  const resolve = dialogState.resolve
  if (dialogState.kind === 'prompt') {
    dialogState.open = false
    resolve(dialogState.promptValue)
  } else if (dialogState.kind === 'confirm') {
    dialogState.open = false
    resolve(true)
  } else {
    dialogState.open = false
    resolve(undefined)
  }
}

function onCancel(): void {
  const resolve = dialogState.resolve
  dialogState.open = false
  if (dialogState.kind === 'confirm') resolve(false)
  else if (dialogState.kind === 'prompt') resolve(null)
  else resolve(undefined)
}

function onKey(e: KeyboardEvent): void {
  if (!dialogState.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
  } else if (e.key === 'Enter' && dialogState.kind !== 'prompt') {
    // prompt 里 Enter 让浏览器自然提交输入；用户在输入框按 Enter 等同点确认
    e.preventDefault()
    onConfirm()
  }
}
</script>

<template>
  <!-- ── 确认 / 警告 / 输入对话框 ── -->
  <div v-if="dialogState.open" class="dlg-backdrop" @keydown="onKey">
    <div class="dlg" :class="'v-' + dialogState.variant">
      <div v-if="dialogState.title" class="dlg-title">
        <span class="dlg-icon">{{
          dialogState.variant === 'danger' ? '⚠' :
          dialogState.variant === 'warn' ? '!' :
          dialogState.variant === 'success' ? '✓' : 'i'
        }}</span>
        <span>{{ dialogState.title }}</span>
      </div>
      <pre class="dlg-msg">{{ dialogState.message }}</pre>
      <input
        v-if="dialogState.kind === 'prompt'"
        ref="inputRef"
        v-model="dialogState.promptValue"
        class="dlg-input"
        :placeholder="dialogState.promptPlaceholder"
        @keydown.enter.prevent="onConfirm"
        @keydown.escape.prevent="onCancel"
      />
      <div class="dlg-actions">
        <button v-if="dialogState.kind !== 'alert'" class="ghost" @click="onCancel">
          {{ dialogState.cancelText || t('common.cancel') }}
        </button>
        <button
          ref="confirmBtnRef"
          class="primary"
          :class="{ danger: dialogState.variant === 'danger' }"
          @click="onConfirm"
        >
          {{ dialogState.confirmText || (dialogState.kind === 'alert' ? t('common.confirm') : t('common.confirm')) }}
        </button>
      </div>
    </div>
  </div>

  <!-- ── Toast 通知（右下角堆叠）── -->
  <div class="toasts">
    <transition-group name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="'v-' + t.variant" @click="dismissToast(t.id)">
        <span class="toast-ico">{{
          t.variant === 'danger' ? '✗' :
          t.variant === 'warn' ? '!' :
          t.variant === 'success' ? '✓' : 'i'
        }}</span>
        <span class="toast-msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.dlg-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dlg {
  min-width: 360px;
  max-width: 520px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  padding: 18px 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dlg-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.dlg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(124, 108, 255, 0.18);
  color: var(--accent, #7c6cff);
  font-size: 13px;
}
.dlg.v-warn .dlg-icon {
  background: rgba(224, 160, 32, 0.18);
  color: #e0a020;
}
.dlg.v-danger .dlg-icon {
  background: rgba(224, 64, 80, 0.18);
  color: var(--err, #e04050);
}
.dlg.v-success .dlg-icon {
  background: rgba(76, 175, 80, 0.18);
  color: #4caf50;
}
.dlg-msg {
  margin: 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 50vh;
  overflow-y: auto;
}
.dlg-input {
  padding: 7px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.dlg-input:focus {
  border-color: var(--accent, #7c6cff);
}
.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.dlg-actions button {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
}
.dlg-actions .ghost {
  background: transparent;
  color: var(--text);
}
.dlg-actions .ghost:hover {
  background: rgba(124, 108, 255, 0.10);
}
.dlg-actions .primary {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.dlg-actions .primary.danger {
  background: var(--err, #e04050);
  border-color: var(--err, #e04050);
}
.dlg-actions .primary:hover {
  filter: brightness(1.1);
}

/* ── Toast ── */
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2900;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  min-width: 240px;
  max-width: 360px;
  padding: 8px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent, #7c6cff);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.toast.v-warn {
  border-left-color: #e0a020;
}
.toast.v-danger {
  border-left-color: var(--err, #e04050);
}
.toast.v-success {
  border-left-color: #4caf50;
}
.toast-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  font-weight: 600;
  font-size: 12px;
}
.toast.v-warn .toast-ico { color: #e0a020; }
.toast.v-danger .toast-ico { color: var(--err, #e04050); }
.toast.v-success .toast-ico { color: #4caf50; }
.toast.v-info .toast-ico { color: var(--accent, #7c6cff); }
.toast-msg {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
</style>
