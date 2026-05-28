import { MetaNodeKind } from '@db-tool/shared-types'
import type { TreeController } from './tree-controller'
import type { TreeNode } from './treeNode'

/** 动作执行上下文：当前节点 + 所属连接 + 控制器。 */
export interface NodeActionContext {
  node: TreeNode
  connId: string
  ctrl: TreeController
}

/** 一条右键菜单动作。kinds 声明适用的节点类型，菜单据此数据驱动地过滤。 */
export interface TreeAction {
  id: string
  label: string
  kinds: MetaNodeKind[]
  danger?: boolean
  /** 进一步的可用性判定（如表必须有 sqlName） */
  enabled?: (node: TreeNode) => boolean
  run: (ctx: NodeActionContext) => void
}

/**
 * 声明式动作目录。新增节点操作只需在此加一条，无需改组件；
 * 将来企业插件也可向此追加动作（同 EnterpriseRegistry 思路）。
 */
export const TREE_ACTIONS: TreeAction[] = [
  {
    id: 'new-query',
    label: '新建查询',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.newQuery(node, connId),
  },
  {
    id: 'select-200',
    label: '查询前 200 行',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.previewTable(node, connId),
  },
  {
    id: 'view-structure',
    label: '查看结构',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    run: ({ node, connId, ctrl }) => ctrl.viewStructure(node, connId),
  },
  {
    id: 'gen-select',
    label: '生成 SELECT',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('select', node, connId),
  },
  {
    id: 'gen-insert',
    label: '生成 INSERT',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('insert', node, connId),
  },
  {
    id: 'gen-update',
    label: '生成 UPDATE',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('update', node, connId),
  },
  {
    id: 'gen-delete',
    label: '生成 DELETE',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('delete', node, connId),
  },
  {
    id: 'copy-structure',
    label: '复制表结构 (CREATE LIKE)',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createlike', node, connId),
  },
  {
    id: 'create-index',
    label: '新建索引',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createindex', node, connId),
  },
  {
    id: 'edit-comment',
    label: '编辑注释',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('comment', node, connId),
  },
  {
    id: 'edit-object',
    label: '编辑定义',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.editObject(node, connId),
  },
  {
    id: 'copy-object-ddl',
    label: '复制 DDL',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.copyObjectDdl(node, connId),
  },
  {
    id: 'view-definition',
    label: '查看定义',
    kinds: [MetaNodeKind.Trigger, MetaNodeKind.Sequence],
    run: ({ node, connId, ctrl }) => ctrl.viewDefinition(node, connId),
  },
  {
    id: 'design-table',
    label: '设计表',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.designTable(node, connId),
  },
  {
    id: 'table-stats',
    label: '统计信息',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.tableStats(node, connId),
  },
  {
    id: 'mock-data',
    label: '生成测试数据',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateMockData(node, connId),
  },
  {
    id: 'deps',
    label: '依赖关系（外键）',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.viewDependencies(node, connId),
  },
  {
    id: 'copy-ddl',
    label: '复制建表语句',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyDdl(node, connId),
  },
  {
    id: 'toggle-favorite',
    label: '收藏 / 取消收藏',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.toggleFavorite(node, connId),
  },
  {
    id: 'import-data',
    label: '导入数据（CSV）',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.importData(node, connId),
  },
  {
    id: 'export-sql',
    label: '导出为 SQL（结构+数据）',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.exportSql(node, connId),
  },
  {
    id: 'transfer-data',
    label: '数据传输（复制到…）',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.transferData(node, connId),
  },
  {
    id: 'new-table',
    label: '新建表',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'tables',
    run: ({ node, connId, ctrl }) => ctrl.createObject('table', node, connId),
  },
  {
    id: 'new-view',
    label: '新建视图',
    kinds: [MetaNodeKind.Group, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'views',
    run: ({ node, connId, ctrl }) => ctrl.createObject('view', node, connId),
  },
  {
    id: 'new-function',
    label: '新建函数',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Function],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'functions',
    run: ({ node, connId, ctrl }) => ctrl.createObject('function', node, connId),
  },
  {
    id: 'new-procedure',
    label: '新建存储过程',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Procedure],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'procedures',
    run: ({ node, connId, ctrl }) => ctrl.createObject('procedure', node, connId),
  },
  {
    id: 'erd',
    label: 'ER 图',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.openErd(node, connId),
  },
  {
    id: 'export-schema-sql',
    label: '导出库为 SQL（结构+数据）',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.exportSchemaSql(node, connId),
  },
  {
    id: 'data-dict',
    label: '生成数据字典（Markdown）',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDict(node, connId),
  },
  {
    id: 'data-dict-html',
    label: '生成数据字典（HTML）',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDictHtml(node, connId),
  },
  {
    id: 'refresh',
    label: '刷新',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema, MetaNodeKind.Group],
    run: ({ node, connId, ctrl }) => ctrl.refreshNode(node, connId),
  },
  {
    id: 'copy-qualified',
    label: '复制限定名',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, ctrl }) => ctrl.copyText(node.sqlName ?? node.name),
  },
  {
    id: 'copy-name',
    label: '复制名称',
    kinds: [
      MetaNodeKind.Database,
      MetaNodeKind.Schema,
      MetaNodeKind.Table,
      MetaNodeKind.View,
      MetaNodeKind.Column,
      MetaNodeKind.Function,
      MetaNodeKind.Procedure,
    ],
    run: ({ node, ctrl }) => ctrl.copyText(node.name),
  },
  {
    id: 'drop-object',
    label: '删除',
    kinds: [
      MetaNodeKind.Table,
      MetaNodeKind.View,
      MetaNodeKind.Function,
      MetaNodeKind.Procedure,
      MetaNodeKind.Sequence,
      MetaNodeKind.Trigger,
      MetaNodeKind.Event,
      MetaNodeKind.Database,
      MetaNodeKind.Schema,
    ],
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.dropObject(node, connId),
  },
  {
    id: 'edit-conn',
    label: '编辑连接',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.editConnection(connId),
  },
  {
    id: 'del-conn',
    label: '删除连接',
    kinds: [MetaNodeKind.Connection],
    danger: true,
    run: ({ connId, ctrl }) => ctrl.deleteConnection(connId),
  },
]

/** 取某节点适用的动作列表。 */
export function actionsFor(node: TreeNode): TreeAction[] {
  return TREE_ACTIONS.filter((a) => a.kinds.includes(node.kind) && (!a.enabled || a.enabled(node)))
}
