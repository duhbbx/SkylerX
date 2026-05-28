import { MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'

/** UI 侧的树节点：元数据 + 展开/加载状态 + 已取子节点。 */
export interface TreeNode {
  kind: MetaNodeKind
  name: string
  path: string[]
  group?: string
  count?: number
  sqlName?: string
  hasChildren: boolean
  detail?: MetadataNode['detail']
  expanded: boolean
  loading: boolean
  error: string | null
  children: TreeNode[] | null
  /** 父节点（懒加载时回填，用于新建表后刷新所属"表"目录） */
  parent?: TreeNode
}

export function fromMetadata(n: MetadataNode): TreeNode {
  return {
    kind: n.kind,
    name: n.name,
    path: n.path,
    group: n.group,
    count: n.count,
    sqlName: n.sqlName,
    hasChildren: n.hasChildren ?? false,
    detail: n.detail,
    expanded: false,
    loading: false,
    error: null,
    children: null,
  }
}

/** 连接根节点（树的顶层，名字 = 连接名）。 */
export function rootNode(connName: string): TreeNode {
  return {
    kind: MetaNodeKind.Connection,
    name: connName,
    path: [],
    hasChildren: true,
    expanded: false,
    loading: false,
    error: null,
    children: null,
  }
}

/** 节点图标（按类型，列节点主键用钥匙）。 */
export function iconFor(node: TreeNode): string {
  switch (node.kind) {
    case MetaNodeKind.Connection:
      return '🔌'
    case MetaNodeKind.Database:
      return '🗄'
    case MetaNodeKind.Schema:
      return '📂'
    case MetaNodeKind.Group:
      return '📁'
    case MetaNodeKind.Table:
      return '▦'
    case MetaNodeKind.View:
      return '◫'
    case MetaNodeKind.Function:
      return 'ƒ'
    case MetaNodeKind.Procedure:
      return '⚙'
    case MetaNodeKind.Index:
      return '⊟'
    case MetaNodeKind.Trigger:
      return '⚡'
    case MetaNodeKind.Sequence:
      return '#'
    case MetaNodeKind.Event:
      return '⏱'
    case MetaNodeKind.Column:
      return node.detail?.primaryKey ? '🔑' : '·'
    default:
      return '·'
  }
}
