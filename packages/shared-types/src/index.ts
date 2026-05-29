/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
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
  /** TiDB（MySQL 协议兼容，分布式 NewSQL） */
  TiDB = 'tidb',
  /** CockroachDB（PG 协议兼容，分布式 NewSQL） */
  CockroachDB = 'cockroachdb',
  /** Greenplum（PG 协议兼容，MPP 分析数据库） */
  Greenplum = 'greenplum',
  /** openGauss（PG 协议兼容，华为信创） */
  OpenGauss = 'opengauss',
  /** SQLite（本地文件 SQL，better-sqlite3） */
  SQLite = 'sqlite',
  /** DuckDB（本地文件 OLAP SQL） */
  DuckDB = 'duckdb',
  /** ClickHouse（列存 OLAP，事务/UPDATE 受限） */
  ClickHouse = 'clickhouse',
  /** Snowflake（云 DW，需要 account/warehouse/role） */
  Snowflake = 'snowflake',
  /** H2（仅支持 PG-server 模式:H2 启动加 -pg 参数监听 5435 端口;Embedded/原生 TCP 不支持） */
  H2 = 'h2',
  /** Apache Doris（MySQL 协议兼容，列存 MPP） */
  Doris = 'doris',
  /** StarRocks（MySQL 协议兼容，Doris fork） */
  StarRocks = 'starrocks',
  /** Amazon Redshift（PG 协议兼容，云 DW） */
  Redshift = 'redshift',
  /** TDengine（涛思，信创时序，REST/WebSocket SQL） */
  TDengine = 'tdengine',
  /** MongoDB（文档型，走 executeCommand 通道，不走 SQL） */
  MongoDB = 'mongodb',
  /** Redis（KV/数据结构型，走 executeCommand 通道，不走 SQL） */
  Redis = 'redis',
  /** Elasticsearch（搜索引擎/文档型，走 executeCommand 通道，REST/HTTP 协议） */
  Elasticsearch = 'elasticsearch',
}

/**
 * 数据库类别：SQL 走 execute(sql, params)+矩形结果；
 * NoSQL 走 executeCommand(payload)+原生形状结果。
 * 上层 UI 据此分流到 SQL 面板或 NoSQL 面板。
 */
export enum DbKind {
  Sql = 'sql',
  NoSql = 'nosql',
}

