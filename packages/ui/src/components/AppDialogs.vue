<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { nextTick, ref, watch } from 'vue'
import { emitChatErrorAsk } from '../chat-bus'
import { useDataClient } from '../data-client'
import { dialogState, dismissToast, toast, toasts } from '../dialog'
import { t } from '../i18n'
import { saveFileState } from '../saveFile'
import SaveFileDialog from './SaveFileDialog.vue'

const client = useDataClient()

/** "已保存"卡片状态:存绝对路径,提供"打开文件 / 显示在文件夹"按钮。 */
const savedCard = ref<{ path: string } | null>(null)

async function onSaveFileSubmit(path: string): Promise<void> {
  const req = saveFileState.req
  if (!req) return
  // pick 模式:不写文件,只返回所选 path
  if (req.mode === 'pick-existing' || req.mode === 'pick-or-create') {
    saveFileState.open = false
    saveFileState.resolve?.(path)
    return
  }
  // save 模式:正常写盘 + 弹"已保存"卡片
  try {
    const fapi = client.files as unknown as {
      writeText?: (p: string, c: string) => Promise<string>
      writeBinary?: (p: string, b: Uint8Array | ArrayBuffer) => Promise<string>
    }
    if (req.content == null) {
      toast.error('save 模式必须提供 content')
      saveFileState.resolve?.(null)
      saveFileState.open = false
      return
    }
    if (req.content instanceof Uint8Array) {
      if (!fapi.writeBinary) {
        toast.error('writeBinary IPC 不可用')
        saveFileState.resolve?.(null)
        saveFileState.open = false
        return
      }
      await fapi.writeBinary(path, req.content)
    } else {
      if (!fapi.writeText) {
        toast.error('writeText IPC 不可用')
        saveFileState.resolve?.(null)
        saveFileState.open = false
        return
      }
      await fapi.writeText(path, req.content as string)
    }
    saveFileState.open = false
    saveFileState.resolve?.(path)
    savedCard.value = { path }
    // 8 秒后自动消失
    setTimeout(() => {
      if (savedCard.value?.path === path) savedCard.value = null
    }, 8000)
  } catch (e) {
    toast.error(`保存失败: ${e instanceof Error ? e.message : String(e)}`)
    saveFileState.resolve?.(null)
    saveFileState.open = false
  }
}

function onSaveFileCancel(): void {
  saveFileState.open = false
  saveFileState.resolve?.(null)
}

async function openSavedFile(): Promise<void> {
  if (!savedCard.value) return
  const fapi = client.files as unknown as { openPath?: (p: string) => Promise<string> }
  const err = await fapi.openPath?.(savedCard.value.path)
  if (err) toast.error(`打开失败: ${err}`)
  savedCard.value = null
}

async function showSavedInFolder(): Promise<void> {
  if (!savedCard.value) return
  const fapi = client.files as unknown as { showInFolder?: (p: string) => Promise<void> }
  await fapi.showInFolder?.(savedCard.value.path)
  savedCard.value = null
}

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

// 「✨ 问 AI」按钮:把错误上下文广播给 Workspace,同时关闭当前 alert
// (resolve undefined 跟点 OK 行为一致,调用方不需要分支处理)
function onAskAi(): void {
  const payload = dialogState.askAi
  if (!payload) return
  const resolve = dialogState.resolve
  dialogState.open = false
  emitChatErrorAsk(payload)
  resolve(undefined)
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
        <button
          v-if="dialogState.kind === 'alert' && dialogState.askAi"
          class="ask-ai-btn"
          @click="onAskAi"
        >
          ✨ {{ t('aichat.askAi') }}
        </button>
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

  <!-- 自定义保存文件对话框(同时承载 save / pick-existing / pick-or-create 三种模式) -->
  <SaveFileDialog
    v-if="saveFileState.open"
    :open="saveFileState.open"
    :default-name="saveFileState.req?.defaultName ?? ''"
    :filters="saveFileState.req?.filters"
    :default-dir="saveFileState.req?.defaultDir"
    :mode="saveFileState.req?.mode ?? 'save'"
    @close="onSaveFileCancel"
    @save="onSaveFileSubmit"
  />

  <!-- 保存成功卡片(右下角,8s 自动消失) -->
  <transition name="toast-slide">
    <div v-if="savedCard" class="saved-card">
      <div class="sc-head">
        <span class="sc-ico">✓</span>
        <span>已保存</span>
        <button class="sc-x" @click="savedCard = null">✕</button>
      </div>
      <div class="sc-path" :title="savedCard.path">{{ savedCard.path }}</div>
      <div class="sc-actions">
        <button class="sc-btn" @click="openSavedFile">打开文件</button>
        <button class="sc-btn" @click="showSavedInFolder">显示在文件夹</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* 保存成功卡片(右下角浮层,优先级比 toast 高一级) */
.saved-card {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 320px;
  background: var(--panel);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 10px 12px;
  z-index: 3200;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sc-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); }
.sc-ico {
  width: 18px; height: 18px;
  background: #4caf50; color: #fff;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
}
.sc-x {
  background: transparent; border: none; color: var(--muted);
  cursor: pointer; padding: 0 4px; margin-left: auto; font-size: 14px;
}
.sc-path {
  font-family: ui-monospace, monospace;
  font-size: 11px; color: var(--muted);
  word-break: break-all;
  max-height: 50px; overflow: hidden;
}
.sc-actions { display: flex; gap: 6px; }
.sc-btn {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--accent);
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.sc-btn:hover { background: rgba(124, 108, 255, 0.15); }
/* 简单的 toast-slide 过渡(若已存在则被复用,语义一致) */
.toast-slide-enter-from { opacity: 0; transform: translateY(20px); }
.toast-slide-enter-active, .toast-slide-leave-active { transition: all 0.2s ease-out; }
.toast-slide-leave-to { opacity: 0; transform: translateY(20px); }

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
/*
 * 危险动作（删除 / DROP / 不可逆 SQL）按钮反转位置：危险动作在左、取消在右。
 * 默认顺手按 Enter 容易误删；把危险按钮挪到左、取消挪到右，让回车不会立即执行危险操作。
 *
 * 用 flex order 实现（不依赖兄弟选择器 ~，模板中 ghost 在 primary 之前）：
 *   - 普通：ghost(2) primary(3)   → 取消左 / 确认右
 *   - danger: primary.danger(1, 推到最左) ghost(2)  → 删除左 / 取消右
 *   - alert+askAi: ask-ai(1) primary(3) → askAi 左 / 确认右
 */
.dlg-actions .ghost      { order: 2; }
.dlg-actions .primary    { order: 3; }
.dlg-actions .ask-ai-btn { order: 1; }
.dlg-actions .primary.danger { order: 1; margin-right: auto; }
.dlg-actions .primary:hover {
  filter: brightness(1.1);
}
/*
 * 「✨ 问 AI」按钮 —— 紫色描边 + 紫色文字,跟主 confirm 按钮区分,
 * 让用户清楚这是「次要但有用」的入口,不是默认动作。
 * margin-right:auto 把它推到左边,跟 confirm/OK 形成「次要|主要」布局。
 */
.dlg-actions .ask-ai-btn {
  margin-right: auto;
  background: transparent;
  color: var(--accent, #7c6cff);
  border-color: var(--accent, #7c6cff);
}
.dlg-actions .ask-ai-btn:hover {
  background: rgba(124, 108, 255, 0.12);
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
