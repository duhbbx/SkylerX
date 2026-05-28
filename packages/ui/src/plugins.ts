import type { TreeAction } from './components/tree-actions'
import type { Snippet } from './snippets'

/**
 * 轻量插件注册中心：在应用启动期间，扩展插件可向此追加：
 *  - 自定义右键动作（追加到 TREE_ACTIONS 之后；同一菜单中显示）
 *  - 自定义内置 SQL 片段（追加到 snippets 之后，但不持久化到 localStorage）
 *
 * 设计目标：
 *  - 仅约束 *扩展点*，不引入运行时加载机制（沙箱 / 远程包暂不在范围）；
 *  - 由桌面端外壳决定如何调用 `register*`（脚本式或本地包式注入）；
 *  - 与既有 EnterpriseRegistry 思路一致：不改变核心，只 *追加* 行为。
 *
 * 用法（例）：
 * ```ts
 * import { registerTreeAction } from '@db-tool/ui'
 * registerTreeAction({
 *   id: 'my:export-json',
 *   label: '导出 JSON',
 *   kinds: [MetaNodeKind.Table],
 *   run: ({ node, connId, ctrl }) => { ... },
 * })
 * ```
 */

const extraTreeActions: TreeAction[] = []
type ReadonlySnippet = Omit<Snippet, 'id' | 'createdAt'> & { id?: string }
const extraSnippets: ReadonlySnippet[] = []

export function registerTreeAction(action: TreeAction): () => void {
  extraTreeActions.push(action)
  return () => {
    const i = extraTreeActions.indexOf(action)
    if (i >= 0) extraTreeActions.splice(i, 1)
  }
}
export function pluginTreeActions(): TreeAction[] {
  return extraTreeActions
}

export function registerBuiltinSnippet(s: ReadonlySnippet): () => void {
  extraSnippets.push(s)
  return () => {
    const i = extraSnippets.indexOf(s)
    if (i >= 0) extraSnippets.splice(i, 1)
  }
}
export function pluginBuiltinSnippets(): ReadonlySnippet[] {
  return extraSnippets
}
