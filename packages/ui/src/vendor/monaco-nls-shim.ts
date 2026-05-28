/*
 * 替代 `monaco-editor/esm/vs/nls.js` 的 shim（通过 Vite resolve.alias 注入）。
 *
 * 背景：Monaco 0.52 的 ESM 源码里所有内置菜单都是 `localize('keyStr', 'Fallback')` 字符串 key 形态，
 * 它原版 nls.js 的 localize 只对 *数字* key 走 `_VSCODE_NLS_MESSAGES` 查表，字符串 key 直接返回英文 fallback。
 * 我们在运行时 monkey-patch 这个导出失败（ESM 导出是不可重新定义的 getter，Object.defineProperty 抛
 * "Cannot redefine property: localize"）。
 *
 * 这里改成在 *resolver 层* 取代它：当 Monaco 内部 `import { localize } from '../nls.js'` 时拿到的就是
 * 我们的 shim。shim：
 *   - 数字 key → 走 _VSCODE_NLS_MESSAGES 查表（仍兼容数字索引形态）；
 *   - 字符串 key + 当前语言 zh-cn → 在 fallback→中文 字典里查；
 *   - 否则 → 原样返回英文 fallback。
 */
// monaco-editor 内部模块，未在 package exports 暴露类型；运行时是 ESM 文件存在的。
// @ts-expect-error monaco-editor internal subpath
import { getNLSLanguage, getNLSMessages } from 'monaco-editor/esm/vs/nls.messages.js'
import { ZH_CN_FALLBACK_MAP } from './monaco-nls-zh-cn-fallback-map'

export { getNLSLanguage, getNLSMessages }

if (typeof console !== 'undefined') {
  // biome-ignore lint/suspicious/noConsole: 启动诊断 —— 验证 alias 真的把 nls.js 换成了我们的 shim
  console.log('[skylerx monaco-nls-shim] loaded; lang =', getNLSLanguage(), 'msgs =', getNLSMessages()?.length ?? 0)
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
  if (getNLSLanguage() !== 'zh-cn') return undefined
  return ZH_CN_FALLBACK_MAP[fallback]
}

export function localize(data: unknown, message: string, ...args: unknown[]): string {
  if (typeof data === 'number') return format(lookupByIndex(data, message), args)
  const zh = lookupByFallback(message)
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
