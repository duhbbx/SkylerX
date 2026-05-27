/**
 * @db-tool/shared-types
 *
 * 跨端共用的「纯数据类型」：可序列化、无运行时依赖，
 * 同时被 UI（渲染进程 / 浏览器）和 core-driver（Node 主进程 / 服务端）使用。
 * 这些类型会穿越 IPC（桌面端）和 HTTP/WS（Web 端）边界，因此必须保持 plain object。
 */

/** 支持的数据库方言。新增信创库时在此扩展。 */
export enum DbDialect {
  MySQL = 'mysql',
  MariaDB = 'mariadb',
  PostgreSQL = 'postgresql',
  Oracle = 'oracle',
  SqlServer = 'sqlserver',
  /** 达梦 */
  DM = 'dm',
  /** 人大金仓（PG 协议兼容） */
  KingbaseES = 'kingbase',
  /** OceanBase（MySQL 协议兼容） */
  OceanBase = 'oceanbase',
}

/** 连接的传输/通道模式：进程内直连 vs 内网 agent 转发。 */
export enum TransportMode {
  Local = 'local',
  Agent = 'agent',
}

/** SSL/TLS 配置。 */
export interface SslConfig {
  enabled: boolean
  /** 是否校验服务端证书 */
  rejectUnauthorized?: boolean
  ca?: string
  cert?: string
  key?: string
}

/** SSH 隧道配置（经跳板机连内网库）。 */
export interface SshConfig {
  enabled: boolean
  host: string
  port: number
  user: string
  /** 鉴权：密码 或 私钥二选一 */
  password?: string
  privateKey?: string
  passphrase?: string
}

/**
 * 完整连接配置（含敏感信息）。
 * 持久化时 password 应加密；跨边界传输时按需脱敏。
 */
