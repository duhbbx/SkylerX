/**
 * Monaco 0.52 的国际化机制：
 *   - `monaco-editor/esm/vs/nls.messages.js` 暴露 `getNLSMessages()`，直接读 `globalThis._VSCODE_NLS_MESSAGES`；
 *   - `nls.js` 的 `localize(idx, fallback)` 调用时按 idx 查表，未命中即用 fallback（英文原文）。
 *
 * 因此「让 Monaco 内置菜单（剪切/复制/查找/转大小写/...）说中文」不需要 monaco-editor-nls 构建插件，
 * 只需在任何 monaco-editor 模块被求值前往这个全局上塞翻译数组即可。
 *
 * 翻译数据由 monaco-editor 包内置（`dev/vs/nls.messages.<lang>.js`）；
 * 文件是 AMD `define([], function () { globalThis._VSCODE_NLS_MESSAGES = [...] });` 结构，
 * Vite `?raw` 读源码后剥掉外层 AMD 包装、把内部赋值代码 `new Function` 跑一遍，即可生效。
 *
 * 切换语言中途：已渲染的编辑器实例上「label 已被缓存的内置菜单项」不会重新国际化；
 * 应用层会在 setLocale 时给用户提示「需要刷新窗口」。新打开的查询页会立刻按新语言生效。
 */
import zhCnRaw from 'monaco-editor/dev/vs/nls.messages.zh-cn.js?raw'

interface NlsGlobal {
  _VSCODE_NLS_MESSAGES?: (string | null)[]
  _VSCODE_NLS_LANGUAGE?: string
}
const G = globalThis as unknown as NlsGlobal

function execNlsBundle(rawSrc: string): void {
  // AMD 包装去壳：define([], function () { … });
  const inner = rawSrc
    .replace(/^[\s\S]*?define\(\[\],\s*function\s*\(\)\s*\{/, '')
    .replace(/\}\)\s*;?\s*$/, '')
  // 内部第一句即 globalThis._VSCODE_NLS_MESSAGES=[…]
  // 用独立 Function 作用域执行，避免污染本模块作用域里的标识符。
  new Function(inner)()
}

function loadZhCn(): void {
  execNlsBundle(zhCnRaw)
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

// 模块装载即根据 localStorage 中保存的语言决定 NLS。
// 这里直接读 storage 而不 import './i18n'，避免与 monaco-setup 之间产生循环依赖。
try {
  const saved =
    (typeof localStorage !== 'undefined' && localStorage.getItem('skylerx.locale')) ||
    (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en')
  applyMonacoLocale(saved === 'zh' ? 'zh' : 'en')
} catch {
  /* SSR / 测试环境无 localStorage：让 monaco 走英文 fallback */
}
