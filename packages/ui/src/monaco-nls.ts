/**
 * Monaco 0.52 的国际化机制：
 *   - `monaco-editor/esm/vs/nls.messages.js` 的 `getNLSMessages()` 直接读 `globalThis._VSCODE_NLS_MESSAGES`；
 *   - `nls.js` 的 `localize(idx, fallback)` 调用时按 idx 查表，未命中即用 fallback（英文原文）。
 *
 * 所以只需在 monaco-editor 模块求值前往这个全局塞翻译数组，内置菜单就自动用中文，
 * 不需要 monaco-editor-nls 这种构建期插件。
 *
 * 翻译数据原本散落在 `monaco-editor/dev/vs/nls.messages.zh-cn.js`（AMD 包装的字面量数组）。
 * 我们用脚本一次性抽出来固化到 `./vendor/monaco-nls-zh-cn.ts`，避免 Vite `?raw` 跨 node_modules
 * 这条不一定稳的路径，也省掉运行时 `new Function` 的副作用。
 */
import { ZH_CN_MESSAGES } from './vendor/monaco-nls-zh-cn'

interface NlsGlobal {
  _VSCODE_NLS_MESSAGES?: (string | null)[]
  _VSCODE_NLS_LANGUAGE?: string
}
const G = globalThis as unknown as NlsGlobal

function loadZhCn(): void {
  G._VSCODE_NLS_MESSAGES = ZH_CN_MESSAGES
  G._VSCODE_NLS_LANGUAGE = 'zh-cn'
}

function clearLocale(): void {
  G._VSCODE_NLS_MESSAGES = undefined
  G._VSCODE_NLS_LANGUAGE = 'en'
}

/** 按 i18n 当前语言切换 Monaco NLS。zh → 加载中文翻译；en → 清空让 fallback 用英文原文。 */
export function applyMonacoLocale(locale: 'zh' | 'en'): void {
  if (locale === 'zh') {
    if (G._VSCODE_NLS_LANGUAGE !== 'zh-cn') loadZhCn()
  } else {
    if (G._VSCODE_NLS_LANGUAGE !== 'en') clearLocale()
  }
}

// 模块装载即按 localStorage 中的语言决定 NLS。直接读 storage 避免与 monaco-setup 之间产生循环依赖。
// 默认与 i18n.detect() 对齐：保存值优先；否则按 navigator.language 是否 zh-* 决定，否则英文。
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('skylerx.locale') : null
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  let pick: 'zh' | 'en'
  if (saved === 'zh' || saved === 'en') pick = saved
  else pick = /^zh/i.test(nav) ? 'zh' : 'en'
  applyMonacoLocale(pick)
  if (typeof console !== 'undefined') {
    // biome-ignore lint/suspicious/noConsole: 启动诊断（看一眼 NLS 真的装上了）
    console.log('[skylerx monaco-nls]', { saved, nav, pick, msgCount: G._VSCODE_NLS_MESSAGES?.length ?? 0 })
  }
} catch (e) {
  if (typeof console !== 'undefined') {
    // biome-ignore lint/suspicious/noConsole: 启动诊断
    console.error('[skylerx monaco-nls] init failed:', e)
  }
}
