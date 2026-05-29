/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * K1 自定义键盘快捷键
 *
 * 设计要点：
 *  - 内部统一用 `'CmdOrCtrl+Shift+K'` 这种字符串形态保存（OS 无关），运行时按平台映射；
 *    mac 上 `CmdOrCtrl` = ⌘，其它平台 = Ctrl。
 *  - DEFAULT_KEY_BINDINGS 是只读基线；用户改过的只存「覆盖项」到 settings.keyBindings，
 *    渲染/匹配时用 getBindings() 合并 → 减少存储垃圾，也便于「恢复默认」直接清空覆盖。
 *  - chordFromEvent() 用键盘事件 → 字符串：方便组件 `if (chordFromEvent(e) === bindings.run-sql)` 直接比对。
 *
 * 本模块「只」管描述与解析，不负责注册全局监听；调用方自己在合适时机比对并触发命令。
 */

/** mac 下 ⌘ 当 Cmd 用；其它平台 Ctrl 当 Cmd 用。仅取一次，SSR 安全。 */
const IS_MAC: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent ??
      '',
  )

/** 内置命令清单：键 = 命令 id，值 = 默认快捷键（`CmdOrCtrl` 字面量在渲染时按平台展开） */
export const DEFAULT_KEY_BINDINGS: Record<string, string> = {
  'run-sql': 'CmdOrCtrl+Enter',
  palette: 'CmdOrCtrl+K',
  'object-search': 'CmdOrCtrl+Shift+O',
  'ai-chat': 'CmdOrCtrl+Shift+L',
  'new-conn': 'CmdOrCtrl+N',
  'new-query': 'CmdOrCtrl+T',
  'close-tab': 'CmdOrCtrl+W',
  find: 'CmdOrCtrl+F',
  replace: 'CmdOrCtrl+H',
  'format-sql': 'CmdOrCtrl+Shift+F',
  'save-snippet': 'CmdOrCtrl+S',
  settings: 'CmdOrCtrl+,',
}

/** 命令在 UI 里的展示元数据：labelKey 走 i18n（参见 `kbd.cmd*`）。 */
export interface CommandMeta {
  id: string
  labelKey: string
}

export const COMMANDS: CommandMeta[] = [
  { id: 'run-sql', labelKey: 'kbd.cmdRunSql' },
  { id: 'palette', labelKey: 'kbd.cmdPalette' },
  { id: 'object-search', labelKey: 'kbd.cmdObjectSearch' },
  { id: 'ai-chat', labelKey: 'kbd.cmdAiChat' },
  { id: 'new-conn', labelKey: 'kbd.cmdNewConn' },
  { id: 'new-query', labelKey: 'kbd.cmdNewQuery' },
  { id: 'close-tab', labelKey: 'kbd.cmdCloseTab' },
  { id: 'find', labelKey: 'kbd.cmdFind' },
  { id: 'replace', labelKey: 'kbd.cmdReplace' },
  { id: 'format-sql', labelKey: 'kbd.cmdFormatSql' },
  { id: 'save-snippet', labelKey: 'kbd.cmdSaveSnippet' },
  { id: 'settings', labelKey: 'kbd.cmdSettings' },
]

/**
 * 把内部 `'CmdOrCtrl+Shift+K'` 渲染成给人看的形态：
 *   - mac → `⌘⇧K`（连排，符合系统菜单习惯）
 *   - 其它 → `Ctrl+Shift+K`（用 `+` 连接，更易读）
 *
 * 空串照原样返回（用于「未绑定」显示占位）。
 */
export function formatChord(chord: string): string {
  if (!chord) return ''
  const parts = chord.split('+')
  if (IS_MAC) {
    const sym: Record<string, string> = {
      CmdOrCtrl: '⌘',
      Cmd: '⌘',
      Meta: '⌘',
      Ctrl: '⌃',
      Control: '⌃',
      Shift: '⇧',
      Alt: '⌥',
      Option: '⌥',
      Enter: '↩',
      Escape: 'Esc',
      Backspace: '⌫',
      Delete: '⌦',
      Tab: '⇥',
      Space: '␣',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
    }
    return parts.map((p) => sym[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('')
  }
  const map: Record<string, string> = {
    CmdOrCtrl: 'Ctrl',
    Cmd: 'Win',
    Meta: 'Win',
  }
  return parts.map((p) => map[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join('+')
}

/**
 * 把键盘事件解析成 `'CmdOrCtrl+Shift+K'` 字符串。
 *
 * 规则：
 *  - 修饰键顺序固定为 CmdOrCtrl → Shift → Alt（保证两条 chord 字面量等价 ↔ 字符串等价）
 *  - 主键统一用 `e.key`，单字符字母强制大写，其它保持原样（`Enter` / `,` / `ArrowUp` 等）
 *  - 「裸修饰键」（按下 Shift 但还没按下别的键）返回空串：避免录制时把 Shift 当作 chord 提交
 */
export function chordFromEvent(e: KeyboardEvent): string {
  const k = e.key
  if (k === 'Meta' || k === 'Control' || k === 'Shift' || k === 'Alt') return ''
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CmdOrCtrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  // 主键：单字母统一大写；空格归一成 `Space`；其它原样
  let main = k
  if (main === ' ') main = 'Space'
  if (main.length === 1) main = main.toUpperCase()
  parts.push(main)
  return parts.join('+')
}

/**
 * 合并 DEFAULT_KEY_BINDINGS + 用户覆盖：
 *  - 用户值非空字符串 → 覆盖默认
 *  - 用户值是空串 → 视为「禁用此命令」，仍然保留 key（值 = ''）
 *  - 默认表里没有的命令也允许出现（前向兼容；未来加新命令不丢用户配置）
 */
export function getBindings(userOverrides: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_KEY_BINDINGS }
  for (const [id, chord] of Object.entries(userOverrides ?? {})) {
    merged[id] = chord
  }
  return merged
}
