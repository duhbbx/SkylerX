/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Monaco 国际化（接管路径）：
 *
 *   - monaco-editor/esm 源码里所有 `localize('keyStr', 'Fallback')` 是字符串 key 形态，
 *     原版 nls.js 对字符串 key 不查表只回退；
 *   - 我们在 Vite resolve.alias 里把 `monaco-editor/esm/vs/nls.js` 整体重定向到
 *     `vendor/monaco-nls-shim.ts`，由 shim 同时支持数字 idx + 英文 fallback 两条查表路径；
 *   - 本文件只负责：① 启动时按 localStorage 中保存的语言把 `_VSCODE_NLS_MESSAGES`
 *     与 `_VSCODE_NLS_LANGUAGE` 设到 globalThis（shim 的字符串 key 路径要靠
 *     getNLSLanguage()==='zh-cn' 来判定才启用 fallback map）；
 *     ② 通过 i18n.setLocale 在运行时切换语言时，更新这两个全局变量
 *     （已渲染的编辑器内置菜单缓存需要刷新窗口才会完整跟上，setLocale 会问要不要刷新）。
 *
 * 不再 monkey-patch nls.localize：ESM 导出是不可重新定义的属性
 * （Object.defineProperty 会抛 "Cannot redefine property: localize"）。alias 才是正解。
 */
import { ZH_CN_MESSAGES } from './vendor/monaco-nls-zh-cn'

interface NlsGlobal {
  _VSCODE_NLS_MESSAGES?: (string | null)[]
  _VSCODE_NLS_LANGUAGE?: string
  /** shim 检查的"显式英文模式"标记：true 时所有字符串 key 走英文 fallback。 */
  _SKYLERX_NLS_DISABLED?: boolean
}
const G = globalThis as unknown as NlsGlobal

function loadZhCn(): void {
  G._VSCODE_NLS_MESSAGES = ZH_CN_MESSAGES
  G._VSCODE_NLS_LANGUAGE = 'zh-cn'
  G._SKYLERX_NLS_DISABLED = false
}

function clearLocale(): void {
  G._VSCODE_NLS_MESSAGES = undefined
  G._VSCODE_NLS_LANGUAGE = 'en'
  G._SKYLERX_NLS_DISABLED = true
}

/** 按 i18n 当前语言切换 Monaco NLS 状态（shim 通过 getNLSLanguage() 判断是否走中文 fallback）。 */
export function applyMonacoLocale(locale: 'zh' | 'en'): void {
  if (locale === 'zh') {
    if (G._VSCODE_NLS_LANGUAGE !== 'zh-cn') loadZhCn()
  } else {
    if (G._VSCODE_NLS_LANGUAGE !== 'en') clearLocale()
  }
}

// 模块装载即按 localStorage 中保存的语言决定 NLS。默认与 i18n.detect 对齐。
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('skylerx.locale') : null
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  let pick: 'zh' | 'en'
  if (saved === 'zh' || saved === 'en') pick = saved
  else pick = /^zh/i.test(nav) ? 'zh' : 'en'
  applyMonacoLocale(pick)
  if (typeof console !== 'undefined') {
    console.log('[skylerx monaco-nls] init', {
      saved,
      nav,
      pick,
      msgCount: G._VSCODE_NLS_MESSAGES?.length ?? 0,
    })
  }
} catch (e) {
  if (typeof console !== 'undefined') {
    console.error('[skylerx monaco-nls] init failed:', e)
  }
}
