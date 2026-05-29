/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * App 主题的 confirm / alert / prompt / toast，替代浏览器原生 window.* 那几个
 * 灰白色弹窗（跟我们的暗色主题完全不搭）。
 *
 * - 用 reactive 全局单例 + 顶层 <AppDialogs /> 渲染；
 * - confirm/alert/prompt 都返回 Promise，await 起来跟原生一样的写法；
 * - toast 是右下角非阻塞通知，适合替代 window.alert 的"成功了"类型用法。
 */
import { reactive, ref } from 'vue'

export type DialogVariant = 'info' | 'success' | 'warn' | 'danger'

interface DialogState {
  open: boolean
  kind: 'confirm' | 'alert' | 'prompt'
  variant: DialogVariant
  title: string
  message: string
  confirmText: string
  cancelText: string
  /** prompt 用：默认值 + 占位符 + 返回结果 */
  promptValue: string
  promptPlaceholder: string
  resolve: (v: unknown) => void
}

export const dialogState = reactive<DialogState>({
  open: false,
  kind: 'alert',
  variant: 'info',
  title: '',
  message: '',
  confirmText: '',
  cancelText: '',
  promptValue: '',
  promptPlaceholder: '',
  resolve: () => {},
})

function open(opts: Partial<DialogState>, kind: DialogState['kind']): Promise<unknown> {
  return new Promise((resolve) => {
    Object.assign(dialogState, {
      title: '',
      message: '',
      variant: 'info',
      confirmText: '',
      cancelText: '',
      promptValue: '',
      promptPlaceholder: '',
      ...opts,
      open: true,
      kind,
      resolve,
    })
  })
}

/** 替代 window.confirm：danger 变体用于「删除/截断」这种破坏性操作。 */
export function confirm(opts: {
  title?: string
  message: string
  variant?: DialogVariant
  confirmText?: string
  cancelText?: string
}): Promise<boolean> {
  return open({ ...opts, variant: opts.variant ?? 'warn' }, 'confirm') as Promise<boolean>
}

/** 替代 window.alert：单 OK 按钮；danger 变体红色。 */
export function alert(opts: {
  title?: string
  message: string
  variant?: DialogVariant
  confirmText?: string
}): Promise<void> {
  return open({ ...opts, variant: opts.variant ?? 'info' }, 'alert') as Promise<void>
}

/** 替代 window.prompt：取消返回 null。 */
export function prompt(opts: {
  title?: string
  message: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}): Promise<string | null> {
  return open(
    {
      ...opts,
      promptValue: opts.defaultValue ?? '',
      promptPlaceholder: opts.placeholder ?? '',
    },
    'prompt',
  ) as Promise<string | null>
}

// ── Toast 非阻塞通知 ──────────────────────────────────────────────
export interface ToastItem {
  id: number
  variant: DialogVariant
  message: string
  /** 自动消失的毫秒数；0 = 不自动关 */
  durationMs: number
}
export const toasts = ref<ToastItem[]>([])
let toastSeq = 0

function pushToast(variant: DialogVariant, message: string, durationMs = 3000): void {
  const id = ++toastSeq
  toasts.value.push({ id, variant, message, durationMs })
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
}
export function dismissToast(id: number): void {
  const i = toasts.value.findIndex((t) => t.id === id)
  if (i >= 0) toasts.value.splice(i, 1)
}
export const toast = {
  info: (message: string, durationMs?: number) => pushToast('info', message, durationMs),
  success: (message: string, durationMs?: number) => pushToast('success', message, durationMs),
  warn: (message: string, durationMs?: number) => pushToast('warn', message, durationMs),
  error: (message: string, durationMs = 6000) => pushToast('danger', message, durationMs),
}
