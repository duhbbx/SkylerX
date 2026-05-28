/*
 * 替代 `monaco-editor/esm/vs/nls.js` 的 shim（通过 Vite 自定义插件 resolveId 注入）。
 *
 *   - 数字 idx → 走 _VSCODE_NLS_MESSAGES 查表；
 *   - 字符串 key / { key, comment } 对象 key → 用「英文 fallback → 中文」字典查；
 *   - 其它情况 → 原样英文 fallback。
 *
 * 重要：shim 自己负责把翻译数组与语言标签塞进 `globalThis`（如果还没设的话），
 * 这样在 Monaco Worker 等独立 globalThis 上下文中（bootstrap 模块没在那里执行过）
 * 仍能正确工作。
 */
// monaco-editor 内部模块，未在 package exports 暴露类型；运行时是 ESM 文件存在的。
// @ts-expect-error monaco-editor internal subpath
import { getNLSLanguage, getNLSMessages } from 'monaco-editor/esm/vs/nls.messages.js'
import { ZH_CN_MESSAGES } from './monaco-nls-zh-cn'
import { ZH_CN_FALLBACK_MAP } from './monaco-nls-zh-cn-fallback-map'

export { getNLSLanguage, getNLSMessages }

interface NlsGlobal {
  _VSCODE_NLS_MESSAGES?: (string | null)[]
  _VSCODE_NLS_LANGUAGE?: string
  _SKYLERX_NLS_DISABLED?: boolean
}
const G = globalThis as unknown as NlsGlobal

// 在任何上下文（主线程 / worker）里：如果当前还没装 NLS 翻译，shim 自己装上。
// 主线程的 bootstrap 模块也会装，重复装也是同样的值，无害。
if (!G._VSCODE_NLS_MESSAGES) {
  G._VSCODE_NLS_MESSAGES = ZH_CN_MESSAGES
  G._VSCODE_NLS_LANGUAGE = 'zh-cn'
}

// 用户在 i18n.setLocale('en') 后会把 _SKYLERX_NLS_DISABLED 置 true，shim 据此让所有字符串 key 走英文 fallback。
function fallbackMapEnabled(): boolean {
  return G._SKYLERX_NLS_DISABLED !== true
}

function format(message: string, args: unknown[]): string {
  if (!args.length) return message
  return message.replace(/\{(\d+)\}/g, (m, n) => {
    const a = args[+n]
    if (typeof a === 'string') return a
    if (typeof a === 'number' || typeof a === 'boolean') return String(a)
    if (a == null) return String(a)
    return m
  })
}

function lookupByIndex(idx: number, fallback: string): string {
  const msgs = getNLSMessages()
  const m = msgs?.[idx]
  return typeof m === 'string' ? m : fallback
}

function lookupByFallback(fallback: string): string | undefined {
  if (!fallbackMapEnabled()) return undefined
  return ZH_CN_FALLBACK_MAP[fallback]
}

// 调试：所有 localize 调用全打印（不截断）；对 Cut/Copy/Paste 等高亮关键 key 单独 warn
function _dlog(data: unknown, message: string, zh: string | undefined): void {
  if (typeof console === 'undefined') return
  const critical = /^(Cut|Copy|Paste|Change All Occurrences|Command Palette|Open Command Palette|Find|Replace)$/.test(message)
  if (critical) {
    // biome-ignore lint/suspicious/noConsole: 启动诊断
    console.warn(`[shim.localize CRITICAL] msg=${JSON.stringify(message)} lang=${getNLSLanguage()} zh=${JSON.stringify(zh)} data=${JSON.stringify(data)}`)
  }
}

export function localize(data: unknown, message: string, ...args: unknown[]): string {
  if (typeof data === 'number') return format(lookupByIndex(data, message), args)
  const zh = lookupByFallback(message)
  _dlog(data, message, zh)
  return format(zh ?? message, args)
}

export function localize2(
  data: unknown,
  message: string,
  ...args: unknown[]
): { value: string; original: string } {
  const resolved =
    typeof data === 'number' ? lookupByIndex(data, message) : (lookupByFallback(message) ?? message)
  const value = format(resolved, args)
  return { value, original: resolved === message ? value : format(message, args) }
}

if (typeof console !== 'undefined') {
  // biome-ignore lint/suspicious/noConsole: 启动诊断 —— 验证 alias 真的把 nls.js 换成了我们的 shim
  console.warn(
    '[skylerx monaco-nls-shim] LOADED · lang =',
    getNLSLanguage(),
    '· msgCount =',
    getNLSMessages()?.length ?? 0,
  )
}
