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
  kind: 'keyword' | 'table' | 'column' | 'schema'
}
type CompletionSource = (ctx: { text: string; word: string }) => Promise<Suggestion[]> | Suggestion[]

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
}

monaco.languages.registerCompletionItemProvider('sql', {
  triggerCharacters: ['.', ' '],
  async provideCompletionItems(model, position) {
    const src = sources.get(model)
    if (!src) return { suggestions: [] }
    const w = model.getWordUntilPosition(position)
    const range = new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn)
    const items = await src({ text: model.getValue(), word: w.word })
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
