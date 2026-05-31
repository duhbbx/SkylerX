<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Always-blocking error report modal — opens whenever reportError() fires.
 *
 * Per user direction: every error in SkylerX surfaces here (instead of a
 * right-bottom toast that can be missed). Shows:
 *  - the error message
 *  - callsite (file · function · line)
 *  - error stack (collapsed details)
 *  - args (redacted JSON, collapsed)
 *  - environment block (SkylerX / OS / Electron / locale / tz, collapsed)
 *
 * Footer has dedicated copy buttons:
 *  - 📋 复制全部 — the full Markdown report (suitable for pasting in an issue)
 *  - 复制错误栈 — just the stack
 *  - 复制环境 — just the Environment block
 *  - 关闭 — primary, closes the modal
 *
 * Failed clipboard write degrades to a warn toast, never blocks dismissal.
 */
import { dismissErrorModal, errorModal, toast } from '../dialog'
import Modal from './Modal.vue'

function copy(text: string, label: string): void {
  void (async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label} (${text.length} 字符)`, 1800)
    } catch (e) {
      toast.warn(`复制失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  })()
}

function copyAll(): void {
  if (!errorModal.data) return
  copy(errorModal.data.fullMarkdown, '完整报告')
}
function copyStack(): void {
  if (!errorModal.data?.stack) return
  copy(errorModal.data.stack, '错误栈')
}
function copyEnv(): void {
  if (!errorModal.data) return
  copy(errorModal.data.envBlock.replace(/^\n/, ''), '环境信息')
}
function copyMessage(): void {
  if (!errorModal.data) return
  copy(errorModal.data.message, '错误消息')
}

function fmtCallsite(c: NonNullable<typeof errorModal.data>['callsite']): string {
  if (!c) return ''
  const parts = [c.file]
  if (c.function) parts.push(c.function)
  if (c.line !== undefined) parts.push(String(c.line))
  return parts.join(' · ')
}
</script>

<template>
  <Modal
    v-if="errorModal.open && errorModal.data"
    :title="'⚠ ' + (errorModal.data.tag ? `[${errorModal.data.tag}] ` : '') + '出错了'"
    width="medium"
    @close="dismissErrorModal"
  >
    <div class="err-modal">
      <!-- Message: top-level, copyable in one click -->
      <div class="err-section err-msg-section">
        <div class="err-label-row">
          <span class="err-label">错误消息</span>
          <button class="err-copy-btn" @click="copyMessage">📋 复制</button>
        </div>
        <pre class="err-message">{{ errorModal.data.message }}</pre>
      </div>

      <!-- Callsite: one line, monospace -->
      <div v-if="errorModal.data.callsite" class="err-section">
        <span class="err-label">📍 调用位置</span>
        <code class="err-callsite">{{ fmtCallsite(errorModal.data.callsite) }}</code>
      </div>

      <!-- Stack: collapsed by default -->
      <details v-if="errorModal.data.stack" class="err-section">
        <summary>
          📚 错误栈
          <button class="err-copy-btn err-copy-inline" @click.prevent.stop="copyStack">复制</button>
        </summary>
        <pre class="err-stack">{{ errorModal.data.stack }}</pre>
      </details>

      <!-- Args: collapsed by default, only if present -->
      <details
        v-if="errorModal.data.args && Object.keys(errorModal.data.args).length"
        class="err-section"
      >
        <summary>📦 参数 (敏感字段已脱敏)</summary>
        <pre class="err-args">{{ JSON.stringify(errorModal.data.args, null, 2) }}</pre>
      </details>

      <!-- Environment: collapsed by default -->
      <details class="err-section">
        <summary>
          🖥 环境信息
          <button class="err-copy-btn err-copy-inline" @click.prevent.stop="copyEnv">复制</button>
        </summary>
        <pre class="err-env">{{ errorModal.data.envBlock.replace(/^\n/, '') }}</pre>
      </details>
    </div>

    <template #footer>
      <button class="err-footer-btn" @click="copyAll">📋 复制全部</button>
      <button
        class="err-footer-btn"
        :disabled="!errorModal.data.stack"
        @click="copyStack"
      >复制错误栈</button>
      <button class="err-footer-btn" @click="copyEnv">复制环境</button>
      <button class="err-footer-btn primary" @click="dismissErrorModal">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.err-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}
.err-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.err-msg-section {
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.err-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.err-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.err-callsite {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  word-break: break-all;
}
.err-message,
.err-stack,
.err-args,
.err-env {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  max-height: 220px;
  overflow-y: auto;
}
.err-message {
  color: var(--err, #e04050);
  font-weight: 500;
  max-height: 140px;
}
.err-section summary {
  cursor: pointer;
  font-size: 13px;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.err-section summary:hover {
  color: var(--accent, #7c6cff);
}
.err-copy-btn {
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.err-copy-btn:hover {
  color: var(--text);
  border-color: var(--accent, #7c6cff);
}
.err-copy-inline {
  margin-left: auto;
}
.err-footer-btn {
  padding: 6px 14px;
  background: var(--panel, #2a2a2a);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.err-footer-btn:hover:not(:disabled) {
  border-color: var(--accent, #7c6cff);
}
.err-footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.err-footer-btn.primary {
  background: var(--accent, #7c6cff);
  color: white;
  border-color: var(--accent, #7c6cff);
}
.err-footer-btn.primary:hover {
  filter: brightness(1.1);
}
</style>
