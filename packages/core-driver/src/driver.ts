import type {
  ConnectionConfig,
  DbDialect,
  ExecuteOptions,
  MetaScope,
  MetadataNode,
  QueryResult,
  TestResult,
} from '@db-tool/shared-types'

/**
 * 一条已建立的、绑定到某个 ConnectionConfig 的物理/池化连接。
 * 由具体方言的 DatabaseDriver 创建，封装底层原生驱动（mysql2 / pg / oracledb...）。
 */
export interface DriverConnection {
  /** 执行 SQL；SELECT 返回 rows，DML 返回 affectedRows。 */
  execute(sql: string, params?: unknown[], options?: ExecuteOptions): Promise<QueryResult>

  /** 在单连接 + 事务中按序执行多条语句（用于可编辑网格提交）；可选实现。 */
  executeBatch?(statements: string[], options?: ExecuteOptions): Promise<void>

  /** 取消当前正在执行的语句（MySQL KILL QUERY / PG pg_cancel_backend）；可选实现。 */
  cancelActive?(): Promise<void>

  // ── 手动提交会话（可选实现，未实现的方言会被上层 toast 拦截）──
  // 不像 executeBatch 一次性跑完，session 让上层"开 → 多次执行 → 显式提交/回滚 → 关"，
  // 适合 QueryPane 的"手动提交"模式。
  /** 钉一条池里的连接、进入事务；返回不透明 sessionId */
  beginSession?(options?: ExecuteOptions): Promise<string>
  executeInSession?(
    sessionId: string,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult>
  /** 提交当前事务并自动开下一个（用户继续编辑，无需再次 begin） */
  commitSession?(sessionId: string): Promise<void>
  /** 回滚当前事务并自动开下一个 */
  rollbackSession?(sessionId: string): Promise<void>
  /** 关闭会话：还连接给池；若仍有未提交事务，按当前方言语义回滚 */
  endSession?(sessionId: string): Promise<void>

  /** 按范围拉取元数据（库/schema/表/列/索引），支持懒加载下钻。 */
  fetchMetadata(scope: MetaScope): Promise<MetadataNode[]>

  /** 轻量探活（如 SELECT 1）。 */
  ping(): Promise<void>

  /** 释放连接（归还池或断开）。 */
  close(): Promise<void>
}

/**
 * 方言驱动：每种数据库一个实现，封装"如何连接、如何执行、如何读元数据"。
 *
 * 它只负责"用什么方式跟这种库说话"，**不关心**连接配置存在哪、
 * 也不关心是在本地直连还是经 agent 转发——后者由 {@link SqlTransport} 决定。
 */
export interface DatabaseDriver {
  readonly dialect: DbDialect

  /** 用给定配置建立一条连接。 */
  connect(config: ConnectionConfig): Promise<DriverConnection>

  /** 不建立持久连接，仅做一次性连通性测试。 */
  test(config: ConnectionConfig): Promise<TestResult>

  /**
   * 方言相关的 SQL 辅助（标识符转义、分页改写等），
   * 供上层（如风险 SQL 校验、自动分页）复用。
   */
  readonly sql: SqlDialectHelpers
}

/** 方言相关的 SQL 工具方法。 */
export interface SqlDialectHelpers {
  /** 转义标识符，如 mysql 用反引号、pg 用双引号。 */
  quoteIdentifier(name: string): string

  /** 为一条 SELECT 套上分页（limit/offset 或 ROWNUM 等方言写法）。 */
  paginate(sql: string, limit: number, offset: number): string
}

/**
 * 应用层往 `ConnectionConfig.extra` 里塞的元数据键名集合
 * （生产环境标记、只读模式、未来其它 UI/工作流字段...）。
 * 这些键不能透传给底层驱动（如 mysql2 会对未知配置抛 invalid configuration option）。
 *
 * 各方言适配在拼装驱动 options 时统一用 `driverExtra(config)` 取已剥离的安全 extra。
 */
export const APP_META_EXTRA_KEYS = ['env', 'readOnly', 'agentId', 'commitMode'] as const

/**
 * 取「可以安全传给原生驱动」的 extra 子集：剥掉应用层元数据键。
 * 没有 extra 时返回 undefined（保留旧行为，避免给驱动一个 {}）。
 */
export function driverExtra(config: ConnectionConfig): Record<string, unknown> | undefined {
  const src = config.extra
  if (!src || typeof src !== 'object') return undefined
  const out: Record<string, unknown> = {}
  let kept = 0
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if ((APP_META_EXTRA_KEYS as readonly string[]).includes(k)) continue
    out[k] = v
    kept++
  }
  return kept ? out : undefined
}
