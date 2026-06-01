/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, DbKind, MetaNodeKind, dialectKind } from '@db-tool/shared-types'
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
  /**
   * 排除某个方言类别。如 ER 图 / 导出 SQL / 数据字典 / AI 体检 / 索引推荐器
   * 对 Redis/Mongo/ES 没意义,设 `excludeKind: DbKind.NoSql` 即可隐藏。
   */
  excludeKind?: DbKind
  /** 仅在这些方言出现(白名单)。空 = 所有方言。 */
  onlyDialects?: DbDialect[]
  /** 在这些方言中隐藏(黑名单)。比 onlyDialects 反向,典型: Oracle/DM "新建数据库"无意义。 */
  excludeDialects?: DbDialect[]
  run: (ctx: NodeActionContext) => void
}

/**
 * 系统库 / 系统 schema 名(用于在右键里隐藏 DROP 之类的危险动作)。
 * 用户可以"看到"但不能"删除":防止误删 mysql.user / pg_catalog / SYS 等。
 */
const SYSTEM_DATABASE_NAMES = new Set<string>([
  // MySQL/MariaDB/OceanBase/TiDB
  'mysql',
  'information_schema',
  'performance_schema',
  'sys',
  'oceanbase',
  // PostgreSQL 系
  'postgres',
  'template0',
  'template1',
  // SQL Server
  'master',
  'tempdb',
  'msdb',
  'model',
])
const SYSTEM_SCHEMA_NAMES = new Set<string>([
  // PostgreSQL
  'pg_catalog',
  'information_schema',
  'pg_toast',
  // SQL Server
  'sys',
  'INFORMATION_SCHEMA',
  'guest',
  // Oracle 内置(覆盖 Oracle Free 23ai / EE 常见的系统 schema; 真正运行时
  // 再用 oracle_maintained='N' 过滤掉,这里只是 drop 拦截兜底)
  'SYS',
  'SYSTEM',
  'SYSAUX',
  'OUTLN',
  'MDSYS',
  'ORDSYS',
  'XDB',
  'CTXSYS',
  'DBSNMP',
  'APPQOSSYS',
  'GSMADMIN_INTERNAL',
  'ANONYMOUS',
  'AUDSYS',
  'DIP',
  'GSMCATUSER',
  'GSMUSER',
  'ORACLE_OCM',
  'REMOTE_SCHEDULER_AGENT',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSRAC',
  'WMSYS',
  'XS$NULL',
  'LBACSYS',
  'OLAPSYS',
  'ORDDATA',
  'ORDPLUGINS',
  'SI_INFORMTN_SCHEMA',
  'FLOWS_FILES',
  'APEX_PUBLIC_USER',
])