/** 给定方言归到 SQL 还是 NoSQL（前端/驱动通用判定）。 */
export function dialectKind(d: DbDialect): DbKind {
  return d === DbDialect.MongoDB || d === DbDialect.Redis || d === DbDialect.Elasticsearch
    ? DbKind.NoSql
    : DbKind.Sql
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
  /** 方言特有的额外参数（如 oracle serviceName、mssql instanceName）；环境标记 env 也存于此 */
  extra?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

/** 连接环境标记：用于导航树着色与生产库误操作防护（存于 ConnectionConfig.extra.env）。 */
export type ConnectionEnv = 'dev' | 'test' | 'prod'

/**
 * 事务提交模式：
 *  - 'auto'   每条 SQL 立即提交（默认；行为同现网）
 *  - 'manual' 用户须显式按「提交 / 回滚」；执行层会钉一个长连接做 session
 *
 * 全局默认放 `Settings.commitMode`；每连接可覆盖：
 *  - `ConnectionConfig.extra.commitMode = 'inherit' | 'auto' | 'manual'`
 *  - `inherit` 跟随全局；其余强制本连接行为
 */
export type CommitMode = 'auto' | 'manual'

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
  /**
   * 该列的值在驱动层被有损转换的标记,UI 据此可在表头/单元格加提示。
   *  - 'bigint':原值是 BigInt(DuckDB BIGINT/HUGEINT / SQLite INTEGER 超 Number.MAX_SAFE_INTEGER),
   *             已字符串化以保留精度,显示与排序需注意按字符串处理。
   */
  lossy?: 'bigint'
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

// ── NoSQL 平行通道：命令请求 / 命令结果 ────────────────────────────
// SQL 方言走 execute(sql, params)+QueryResult；MongoDB/Redis 走
// executeCommand(payload)+CommandResult，避免把 JSON/命令塞进 sql 字符串。
// 形状刻意保持 plain JSON，以穿越 IPC 边界。

/**
 * NoSQL 命令请求。
 *
 * 形态由 op + args 决定，方言侧负责解释（Mongo: find/aggregate/...; Redis: GET/SET/...）。
 * context 携带库/集合/DB-index 等执行上下文，避免每次都塞在 args 里。
 */
export interface CommandRequest {
  /** 命令名：Mongo 用 collection 方法名或 db 命令（find / aggregate / insertOne / runCommand …）；Redis 用命令名（GET / SET / HGETALL / SCAN …） */
  op: string
  /** 命令参数（方言特定）。Mongo: { filter, options, pipeline, document, ... }；Redis: string[] 参数列表 */
  args?: unknown
  /** 执行上下文 */
  context?: {
    /** Mongo 库名 / Redis 不用 */
    database?: string
    /** Mongo 集合名 */
    collection?: string
    /** Redis 逻辑库索引 0..15 */
    dbIndex?: number
  }
  /** 超时毫秒 */
  timeoutMs?: number
  /** 返回行数上限（驱动按方言截断；Mongo 应用到游标，Redis 应用到 SCAN 总数） */
  maxRows?: number
}

/** NoSQL 命令结果。 */
export interface CommandResult {
  /**
   * 原生形状结果（JSON 可序列化）：
   * - Mongo find/aggregate: Array<Document>
   * - Mongo runCommand:     Document
   * - Mongo DML:            { acknowledged, insertedCount, modifiedCount, ... }
   * - Redis:                string | number | null | Array | Record
   */
  data: unknown
  /** 影响的文档/键数（DML 类） */
  affected?: number
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

/**
 * 命名空间化的键值存储原语：基座提供给插件持久化用（如审批单），
 * 由基座决定落内存还是服务端库；插件无需感知具体后端。
 */
export interface KvStore {
  get<T = unknown>(ns: string, key: string): Promise<T | null>
  set(ns: string, key: string, value: unknown): Promise<void>
  list<T = unknown>(ns: string): Promise<Array<{ key: string; value: T }>>
  delete(ns: string, key: string): Promise<void>
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
  /** 可选的持久化存储（基座提供时为服务端库/内存，缺省则插件自行用内存兜底）。 */
  kv?: KvStore
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
    // ── 手动提交会话 API ───────────────────────────────────────────
    // session 钉一个长连接，开个 txn；executeInSession 复用之；
    // commitSession 提交并自动开下一个 txn；rollbackSession 同理；
    // endSession 还连接给池。未支持的方言会抛 'COMMIT_MODE_UNSUPPORTED'。
    /** 返回 sessionId（不透明字符串） */
    beginSession(connId: string, options?: ExecuteOptions): Promise<string>
    executeInSession(
      sessionId: string,
      sql: string,
      params?: unknown[],
      options?: ExecuteOptions,
    ): Promise<QueryResult>
    commitSession(sessionId: string): Promise<void>
    rollbackSession(sessionId: string): Promise<void>
    endSession(sessionId: string): Promise<void>
    // ── NoSQL 平行通道 ────────────────────────────────────────────
    // MongoDB / Redis 等非 SQL 方言走此通道；SQL 方言驱动未实现时
    // 主进程会抛错 'COMMAND_CHANNEL_UNSUPPORTED'。
    executeCommand(connId: string, command: CommandRequest): Promise<CommandResult>
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
    /** 仅选文件路径，不读内容。用于 SQLite/DuckDB 等本地文件型数据库选库;
     *  allowCreate=true 允许选不存在的文件名(新建库)。Web 端可不实现。 */
    selectFile?(req?: {
      filters?: { name: string; extensions: string[] }[]
      allowCreate?: boolean
      defaultPath?: string
    }): Promise<string | null>
  }
  /** 窗口管理（桌面专属；Web 端 noop） */
  window?: {
    /** 复制 SPA 到新 BrowserWindow（用于跨连接 / 双 SQL 并排查看） */
    newSession?: () => Promise<void>
  }
  /** 应用菜单 → 渲染层命令路由（桌面专属） */
  menu?: {
    /** 主进程菜单点击时 push key，渲染层据此路由 */
    onCommand?: (handler: (key: string) => void) => () => void
  }
}
