/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI 行内补全（Monaco InlineCompletionsProvider，Copilot 风格 ghost text）。
 *
 *  - 节流：用户停顿 600ms 后才触发，避免每次按键打 LLM
 *  - 在飞请求会被新触发立即 cancel（AbortController）
 *  - 一次性返回（非流式）；模型回单行，控制在 ~100 token 内
 *  - Tab 接受、Esc/Backspace 取消（Monaco 内置行为）
 */
import type { DbDialect } from '@db-tool/shared-types'
import { askAiChat } from './ai'
import { settings } from './settings'

export interface AiInlineContext {
  dialect: DbDialect
  /** 可选：schema 提示（表/列摘要），拼到 prompt 里帮 AI 给更准的列名 */
  schemaHint?: string
}

export interface AiInlineOptions {
  getContext: () => AiInlineContext
  /** 总开关（false 时 provider 直接返回空，不打 LLM） */
  enabled: () => boolean
}

/** Monaco / editor 类型走 any：避免在通用文件里硬依赖 monaco 类型（编辑器在多个面板里有差异）。 */
// biome-ignore lint/suspicious/noExplicitAny: monaco 实例由调用方传入，避免循环依赖
type MonacoNs = any
// biome-ignore lint/suspicious/noExplicitAny: 同上
type Editor = any

const DEBOUNCE_MS = 600
const MAX_PREFIX = 2000

interface InProvider {
  dispose(): void
}

/**
 * 注册一次性的 inline completion provider。
 * 返回 dispose，调用方在 onUnmounted 里释放。
 *
 *  ── 节流策略 ──
 *  Monaco 的 provideInlineCompletions 每次按键都可能触发，我们用 debounce + AbortController：
 *    1. 进入后等 600ms（用户继续打字 → 旧 timer 清掉，重新计时）
 *    2. 实际打请求时给一个 AbortController；新触发时 abort 上一个
 *    3. 没有上下文 / provider 关闭 / prefix 太短 → 直接返回空，不打 LLM
 */
export function registerAiInlineCompletion(
  monaco: MonacoNs,
  _editor: Editor,
  opts: AiInlineOptions,
): InProvider {
  let pending: { timer: ReturnType<typeof setTimeout>; abort: AbortController } | null = null

  function clearPending(): void {
    if (!pending) return
    clearTimeout(pending.timer)
    pending.abort.abort()
    pending = null
  }

  const provider: {
    provideInlineCompletions(
      model: MonacoNs,
      position: MonacoNs,
      _ctx: MonacoNs,
      token: MonacoNs,
    ): Promise<{ items: { insertText: string; range: MonacoNs }[] }>
    freeInlineCompletions(): void
  } = {
    async provideInlineCompletions(model, position, _ctx, token) {
      if (!opts.enabled()) return { items: [] }
      // 取光标前文本（截断到 MAX_PREFIX，避免 prompt 爆炸）
      const fullPrefix: string = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const prefix = fullPrefix.length > MAX_PREFIX ? fullPrefix.slice(-MAX_PREFIX) : fullPrefix
      // 太短不打 LLM（基本啥都猜不准还浪费 quota）
      if (prefix.trim().length < 3) return { items: [] }

      // 防抖 + 可取消
      clearPending()
      const abort = new AbortController()
      // Monaco 自己的 cancellation token 链到 AbortController
      if (token?.onCancellationRequested) {
        token.onCancellationRequested(() => abort.abort())
      }

      const completion = await new Promise<string>((resolve) => {
        const timer = setTimeout(async () => {
          try {
            const ctx = opts.getContext()
            const text = await askAiChat({
              messages: [
                {
                  role: 'user',
                  content: buildPrompt(prefix, ctx),
                },
              ],
              dialect: ctx.dialect,
              extraSystem:
                '你是 SQL 行内补全引擎。只输出光标处后续的 SQL 文本片段，' +
                '最多 1 行，不要带代码块、不要解释、不要重复已有上文。' +
                '如果上下文不足以补全，输出空字符串。',
              signal: abort.signal,
            })
            resolve(sanitizeCompletion(text, prefix))
          } catch {
            // 静默：行内补全失败不打扰用户（不像聊天面板）
            resolve('')
          }
        }, DEBOUNCE_MS)
        pending = { timer, abort }
      })

      if (!completion || abort.signal.aborted) return { items: [] }

      const range = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      )
      return { items: [{ insertText: completion, range }] }
    },
    freeInlineCompletions(): void {
      /* 无 GC 资源 */
    },
  }

  const reg = monaco.languages.registerInlineCompletionsProvider('sql', provider)

  return {
    dispose(): void {
      clearPending()
      reg.dispose()
    },
  }
}

/** 构造给 LLM 的补全 prompt（短小精悍，省 token）。 */
function buildPrompt(prefix: string, ctx: AiInlineContext): string {
  const parts: string[] = []
  parts.push(`方言: ${ctx.dialect}`)
  if (ctx.schemaHint) parts.push(`Schema:\n${ctx.schemaHint}`)
  parts.push('SQL 上文（光标在末尾）:')
  parts.push(prefix)
  return parts.join('\n\n')
}

/** 收尾：剥掉 LLM 偶尔包的代码块、重复的上文、多余的换行/解释段。 */
function sanitizeCompletion(raw: string, prefix: string): string {
  let s = raw.trim()
  if (!s) return ''
  // 剥掉 ```sql ... ``` 围栏
  const fence = s.match(/```(?:sql)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 模型偶尔重复一遍上文：如果它以 prefix 的末尾片段开头，剪掉
  const tail = prefix.slice(-80).trimStart()
  if (tail && s.startsWith(tail)) s = s.slice(tail.length)
  // 只取第一行（行内补全的语义）
  const nl = s.indexOf('\n')
  if (nl >= 0) s = s.slice(0, nl)
  return s.trimEnd()
}

// TODO: 可选 settings.aiInlineEnabled 开关；当前先用 settings.enableCompletion 复用，
// 调用方在 enabled() 里读 settings 即可。第一版不为它加新 setting，避免 settings UI 改动扩散。
export function aiInlineDefaultEnabled(): boolean {
  // 与 SQL 自动补全共用总开关：用户关掉补全时不应再打 AI
  return settings.enableCompletion !== false
}
