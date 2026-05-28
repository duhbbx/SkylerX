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
    label: 'ctx.new-query',
    section: 'create',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.newQuery(node, connId),
  },
  {
    id: 'new-table',
    label: 'ctx.new-table',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'tables',
    run: ({ node, connId, ctrl }) => ctrl.createObject('table', node, connId),
  },
  {
    id: 'new-view',
    label: 'ctx.new-view',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.View],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'views',
    run: ({ node, connId, ctrl }) => ctrl.createObject('view', node, connId),
  },
  {
    id: 'new-function',
    label: 'ctx.new-function',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Function],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'functions',
    run: ({ node, connId, ctrl }) => ctrl.createObject('function', node, connId),
  },
  {
    id: 'new-procedure',
    label: 'ctx.new-procedure',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Procedure],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'procedures',
    run: ({ node, connId, ctrl }) => ctrl.createObject('procedure', node, connId),
  },
  // 序列 / 事件无结构化设计器；直接在草稿查询页打开模板，由用户调整后执行
  {
    id: 'new-sequence',
    label: 'ctx.new-sequence',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Sequence],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'sequences',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('sequence', node, connId),
  },
  {
    id: 'new-event',
    label: 'ctx.new-event',
    section: 'create',
    kinds: [MetaNodeKind.Group, MetaNodeKind.Event],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'events',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('event', node, connId),
  },

  // ── 查看 / 打开 ──
  {
    id: 'select-200',
    label: 'ctx.select-200',
    section: 'open',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.previewTable(node, connId),
  },
  {
    id: 'view-structure',
    label: 'ctx.view-structure',
    section: 'open',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    run: ({ node, connId, ctrl }) => ctrl.viewStructure(node, connId),
  },
  {
    id: 'view-definition',
    label: 'ctx.view-definition',
    section: 'open',
    kinds: [MetaNodeKind.Trigger, MetaNodeKind.Sequence, MetaNodeKind.Event],
    run: ({ node, connId, ctrl }) => ctrl.viewDefinition(node, connId),
  },
  {
    id: 'design-table',
    label: 'ctx.design-table',
    section: 'open',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.designTable(node, connId),
  },

  // ── 编辑 ──
  {
    id: 'edit-object',
    label: 'ctx.edit-object',
    section: 'edit',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.editObject(node, connId),
  },
  {
    id: 'edit-comment',
    label: 'ctx.edit-comment',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('comment', node, connId),
  },
  {
    id: 'create-index',
    label: 'ctx.create-index',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createindex', node, connId),
  },
  {
    id: 'rename-table',
    label: 'ctx.rename-table',
    section: 'edit',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.renameTable(node, connId),
  },

  // ── 生成 SQL 模板 ──
  {
    id: 'gen-select',
    label: 'ctx.gen-select',
    section: 'generate',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('select', node, connId),
  },
  {
    id: 'gen-insert',
    label: 'ctx.gen-insert',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('insert', node, connId),
  },
  {
    id: 'gen-update',
    label: 'ctx.gen-update',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('update', node, connId),
  },
  {
    id: 'gen-delete',
    label: 'ctx.gen-delete',
    section: 'generate',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('delete', node, connId),
  },

  // ── 复制 / 重命名 / 拷贝 DDL ──
  {
    id: 'copy-structure',
    label: 'ctx.copy-structure',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateSql('createlike', node, connId),
  },
  {
    id: 'copy-table-struct',
    label: 'ctx.copy-table-struct',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyTable(node, connId, false),
  },
  {
    id: 'copy-table-full',
    label: 'ctx.copy-table-full',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyTable(node, connId, true),
  },
  {
    id: 'copy-ddl',
    label: 'ctx.copy-ddl',
    section: 'transform',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.copyDdl(node, connId),
  },
  {
    id: 'copy-object-ddl',
    label: 'ctx.copy-ddl',
    section: 'transform',
    kinds: [MetaNodeKind.View, MetaNodeKind.Function, MetaNodeKind.Procedure, MetaNodeKind.Trigger],
    run: ({ node, connId, ctrl }) => ctrl.copyObjectDdl(node, connId),
  },
  {
    id: 'copy-qualified',
    label: 'ctx.copy-qualified',
    section: 'transform',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, ctrl }) => ctrl.copyText(node.sqlName ?? node.name),
  },
  {
    id: 'copy-name',
    label: 'ctx.copy-name',
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
    label: 'ctx.empty-table',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.emptyTable(node, connId),
  },
  {
    id: 'truncate-table',
    label: 'ctx.truncate-table',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.truncateTable(node, connId),
  },
  {
    id: 'mock-data',
    label: 'ctx.mock-data',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.generateMockData(node, connId),
  },
  {
    id: 'inspect-table',
    label: 'ctx.inspect-table',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.inspectTable(node, connId),
  },
  {
    id: 'fixup-table',
    label: 'ctx.fixup-table',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.fixupTable(node, connId),
  },
  // ── G2 AI 写注释（表级直连，替代 ⌘K 后弹 prompt 的两步） ──
  {
    id: 'ai-comment-table',
    label: 'ctx.ai-comment-table',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.aiCommentTable(node, connId),
  },
  // ── G1 AI 数据库体检 / C5 索引推荐：连接级，挂 Connection 节点右键 ──
  {
    id: 'ai-health-conn',
    label: 'ctx.ai-health',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.aiHealthCheck(connId),
  },
  {
    id: 'index-recommender-conn',
    label: 'ctx.index-recommender',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.indexRecommender(connId),
  },
  {
    id: 'import-data',
    label: 'ctx.import-data',
    section: 'data',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.importData(node, connId),
  },

  // ── 元数据 / 分析 ──
  {
    id: 'table-stats',
    label: 'ctx.table-stats',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.tableStats(node, connId),
  },
  {
    id: 'deps',
    label: 'ctx.deps',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.viewDependencies(node, connId),
  },
  {
    id: 'erd',
    label: 'ctx.erd',
    section: 'meta',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.openErd(node, connId),
  },

  // ── 导出 ──
  {
    id: 'export-sql',
    label: 'ctx.export-sql',
    section: 'export',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.exportSql(node, connId),
  },
  {
    id: 'transfer-data',
    label: 'ctx.transfer-data',
    section: 'export',
    kinds: [MetaNodeKind.Table],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.transferData(node, connId),
  },
  {
    id: 'export-schema-sql',
    label: 'ctx.export-schema-sql',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.exportSchemaSql(node, connId),
  },
  {
    id: 'data-dict',
    label: 'ctx.data-dict',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDict(node, connId),
  },
  {
    id: 'data-dict-html',
    label: 'ctx.data-dict-html',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    run: ({ node, connId, ctrl }) => ctrl.dataDictHtml(node, connId),
  },

  // ── 收藏 ──
  {
    id: 'toggle-favorite',
    label: 'ctx.toggle-favorite',
    section: 'fav',
    kinds: [MetaNodeKind.Table, MetaNodeKind.View],
    enabled: (n) => !!n.sqlName,
    run: ({ node, connId, ctrl }) => ctrl.toggleFavorite(node, connId),
  },

  // ── 连接级别 ──
  {
    id: 'edit-conn',
    label: 'ctx.edit-conn',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.editConnection(connId),
  },
  {
    id: 'toggle-prod',
    label: 'ctx.toggle-prod',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.toggleProdMark(connId),
  },

  // ── 刷新 ──
  {
    id: 'refresh',
    label: 'ctx.refresh',
    section: 'misc',
    kinds: [
      MetaNodeKind.Connection,
      MetaNodeKind.Database,
      MetaNodeKind.Schema,
      MetaNodeKind.Group,
    ],
    run: ({ node, connId, ctrl }) => ctrl.refreshNode(node, connId),
  },

  // ── 删除（永远在最末，红色，分组 danger）──
  {
    id: 'drop-object',
    label: 'ctx.drop-object',
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
    label: 'ctx.del-conn',
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
