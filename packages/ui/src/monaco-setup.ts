/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
// 必须在导入 monaco-editor 之前先装好翻译数组：
// monaco 的 nls.js 是惰性查表（每次 localize() 时从 globalThis._VSCODE_NLS_MESSAGES 读），
// 但 *某些* action label / 命令描述会在 monaco 模块装载时就求值缓存，
// 所以保险起见把这个 import 放在第一行，让它的副作用最先发生。
import './monaco-nls'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

// SQL 走 monaco 的 basic-languages，无需专用 language worker，editor.worker 足矣。
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

// ── SQL 自动补全 ──
// 全局只注册一个 provider，按编辑器 model 委派到各自的数据源（连接的表/列元数据）。
export interface Suggestion {
  label: string
  insertText?: string
  detail?: string
  kind: 'keyword' | 'table' | 'column' | 'schema' | 'function' | 'snippet'
}
type CompletionSource = (ctx: {
  text: string
  word: string
  before: string
}) => Promise<Suggestion[]> | Suggestion[]

const sources = new Map<monaco.editor.ITextModel, CompletionSource>()
export function setCompletionSource(model: monaco.editor.ITextModel, fn: CompletionSource): void {
  sources.set(model, fn)
}
export function clearCompletionSource(model: monaco.editor.ITextModel): void {
  sources.delete(model)
}

const KIND_MAP: Record<Suggestion['kind'], monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  table: monaco.languages.CompletionItemKind.Struct,
  column: monaco.languages.CompletionItemKind.Field,
  schema: monaco.languages.CompletionItemKind.Module,
  function: monaco.languages.CompletionItemKind.Function,
  snippet: monaco.languages.CompletionItemKind.Snippet,
}

monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' '],
  async provideCompletionItems(model, position) {
    const src = sources.get(model)
    if (!src) return { suggestions: [] }
    const w = model.getWordUntilPosition(position)
    const range = new monaco.Range(
      position.lineNumber,
      w.startColumn,
      position.lineNumber,
      w.endColumn,
    )
    const before = model.getValueInRange(
      new monaco.Range(1, 1, position.lineNumber, position.column),
    )
    const items = await src({ text: model.getValue(), word: w.word, before })
    return {
      suggestions: items.map((s) => ({
        label: s.label,
        kind: KIND_MAP[s.kind],
        insertText: s.insertText ?? s.label,
        detail: s.detail,
        range,
      })),
    }
  },
})

export { monaco }
