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
import type { ChatErrorAskEvent } from './chat-bus'
import type { Callsite } from './errorReporter'

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
  /**
   * prompt 用:可选验证器。点 OK 时执行,返回非空字符串则不关闭弹框、
   * 在输入框下方渲染该字符串(红字)。返回 null/undefined 视为通过。
   * 让"分组已存在""名称非法"这类错误能在 prompt 内联反馈,
   * 而不是关掉再弹 toast。
   */
  promptValidator: ((value: string) => string | null | undefined) | null
  /** prompt 用:当前 inline 错误文本 (由 validator 写入) */
  promptError: string | null
  /** prompt 用:可选下拉候选(渲染为 datalist)→ 输入框变 combobox,可选已有项或手输新值 */
  promptOptions: string[] | null
  /**
   * alert 专用:若提供则在 OK 按钮左侧渲染「✨ 问 AI」按钮,
   * 点击后 emit ChatErrorAskEvent + 关闭弹框。null/undefined = 不显示。
   */
  askAi: ChatErrorAskEvent | null
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
  promptValidator: null,
  promptError: null,
  promptOptions: null,
  askAi: null,
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
      promptValidator: null,
      promptError: null,
      promptOptions: null,
      askAi: null,
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

/**
 * 替代 window.alert：单 OK 按钮；danger 变体红色。
 *
 * 传入 askAi 时,弹框左下角追加「✨ 问 AI」按钮,点击后把上下文(SQL、错误、
 * 错误码、连接信息)发送到右侧 AI 聊天面板自动开聊;点击同时关闭弹框,
 * Promise resolve(undefined) 跟点 OK 同效果。
 */
export function alert(opts: {
  title?: string
  message: string
  variant?: DialogVariant
  confirmText?: string
  askAi?: ChatErrorAskEvent
}): Promise<void> {
  return open({ ...opts, variant: opts.variant ?? 'info' }, 'alert') as Promise<void>
}

/**
 * 替代 window.prompt：取消返回 null。
 *
 * `validator` 可选：点 OK 时同步执行,返回非空字符串视为"未通过",
 * 弹框不关闭、错误以红字显示在输入框下方;返回 null/undefined 视为通过、
 * 弹框关闭、Promise resolve(当前 value)。
 *
 * 不传 `validator` 时行为跟原来一样,所有现有调用点零侵入。
 */
export function prompt(opts: {
  title?: string
  message: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  validator?: (value: string) => string | null | undefined
  /** 下拉候选:输入框变 combobox(datalist),可选已有项或手输新值。 */
  options?: string[]
}): Promise<string | null> {
  return open(
    {
      ...opts,
      promptValue: opts.defaultValue ?? '',
      promptPlaceholder: opts.placeholder ?? '',
      promptValidator: opts.validator ?? null,
      promptOptions: opts.options ?? null,
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
  /**
   * 错误类 toast 可附带一组上下文 → toast 上会出现"✨ 问 AI"按钮,
   * 点击通过 chat-bus 把上下文丢给 AiChatPanel.askAboutError(预填+自动发送)。
   * 仅 danger toast 显示按钮(其他变体没意义)。
   */
  askAi?: ChatErrorAskEvent
  /** Error toasts only: the call site that triggered reportError(). */
  callsite?: Callsite
  /** Error toasts only: the full report — copy button writes report.markdown. */
  report?: {
    markdown: string
  }
}
export const toasts = ref<ToastItem[]>([])
let toastSeq = 0

function pushToast(
  variant: DialogVariant,
  message: string,
  durationMs = 3000,
  askAi?: ChatErrorAskEvent,
  extras?: { callsite?: ToastItem['callsite']; report?: ToastItem['report'] },
): void {
  const id = ++toastSeq
  toasts.value.push({ id, variant, message, durationMs, askAi, ...extras })
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs)
  }
}

/**
 * Public push for reportError(): exposes the shared toast ID counter + the
 * setTimeout-based auto-dismiss to callers outside this module, so error
 * reports honour their durationMs AND don't collide IDs with regular toasts.
 */
export function pushReportToast(
  message: string,
  durationMs: number,
  extras: { callsite?: ToastItem['callsite']; report?: ToastItem['report'] },
): void {
  pushToast('danger', message, durationMs, undefined, extras)
}

// ── Error modal (always-blocking error report dialog) ──────────────────
// Per user direction: every reportError() now opens a modal instead of a
// toast — the modal shows message + callsite + stack + args + env, with
// dedicated "copy stack" / "copy env" / "copy all (markdown)" buttons,
// so issue triage gets the full report without the toast disappearing.
// Toasts (info/success/warn) still exist for non-error notifications.
export interface ErrorModalData {
  message: string
  callsite?: { file: string; function?: string; line?: number }
  stack?: string
  tag?: string
  args?: Record<string, unknown>
  /** Pre-rendered '## Environment' markdown block. */
  envBlock: string
  /** Full markdown report (everything; what the old toast 📋 wrote). */
  fullMarkdown: string
  timestamp: string
}
interface ErrorModalState {
  open: boolean
  data: ErrorModalData | null
}
export const errorModal = reactive<ErrorModalState>({ open: false, data: null })

/** Replace any in-flight error with this one (newest wins; queueing risks
 *  trapping the user in a stream of modals). */
export function pushErrorModal(data: ErrorModalData): void {
  errorModal.data = data
  errorModal.open = true
}
export function dismissErrorModal(): void {
  errorModal.open = false
  // Keep .data around briefly so transition animations don't see null. */
}
export function dismissToast(id: number): void {
  const i = toasts.value.findIndex((t) => t.id === id)
  if (i >= 0) toasts.value.splice(i, 1)
}
export const toast = {
  info: (message: string, durationMs?: number) => pushToast('info', message, durationMs),
  success: (message: string, durationMs?: number) => pushToast('success', message, durationMs),
  warn: (message: string, durationMs?: number) => pushToast('warn', message, durationMs),
  /**
   * 错误 toast。第二个参数支持两种形态(向后兼容):
   *  - 数字 → 旧 API,作为 durationMs
   *  - 对象 → 新 API,可以带 askAi 上下文(toast 上出现"✨ 问 AI"按钮)
   *
   * 用户报告:之前错误 toast 点一下就消失,想复制错误信息来不及。
   * 现在:
   *  - 带 askAi 的错误 toast 默认 durationMs=0(不自动消失,只能手动 ×)
   *  - 所有错误 toast 都额外展示"复制错误"按钮
   *  - toast 主体不再点击消失(避免误关丢失错误)
   */
  error(message: string, opts?: number | { durationMs?: number; askAi?: ChatErrorAskEvent }): void {
    if (typeof opts === 'number') {
      pushToast('danger', message, opts)
    } else if (opts) {
      // 带 askAi 默认持久(durationMs=0),给用户充足时间复制 / 问 AI / 阅读
      const dur = opts.durationMs ?? (opts.askAi ? 0 : 6000)
      pushToast('danger', message, dur, opts.askAi)
    } else {
      pushToast('danger', message, 6000)
    }
  },
}
