import type {
  CommandRequest,
  CommandResult,
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetaScope,
  MetadataNode,
  QueryResult,
  TestResult,
} from '@db-tool/shared-types'

/**
 * 执行通道：抽象"SQL 在哪里执行"。
 *
 * 这是直连 / agent 双模可插拔的关键。上层（桌面主进程、Web 服务端）
 * 只面向本接口编程，至于是进程内直连（LocalTransport）还是转发到
 * 内网 agent（AgentTransport），是**部署选择**，不是代码分支。
 *
 * - 桌面端：恒用 LocalTransport。
 * - Web 一期：LocalTransport（同网段直连）。
 * - Web 中期：按连接配置在 Local / Agent 间切换；agent 本质是远端的一个 LocalTransport。
 */
export interface SqlTransport {
  /** 执行 SQL。 */
  execute(
    conn: ConnectionRef,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult>

  /** 拉取元数据。 */
  fetchMetadata(conn: ConnectionRef, scope: MetaScope): Promise<MetadataNode[]>

  /** 事务中按序执行多条语句（可编辑网格提交）。 */
  executeBatch(conn: ConnectionRef, statements: string[], options?: ExecuteOptions): Promise<void>

  /** 测试连接（不依赖已有连接）。 */
  testConnection(config: ConnectionConfig): Promise<TestResult>

  /** 取消某连接当前正在执行的语句（服务端取消）。 */
  cancel(conn: ConnectionRef): Promise<void>

  /** 主动断开某连接并清理其资源（如池）。 */
  disconnect(connId: string): Promise<void>

  // ── 手动提交会话 ──
  /** 钉连接、进入事务；返回 sessionId。方言不支持时抛 'COMMIT_MODE_UNSUPPORTED' */
  beginSession(conn: ConnectionRef, options?: ExecuteOptions): Promise<string>
  executeInSession(
    sessionId: string,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult>
  commitSession(sessionId: string): Promise<void>
  rollbackSession(sessionId: string): Promise<void>
  endSession(sessionId: string): Promise<void>

  // ── NoSQL 平行通道 ──
  // 上层(IPC handler / Web HTTP route)直接调本方法;
  // Local 实现里若驱动未实现则抛 'COMMAND_CHANNEL_UNSUPPORTED'。
  /** 执行 NoSQL 命令(Mongo / Redis 等)。 */
  executeCommand(conn: ConnectionRef, command: CommandRequest): Promise<CommandResult>
}

/**
 * 配置仓：执行层按连接 id 解析出完整配置（含解密后的密码）。
 * 桌面端实现 = 读本地 SQLite + safeStorage 解密；
 * Web 端实现 = 读服务端元数据库 + KMS 解密。
 */
export interface ConnectionConfigStore {
  resolve(connId: string): Promise<ConnectionConfig>
}