export interface ConnectionConfig {
  id: string
  name: string
  dialect: DbDialect
  host: string
  port: number
  user: string
  /** 明文仅存在于内存/解密后；持久化与展示请使用密文或脱敏 */
  password?: string
  /** 默认库 / schema */
  database?: string
  ssl?: SslConfig
  /** SSH 隧道（经跳板机连内网库） */
  ssh?: SshConfig
  /** 连接分组 / 文件夹名（导航树根层据此分组；空 = 未分组） */
  group?: string
  /** 通道模式；缺省按部署环境默认（桌面端恒为 local） */
  transport?: TransportMode
  /** agent 模式下的目标 agent 标识 */
  agentId?: string
  /** 方言特有的额外参数（如 oracle serviceName、mssql instanceName） */
  extra?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

/** 传给执行层的轻量连接引用（不一定携带明文密码，可由执行层按 id 解析）。 */
export interface ConnectionRef {
  id: string
  /** 可选内联配置；缺省时执行层按 id 从配置仓解析 */
  config?: ConnectionConfig
}

/** 查询结果列的元信息。 */
export interface QueryColumn {
  name: string
  /** 数据库原始类型名，如 VARCHAR / int8 / NUMBER */
  dataType: string
  nullable?: boolean
}

/** SQL 执行选项。 */
export interface ExecuteOptions {
  /** 最大返回行数（防止大结果集打爆内存）；undefined 表示不限制 */
  maxRows?: number
  /** 分页：每页行数（设置后对 SELECT 自动包子查询分页） */
  limit?: number
  /** 分页：偏移量 */
  offset?: number
  /** 超时毫秒数 */
  timeoutMs?: number
  /** 在哪个数据库下执行（MySQL/SQLServer：USE） */
  database?: string
  /** 在哪个 schema 下执行（PG：search_path；Oracle/达梦：CURRENT_SCHEMA） */
  schema?: string
  /** 是否为只读会话（Web 端审批前的预检场景） */
  readOnly?: boolean
}

/** 统一查询结果（SELECT 返回 rows；DML 返回 affectedRows）。 */
export interface QueryResult {
  columns: QueryColumn[]
  rows: Array<Record<string, unknown>>
  /** SELECT 返回行数 */
  rowCount: number
  /** DML 影响行数 */
  affectedRows?: number
  /** 执行耗时（毫秒） */
  executionTimeMs: number
  /** 是否因 maxRows 被截断 */
  truncated?: boolean
}

// ── 企业插件契约 ──────────────────────────────────────────────
// 开源基座（web-server）与闭源企业插件（私有 submodule packages/enterprise）之间的边界。
// 刻意保持框架无关：闭源插件只依赖本契约，不依赖 Fastify/基座内部实现。

export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface PluginRequest {
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
}

export interface PluginRoute {
  method: PluginHttpMethod
  path: string
  handler: (req: PluginRequest) => unknown | Promise<unknown>
}

/** 基座暴露给插件的能力面。 */
export interface EnterpriseRegistry {
  /** 声明插件（用于 /api/plugins 展示已启用能力）。 */
  definePlugin(name: string): void
  /** 注册 HTTP 路由（如审批工作台接口、巡检报告接口）。 */
  addRoute(route: PluginRoute): void
  /** 注册「执行前钩子」：风险SQL 校验、审批门禁挂在这里，抛错即拦截执行。 */
  onBeforeExecute(hook: (ctx: { connId: string; sql: string }) => void | Promise<void>): void
  /** 供巡检等插件按连接执行 SQL（底层走基座 transport / core-driver）。 */
  executeSql(connId: string, sql: string): Promise<QueryResult>
}

/** 闭源插件包的入口约定。 */
export interface EnterpriseModule {
  registerEnterprise(registry: EnterpriseRegistry): void | Promise<void>
}

/** SQL 执行历史记录（持久化在本地 SQLite query_history 表）。 */
export interface QueryHistoryEntry {
  id: number
  connectionId: string
  sql: string
  /** 执行时间戳（ms） */
  executedAt: number
  /** 耗时（ms） */
  durationMs: number | null
  success: boolean
}

/** 测试连接结果。 */
export interface TestResult {
  ok: boolean
  /** 失败时的错误信息 */
  message?: string
  /** 探测到的服务端版本，如 "8.0.36" */
  serverVersion?: string
  /** 往返耗时（毫秒） */
  latencyMs?: number
}

/**
 * 导航树节点类型。
 *
 * 树的"形状"由各方言驱动决定（Navicat 式），不同库层级不同，例如：
 * - MySQL 系：Connection → Database → Group(表/视图/函数...) → Table/View → Column
 * - PostgreSQL/SQLServer：Connection → Database → Schema → Group → Table/View → Column
 * - Oracle/达梦：Connection → Schema(用户) → Group → Table/View → Column
 */
export enum MetaNodeKind {
  /** 根：连接 */
  Connection = 'connection',
  /** 数据库 */
  Database = 'database',
  /** 模式（schema / 用户） */
  Schema = 'schema',
  /** 文件夹分组（表、视图、函数...），由 group 字段区分具体类型 */
  Group = 'group',
  Table = 'table',
  View = 'view',
  Column = 'column',
  Function = 'function',
  Procedure = 'procedure',
  Index = 'index',
  Trigger = 'trigger',
  Sequence = 'sequence',
  Event = 'event',
}

/**
 * 展开请求：要求驱动返回某个父节点的「直接子节点」。
 * 驱动据 parentKind（+ group + 自身方言）决定返回什么，从而实现不同方言不同树形。
 */
export interface MetaScope {
  /** 被展开的父节点类型 */
  parentKind: MetaNodeKind
  /** 父节点的标识路径，如 [db] / [db, schema] / [db, table] */
  path: string[]
  /** 父节点为 Group 时，指明它装的对象类型，如 'tables' | 'views' | 'functions' */
  group?: string
}

/** 导航树节点（库/schema/分组/表/列等统一表达）。 */
export interface MetadataNode {
  kind: MetaNodeKind
  name: string
  /** 节点标识路径，驱动回查其子节点时使用 */
  path: string[]
  /** 是否还有下级（前端懒加载展开用） */
  hasChildren?: boolean
  /** Group 节点：所装对象类型键，如 'tables' | 'views' | 'columns' | 'indexes' | 'keys' */
  group?: string
  /** Group 节点：所含对象个数（仅"装对象"的目录有；"装目录"的节点不设，则不显示计数） */
  count?: number
  /** Table/View 节点：可直接用于 FROM 的、按方言转义好的限定名 */
  sqlName?: string
  /** 列节点专用：类型、是否主键、是否可空等 */
  detail?: {
    dataType?: string
    nullable?: boolean
    primaryKey?: boolean
    defaultValue?: string | null
    comment?: string
  }
}

/**
 * 数据访问客户端契约 —— 渲染层组件统一经此访问数据，不直接依赖 Electron IPC。
 * 桌面端注入包装 IPC 的实现（即 window.api）；Web 端注入包装 REST(fetch) 的实现。
 * 形状与桌面 preload 暴露的 api 一致，便于桌面端零成本复用。
 */
export interface DataClient {
  connections: {
    list(): Promise<ConnectionConfig[]>
    get(id: string): Promise<ConnectionConfig>
    create(config: ConnectionConfig): Promise<ConnectionConfig>
    update(config: ConnectionConfig): Promise<ConnectionConfig>
    remove(id: string): Promise<void>
    test(config: ConnectionConfig): Promise<TestResult>
    execute(
      connId: string,
      sql: string,
      params?: unknown[],
      options?: ExecuteOptions,
    ): Promise<QueryResult>
    metadata(connId: string, scope: MetaScope): Promise<MetadataNode[]>
    executeBatch(connId: string, statements: string[], options?: ExecuteOptions): Promise<void>
    cancel(connId: string): Promise<void>
    history(connId: string, limit?: number): Promise<QueryHistoryEntry[]>
    historyClear(connId: string): Promise<void>
  }
  files: {
    saveText(req: {
      defaultName: string
      content: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string | null>
    openText(
      filters?: { name: string; extensions: string[] }[],
    ): Promise<{ name: string; content: string } | null>
  }
}