function isSystemSchemaOrDb(node: TreeNode): boolean {
  if (node.kind === MetaNodeKind.Database) return SYSTEM_DATABASE_NAMES.has(node.name)
  if (node.kind === MetaNodeKind.Schema) {
    // Oracle 实际由 backend 标 detail.system 更准(oracle_maintained='Y');没标也按名单兜底
    if ((node as { detail?: { system?: boolean } }).detail?.system) return true
    return SYSTEM_SCHEMA_NAMES.has(node.name)
  }
  return false
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
  // 新建数据库 — 连接节点。
  // - Oracle/DM: "数据库" 在 Oracle 是实例级,要 DBA + DBCA + 数据文件; 在 SkylerX 内
  //   应该新建 schema(用户) 代替,所以菜单直接不出现(走 new-schema)。
  // - NoSQL 通过 excludeKind 隐藏。
  // - 其他不支持的(如 SQLite/DuckDB 文件型)由 NewDatabaseDialog 内 unsupportedReason 处理。
  {
    id: 'new-database',
    label: 'ctx.new-database',
    section: 'create',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
    excludeDialects: [DbDialect.Oracle, DbDialect.DM],
    run: ({ node, connId, ctrl }) => ctrl.newDatabase(connId, node),
  },
  // 新建 Schema — 只在 PG 系 / SQL Server / Snowflake / Oracle / DM 出现
  // 挂在 Connection(Oracle 整库即 schema)或 Database(PG 系库下建 schema)节点上
  {
    id: 'new-schema',
    label: 'ctx.new-schema',
    section: 'create',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database],
    onlyDialects: [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.OpenGauss,
      DbDialect.Greenplum,
      DbDialect.CockroachDB,
      DbDialect.Redshift,
      DbDialect.SqlServer,
      DbDialect.Snowflake,
      DbDialect.Oracle,
      DbDialect.DM,
    ],
    run: ({ node, connId, ctrl }) => ctrl.newSchema(connId, node),
  },
  {
    id: 'new-table',
    label: 'ctx.new-table',
    section: 'create',
    // View kept out: right-clicking an existing view should not offer "new table"
    // (caused #23 — Oracle view node spuriously offered table creation).
    kinds: [MetaNodeKind.Group, MetaNodeKind.Table],
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
    id: 'new-trigger',
    label: 'ctx.new-trigger',
    section: 'create',
    onlyDialects: [DbDialect.Oracle, DbDialect.DM],
    kinds: [MetaNodeKind.Group, MetaNodeKind.Trigger],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'triggers',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('trigger', node, connId),
  },
  {
    id: 'new-package',
    label: 'ctx.new-package',
    section: 'create',
    onlyDialects: [DbDialect.Oracle, DbDialect.DM],
    kinds: [MetaNodeKind.Group, MetaNodeKind.Package],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'packages',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('package', node, connId),
  },
  {
    id: 'new-type',
    label: 'ctx.new-type',
    section: 'create',
    onlyDialects: [DbDialect.Oracle, DbDialect.DM],
    kinds: [MetaNodeKind.Group, MetaNodeKind.Type],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'types',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('type', node, connId),
  },
  {
    id: 'new-synonym',
    label: 'ctx.new-synonym',
    section: 'create',
    onlyDialects: [DbDialect.Oracle, DbDialect.DM],
    kinds: [MetaNodeKind.Group, MetaNodeKind.Synonym],
    enabled: (n) => n.kind !== MetaNodeKind.Group || n.group === 'synonyms',
    run: ({ node, connId, ctrl }) => ctrl.createTemplateDraft('synonym', node, connId),
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
    // 仅对表 (Table) 提供「打开结构」（看列定义 / 索引 / FK 的只读页）。
    // 视图本身没有可编辑或可独立存在的「结构」——它的"结构"就是它的 SELECT
    // 语句（用「打开 DDL / 编辑」入口看），所以这里不挂 View；用户报告：
    // 之前在 View 上点「打开结构」会进一个对视图无意义的页面。
    id: 'view-structure',
    label: 'ctx.view-structure',
    section: 'open',
    kinds: [MetaNodeKind.Table],
    run: ({ node, connId, ctrl }) => ctrl.viewStructure(node, connId),
  },
  {
    id: 'view-definition',
    label: 'ctx.view-definition',
    section: 'open',
    kinds: [
      MetaNodeKind.Trigger,
      MetaNodeKind.Sequence,
      MetaNodeKind.Event,
      MetaNodeKind.Package,
      MetaNodeKind.Type,
      MetaNodeKind.Synonym,
    ],
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
    kinds: [
      MetaNodeKind.View,
      MetaNodeKind.Function,
      MetaNodeKind.Procedure,
      MetaNodeKind.Trigger,
      MetaNodeKind.Package,
      MetaNodeKind.Type,
      MetaNodeKind.Synonym,
    ],
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
    kinds: [
      MetaNodeKind.View,
      MetaNodeKind.Function,
      MetaNodeKind.Procedure,
      MetaNodeKind.Trigger,
      MetaNodeKind.Sequence,
      MetaNodeKind.Package,
      MetaNodeKind.Type,
      MetaNodeKind.Synonym,
    ],
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
  // ── OB/TiDB 集群拓扑(连接级) ──
  {
    id: 'cluster-topology',
    label: 'ctx.cluster-topology',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    onlyDialects: [DbDialect.OceanBase, DbDialect.TiDB],
    run: ({ connId, ctrl }) => ctrl.openClusterTopology(connId),
  },
  // ── PG 系扩展/复制/复制槽(连接节点 或 库节点) ──
  {
    id: 'pg-advanced',
    label: 'ctx.pg-advanced',
    section: 'meta',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database],
    onlyDialects: [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.OpenGauss,
      DbDialect.Greenplum,
      DbDialect.CockroachDB,
      DbDialect.Redshift,
    ],
    run: ({ node, connId, ctrl }) => {
      const database = node.kind === MetaNodeKind.Database ? node.name : undefined
      ctrl.openPgAdvanced(connId, database)
    },
  },

  // ── ClickHouse 高级 ──
  {
    id: 'clickhouse-advanced',
    label: 'ctx.clickhouse-advanced',
    section: 'meta',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database],
    onlyDialects: [DbDialect.ClickHouse],
    run: ({ node, connId, ctrl }) => {
      const database = node.kind === MetaNodeKind.Database ? node.name : undefined
      ctrl.openClickHouseAdvanced(connId, database)
    },
  },
  // ── Doris/StarRocks 分区(挂表节点最方便) ──
  {
    id: 'mpp-partition',
    label: 'ctx.mpp-partition',
    section: 'meta',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Table],
    onlyDialects: [DbDialect.Doris, DbDialect.StarRocks],
    run: ({ node, connId, ctrl }) => {
      let database: string | undefined
      let table: string | undefined
      if (node.kind === MetaNodeKind.Table) {
        database = node.path[0]
        table = node.name
      } else if (node.kind === MetaNodeKind.Database) {
        database = node.name
      }
      ctrl.openMppPartition(connId, database, table)
    },
  },
  // ── MySQL/MariaDB 高级(binlog/主从/变量) ──
  {
    id: 'mysql-advanced',
    label: 'ctx.mysql-advanced',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    onlyDialects: [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase, DbDialect.TiDB],
    run: ({ connId, ctrl }) => ctrl.openMysqlAdvanced(connId),
  },

  // ── 数据安全 ──
  {
    id: 'pii-scanner',
    label: 'ctx.pii-scanner',
    section: 'meta',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    excludeKind: DbKind.NoSql,
    run: ({ node, connId, ctrl }) => {
      const database = node.kind === MetaNodeKind.Database ? node.name : undefined
      const schema = node.kind === MetaNodeKind.Schema ? node.name : undefined
      ctrl.openPiiScanner(connId, database, schema)
    },
  },
  {
    id: 'masking-view',
    label: 'ctx.masking-view',
    section: 'meta',
    kinds: [MetaNodeKind.Table],
    excludeKind: DbKind.NoSql,
    enabled: (n) => !!n.sqlName || !!n.name,
    run: ({ node, connId, ctrl }) => {
      const path = node.path
      let database: string | undefined
      let schema: string | undefined
      // 简单按 path 长度推断
      if (path.length === 2) {
        // [db, table] or [schema, table]
        database = path[0]
      } else if (path.length === 3) {
        database = path[0]
        schema = path[1]
      }
      ctrl.openMaskingView(connId, database, schema, node.name)
    },
  },
  // ── AI 深化:慢 SQL 优化 / 错误根因 / schema 反向 ──
  {
    id: 'ai-insights',
    label: 'ctx.ai-insights',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
    run: ({ connId, ctrl }) => ctrl.openAiInsights(connId),
  },
  {
    id: 'ai-schema-reverse',
    label: 'ctx.ai-schema-reverse',
    section: 'create',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    excludeKind: DbKind.NoSql,
    run: ({ node, connId, ctrl }) => {
      const database =
        node.kind === MetaNodeKind.Database
          ? node.name
          : node.kind === MetaNodeKind.Schema
            ? node.path[0]
            : undefined
      ctrl.openAiSchemaReverse(connId, database)
    },
  },
  // AI 建表助手(对话式):从业务需求出多表 schema + 关系 + 索引
  {
    id: 'ai-schema-architect',
    label: 'ctx.ai-schema-architect',
    section: 'create',
    kinds: [MetaNodeKind.Connection, MetaNodeKind.Database, MetaNodeKind.Schema],
    excludeKind: DbKind.NoSql,
    run: ({ node, connId, ctrl }) => {
      const database =
        node.kind === MetaNodeKind.Database
          ? node.name
          : node.kind === MetaNodeKind.Schema
            ? node.path[0]
            : undefined
      ctrl.openAiSchemaArchitect(connId, database)
    },
  },

  // ── G1 AI 数据库体检 / C5 索引推荐：连接级，挂 Connection 节点右键 ──
  // 对 Redis/Mongo/ES 没有"表/索引"概念,这两个功能无意义,按方言隐藏。
  {
    id: 'ai-health-conn',
    label: 'ctx.ai-health',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
    run: ({ connId, ctrl }) => ctrl.aiHealthCheck(connId),
  },
  {
    id: 'index-recommender-conn',
    label: 'ctx.index-recommender',
    section: 'meta',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
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
    excludeKind: DbKind.NoSql,
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
    excludeKind: DbKind.NoSql,
    run: ({ node, connId, ctrl }) => ctrl.exportSchemaSql(node, connId),
  },
  {
    id: 'data-dict',
    label: 'ctx.data-dict',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    excludeKind: DbKind.NoSql,
    run: ({ node, connId, ctrl }) => ctrl.dataDict(node, connId),
  },
  {
    id: 'data-dict-html',
    label: 'ctx.data-dict-html',
    section: 'export',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Schema],
    excludeKind: DbKind.NoSql,
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
  // 复制连接 — 同方言/同 host/同 user/同密码,只换 id + 名字加"(副本)"。常用于
  // 给同一台机不同库做多个会话标签,或基于一个生产连接快速派生一个只读账号副本。
  {
    id: 'duplicate-conn',
    label: 'ctx.duplicate-conn',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.duplicateConnection(connId),
  },
  {
    id: 'toggle-prod',
    label: 'ctx.toggle-prod',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.toggleProdMark(connId),
  },
  // #24: 可见库/Schema 过滤. 适用于所有方言 — Oracle/DM 的 schema 直挂在连接下,
  // 跟其它方言的 Database 共用语义.
  {
    id: 'configure-nav-filter',
    label: 'ctx.configure-nav-filter',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    run: ({ connId, ctrl }) => ctrl.configureNavFilter(connId),
  },
  // #D: 进程/会话列表 + Kill. 排除 NoSQL — Mongo/Redis/ES 没 SQL 进程概念
  // (Mongo 有 currentOp / Redis 有 CLIENT LIST 但走不同 UI), SQLite/DuckDB
  // 是文件型同样无意义.
  {
    id: 'process-list',
    label: 'ctx.process-list',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
    excludeDialects: [DbDialect.SQLite, DbDialect.DuckDB],
    run: ({ connId, ctrl }) => ctrl.openProcessList(connId),
  },
  // #A v2: 重建全库对象索引 — 全库 catalog 一次性 scan, 10w 对象 ~3s, 用于
  // NavTree 搜索时跨整个 DB 找对象 (不止当前已展开节点).
  {
    id: 'rebuild-object-index',
    label: 'ctx.rebuild-object-index',
    section: 'conn',
    kinds: [MetaNodeKind.Connection],
    excludeKind: DbKind.NoSql,
    excludeDialects: [DbDialect.SQLite, DbDialect.DuckDB, DbDialect.ClickHouse],
    run: ({ connId, ctrl }) => ctrl.rebuildObjectIndex(connId),
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

  // ── Redis 专属:db 节点 / 连接节点 / key 节点 ──
  // 新建 key:db 节点 或 类型组(group: 'redis-key' 不是 group;Redis 的类型组 group 在
  // {strings|hashes|lists|sets|zsets|streams} 之一,但 group 字段在节点上是这些值)
  {
    id: 'redis-new-key',
    label: 'ctx.redis-new-key',
    section: 'create',
    kinds: [MetaNodeKind.Database, MetaNodeKind.Group],
    onlyDialects: [DbDialect.Redis],
    // Group 节点限定 Redis 类型组(避免 SQL 方言的 Group 误中)
    enabled: (n) =>
      n.kind === MetaNodeKind.Database ||
      ['strings', 'hashes', 'lists', 'sets', 'zsets', 'streams'].includes(n.group ?? ''),
    run: ({ node, connId, ctrl }) => {
      // 从节点 path[0] 解析 dbIndex(类型组 path = [db, type];db 节点 path = [db])
      const dbIndex = Number(node.path[0]) || 0
      ctrl.newRedisKey(connId, dbIndex, node)
    },
  },
  // 清空逻辑库(FLUSHDB):放 danger 区,二次确认
  {
    id: 'redis-flush-db',
    label: 'ctx.redis-flush-db',
    section: 'danger',
    kinds: [MetaNodeKind.Database],
    onlyDialects: [DbDialect.Redis],
    danger: true,
    run: ({ node, connId, ctrl }) => {
      const dbIndex = Number(node.path[0]) || 0
      ctrl.flushRedisDb(connId, dbIndex, node)
    },
  },
  // 清空整个 Redis 实例(FLUSHALL):连接节点上,二次+生产防呆
  {
    id: 'redis-flush-all',
    label: 'ctx.redis-flush-all',
    section: 'danger',
    kinds: [MetaNodeKind.Connection],
    onlyDialects: [DbDialect.Redis],
    danger: true,
    run: ({ node, connId, ctrl }) => ctrl.flushRedisAll(connId, node),
  },

  // ── Redis key 专属动作 ──
  // Column kind + group='redis-key' 由 redis 驱动写入(见 redis.ts sampleKeysByType),
  // 用来在共用 Column kind 的情况下区分"SQL 列"还是"Redis key"。
  {
    id: 'redis-view-key',
    label: 'ctx.redis-view-key',
    section: 'open',
    kinds: [MetaNodeKind.Column],
    enabled: (n) => n.group === 'redis-key' && n.path.length >= 3,
    run: ({ node, connId, ctrl }) =>
      ctrl.openRedisKey(connId, Number(node.path[0]) || 0, node.name),
  },
  {
    id: 'redis-copy-key',
    label: 'ctx.redis-copy-key',
    section: 'export',
    kinds: [MetaNodeKind.Column],
    enabled: (n) => n.group === 'redis-key',
    run: ({ node, ctrl }) => ctrl.copyText(node.name),
  },

  // ── 删除（永远在最末，红色，分组 danger）──
  {
    id: 'redis-del-key',
    label: 'ctx.redis-del-key',
    section: 'danger',
    kinds: [MetaNodeKind.Column],
    enabled: (n) => n.group === 'redis-key' && n.path.length >= 3,
    danger: true,
    run: ({ node, connId, ctrl }) => {
      // parent = 类型组节点(用于刷新),从 TreeNode.parent 取
      const parent = node.parent
      if (!parent) return
      ctrl.deleteRedisKey(connId, Number(node.path[0]) || 0, node.name, parent)
    },
  },
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
      MetaNodeKind.Package,
      MetaNodeKind.Type,
      MetaNodeKind.Synonym,
      MetaNodeKind.Event,
      MetaNodeKind.Database,
      MetaNodeKind.Schema,
    ],
    danger: true,
    // 系统库 / 系统 schema 永远不显示 DROP,避免误删 mysql.user/pg_catalog/SYS 等
    enabled: (n) => !isSystemSchemaOrDb(n),
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

/**
 * 取某节点适用的动作列表（不含 divider）。
 * dialect 可选:传了就过滤掉与该方言不兼容的 action(excludeKind / onlyDialects)。
 */
export function actionsFor(node: TreeNode, dialect?: DbDialect): TreeAction[] {
  const all = [...TREE_ACTIONS, ...pluginTreeActions()]
  const kind = dialect ? dialectKind(dialect) : null
  const eligible = all.filter((a) => {
    if (!a.kinds.includes(node.kind)) return false
    if (a.enabled && !a.enabled(node)) return false
    if (dialect && a.onlyDialects && !a.onlyDialects.includes(dialect)) return false
    if (dialect && a.excludeDialects?.includes(dialect)) return false
    if (kind && a.excludeKind === kind) return false
    return true
  })
  // 按 section 稳定排序（同 section 保留声明顺序）
  return eligible
    .map((a, i) => ({ a, i }))
    .sort((x, y) => sectionIndex(x.a) - sectionIndex(y.a) || x.i - y.i)
    .map(({ a }) => a)
}

/** 取菜单条目（含 section 间的 divider）。 */
export function menuEntriesFor(node: TreeNode, dialect?: DbDialect): MenuEntry[] {
  const list = actionsFor(node, dialect)
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
