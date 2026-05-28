import { MetaNodeKind } from '@db-tool/shared-types'
import { pluginTreeActions } from '../plugins'
import type { TreeController } from './tree-controller'
import type { TreeNode } from './treeNode'

/** 动作执行上下文：当前节点 + 所属连接 + 控制器。 */
export interface NodeActionContext {
  node: TreeNode
  connId: string
  ctrl: TreeController
}

/**
 * 菜单分组（同 section 的动作渲染时连在一起，section 之间用 divider 分隔）；
 * 跨对象类型（表/视图/库/函数...）一致使用这一组定义，保证「新建 → 查看 → 编辑 → 数据 → 元数据 → 导出 → 收藏 → 连接 → 刷新 → 删除」的统一顺序感。
 */
export type Section =
  | 'create'
  | 'open'
  | 'edit'
  | 'generate'
  | 'transform'
  | 'data'
  | 'meta'
  | 'export'
  | 'fav'
  | 'conn'
  | 'misc'
  | 'danger'

const SECTION_ORDER: Section[] = [
  'create',
  'open',
  'edit',
  'generate',
  'transform',
  'data',
  'meta',
  'export',
  'fav',
  'conn',
  'misc',
  'danger',
]

/** 一条右键菜单动作。kinds 声明适用的节点类型，菜单据此数据驱动地过滤。 */
export interface TreeAction {
  id: string
  label: string
  kinds: MetaNodeKind[]
  /** 菜单分组，用于跨对象类型保持一致的动作顺序与组内归类。缺省 = 'misc' */
  section?: Section
  danger?: boolean
  /** 进一步的可用性判定（如表必须有 sqlName） */
  enabled?: (node: TreeNode) => boolean
  run: (ctx: NodeActionContext) => void
}

/** 菜单条目：动作 或 分隔符。 */
export type MenuEntry = TreeAction | { divider: true; id: string }

/**
 * 声明式动作目录。新增节点操作只需在此加一条，无需改组件；
 * 将来企业插件也可向此追加动作（同 EnterpriseRegistry 思路）。
 */
export const TREE_ACTIONS: TreeAction[] = [
  // ── 新建 ──
  {
    id: 'new-query',
    label: '新建查询',
    section: 'create',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.newQuery(node, connId),
  },
  {
    id: 'new-table',
    label: '新建表',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'tables',
    run: ({ node, connId, ctrl }) => ctrl.createObject('table', node, connId),
  },
  {
    id: 'new-view',
    label: '新建视图',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'views',
    run: ({ node, connId, ctrl }) => ctrl.createObject('view', node, connId),
  },
  {
    id: 'new-function',
    label: '新建函数',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Function],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'functions',
    run: ({ node, connId, ctrl }) => ctrl.createObject('function', node, connId),
  },
  {
    id: 'new-procedure',
    label: '新建存储过程',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Procedure],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'procedures',
    run: ({ node, connId, ctrl }) => ctrl.createObject('procedure', node, connId),
  },

  // ── 查看 / 打开 ──
  {
    id: 'select-200',
    label: '查询前 200 行',
    section: 'open',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.previewTable(node, connId),
  },
  {
    id: 'view-structure',
    label: '查看结构',
    section: 'open',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    run: ({ node, connId, ctrl }) => ctrl.viewStructure(node, connId),
  },
  {
    id: 'view-definition',
    label: '查看定义',
    section: 'open',
    kinds: [MetaNodeKind.Trigger, MetaNodeKind.Sequence],
    run: ({ node, connId, ctrl }) => ctrl.viewDefinition(node, connId),
  },
  {
    id: 'design-table',
    label: '设计表',
    section: 'open',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.designTable(node, connId),
  },

  // ── 编辑 ──
  {
    id: 'edit-object',
    label: '编辑定义',
    section: 'edit',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.editObject(node, connId),
  },
  {
    id: 'edit-comment',
    label: '编辑注释',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('comment', node, connId),
  },
  {
    id: 'create-index',
    label: '新建索引',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createindex', node, connId),
  },
  {
    id: 'rename-table',
    label: '重命名表',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.renameTable(node, connId),
  },

  // ── 生成 SQL 模板 ──
  {
    id: 'gen-select',
    label: '生成 SELECT',
    section: 'generate',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('select', node, connId),
  },
  {
    id: 'gen-insert',
    label: '生成 INSERT',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('insert', node, connId),
  },
  {
    id: 'gen-update',
    label: '生成 UPDATE',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('update', node, connId),
  },
  {
    id: 'gen-delete',
    label: '生成 DELETE',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('delete', node, connId),
  },

  // ── 复制 / 重命名 / 拷贝 DDL ──
  {
    id: 'copy-structure',
    label: '复制建表结构 (CREATE LIKE)',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createlike', node, connId),
  },
  {
    id: 'copy-table-struct',
    label: '复制表 → 仅结构',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyTable(node, connId, false),
  },
  {
    id: 'copy-table-full',
    label: '复制表 → 结构 + 数据',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyTable(node, connId, true),
  },
  {
    id: 'copy-ddl',
    label: '复制 DDL',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyDdl(node, connId),
  },
  {
    id: 'copy-object-ddl',
    label: '复制 DDL',
    section: 'transform',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.copyObjectDdl(node, connId),
  },
  {
    id: 'copy-qualified',
    label: '复制限定名',
    section: 'transform',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, ctrl }) => ctrl.copyText(node.sqlName ?? node.name),
  },
  {
    id: 'copy-name',
    label: '复制名称',
    section: 'transform',
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

  // ── 数据操作 ──
  {
    id: 'empty-table',
    label: '清空表 (DELETE)',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.emptyTable(node, connId),
  },
  {
    id: 'truncate-table',
    label: '截断表 (TRUNCATE)',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.truncateTable(node, connId),
  },
  {
    id: 'mock-data',
    label: '生成测试数据',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateMockData(node, connId),
  },
  {
    id: 'import-data',
    label: '导入数据（CSV）',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.importData(node, connId),
  },

  // ── 元数据 / 分析 ──
  {
    id: 'table-stats',
    label: '统计信息',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.tableStats(node, connId),
  },
  {
    id: 'deps',
    label: '依赖关系（外键）',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.viewDependencies(node, connId),
  },
  {
    id: 'erd',
    label: 'ER 图',
    section: 'meta',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.openErd(node, connId),
  },

  // ── 导出 ──
  {
    id: 'export-sql',
    label: '导出为 SQL（结构+数据）',
    section: 'export',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.exportSql(node, connId),
  },
  {
    id: 'transfer-data',
    label: '数据传输（复制到…）',
    section: 'export',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.transferData(node, connId),
  },
  {
    id: 'export-schema-sql',
    label: '导出库为 SQL（结构+数据）',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.exportSchemaSql(node, connId),
  },
  {
    id: 'data-dict',
    label: '生成数据字典（Markdown）',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDict(node, connId),
  },
  {
    id: 'data-dict-html',
    label: '生成数据字典（HTML）',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDictHtml(node, connId),
  },

  // ── 收藏 ──
  {
    id: 'toggle-favorite',
    label: '收藏 / 取消收藏',
    section: 'fav',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.toggleFavorite(node, connId),
  },

  // ── 连接级别 ──
  {
    id: 'edit-conn',
    label: '编辑连接',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.editConnection(connId),
  },
  {
    id: 'toggle-prod',
    label: '标记为生产环境 / 取消标记',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.toggleProdMark(connId),
  },

  // ── 刷新 ──
  {
    id: 'refresh',
    label: '刷新',
    section: 'misc',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema, MetaNodeKind.Group],
    run: ({ node, connId, ctrl }) => ctrl.refreshNode(node, connId),
  },

  // ── 删除（永远在最末，红色，分组 danger）──
  {
    id: 'drop-object',
    label: '删除',
    section: 'danger',
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
    id: 'del-conn',
    label: '删除连接',
    section: 'danger',
    kinds: [MetaNodeKind.Connection],
    danger: true,
    run: ({ connId, ctrl }) => ctrl.deleteConnection(connId),
  },
]

function sectionIndex(a: TreeAction): number {
  const s = a.section ?? 'misc'
  const i = SECTION_ORDER.indexOf(s)
  return i < 0 ? SECTION_ORDER.length : i
}

/** 取某节点适用的动作列表（不含 divider；保留旧接口给现有测试/代码）。 */
export function actionsFor(node: TreeNode): TreeAction[] {
  const all = [...TREE_ACTIONS, ...pluginTreeActions()]
  const eligible = all.filter((a) => a.kinds.includes(node.kind) && (!a.enabled || a.enabled(node)))
  // 按 section 稳定排序（同 section 保留声明顺序）
  return eligible
    .map((a, i) => ({ a, i }))
    .sort((x, y) => sectionIndex(x.a) - sectionIndex(y.a) || x.i - y.i)
    .map(({ a }) => a)
}

/** 取菜单条目（含 section 间的 divider）。 */
export function menuEntriesFor(node: TreeNode): MenuEntry[] {
  const list = actionsFor(node)
  const out: MenuEntry[] = []
  let prevSection: Section | undefined
  let divIdx = 0
  for (const a of list) {
    const s = a.section ?? 'misc'
    if (prevSection != null && s !== prevSection) {
      out.push({ divider: true, id: `__div_${divIdx++}` })
    }
    out.push(a)
    prevSection = s
  }
  return out
}
