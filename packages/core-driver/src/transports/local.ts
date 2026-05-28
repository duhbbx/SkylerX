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
import type { DriverConnection } from '../driver.js'
import { getDriver } from '../registry.js'
import type { ConnectionConfigStore, SqlTransport } from '../transport.js'

/**
 * 进程内直连：在当前 Node 进程里用原生方言驱动直接连目标库。
 *
 * 桌面端（Electron 主进程）与 Web 一期（Node 服务端同网段）都用它。
 * 内部按连接 id 缓存已建立的 DriverConnection，避免重复握手。
 */
export class LocalTransport implements SqlTransport {
  private readonly connections = new Map<string, DriverConnection>()
  /** sessionId → 持有 session 的 DriverConnection（用于 commit/rollback/end 路由） */
  private readonly sessionOwners = new Map<string, DriverConnection>()

  constructor(private readonly store?: ConnectionConfigStore) {}

  async execute(
    conn: ConnectionRef,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const connection = await this.acquire(conn)
    return connection.execute(sql, params, options)
  }

  async fetchMetadata(conn: ConnectionRef, scope: MetaScope): Promise<MetadataNode[]> {
    const connection = await this.acquire(conn)
    return connection.fetchMetadata(scope)
  }

  async executeBatch(
    conn: ConnectionRef,
    statements: string[],
    options?: ExecuteOptions,
  ): Promise<void> {
    const connection = await this.acquire(conn)
    if (!connection.executeBatch) throw new Error('当前驱动不支持事务批执行')
    await connection.executeBatch(statements, options)
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    return getDriver(config.dialect).test(config)
  }

  async cancel(conn: ConnectionRef): Promise<void> {
    const connection = this.connections.get(conn.id)
    if (connection?.cancelActive) await connection.cancelActive()
  }

  async disconnect(connId: string): Promise<void> {
    const connection = this.connections.get(connId)
    if (connection) {
      this.connections.delete(connId)
      await connection.close()
    }
  }

  // ── 手动提交会话路由：begin 走 acquire；其余按 sessionId 找回持有者 ──
  async beginSession(conn: ConnectionRef, options?: ExecuteOptions): Promise<string> {
    const connection = await this.acquire(conn)
    if (!connection.beginSession) {
      // 与上层约定的错误码，QueryPane 拿到就 toast 提示
      throw new Error('COMMIT_MODE_UNSUPPORTED')
    }
    const sid = await connection.beginSession(options)
    this.sessionOwners.set(sid, connection)
    return sid
  }
  async executeInSession(
    sessionId: string,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    const owner = this.sessionOwners.get(sessionId)
    if (!owner?.executeInSession) throw new Error('SESSION_NOT_FOUND')
    return owner.executeInSession(sessionId, sql, params, options)
  }
  async commitSession(sessionId: string): Promise<void> {
    const owner = this.sessionOwners.get(sessionId)
    if (!owner?.commitSession) throw new Error('SESSION_NOT_FOUND')
    await owner.commitSession(sessionId)
  }
  async rollbackSession(sessionId: string): Promise<void> {
    const owner = this.sessionOwners.get(sessionId)
    if (!owner?.rollbackSession) throw new Error('SESSION_NOT_FOUND')
    await owner.rollbackSession(sessionId)
  }
  async endSession(sessionId: string): Promise<void> {
    const owner = this.sessionOwners.get(sessionId)
    if (!owner) return // 幂等：找不到当作已结束
    this.sessionOwners.delete(sessionId)
    if (owner.endSession) await owner.endSession(sessionId)
  }

  // ── NoSQL 命令通道:按 connId 取连接(底层是 Mongo/Redis 驱动)后转发 ──
  async executeCommand(conn: ConnectionRef, command: CommandRequest): Promise<CommandResult> {
    const connection = await this.acquire(conn)
    if (!connection.executeCommand) {
      // 与上层约定的错误码,前端拿到就提示"此方言不支持命令通道"
      throw new Error('COMMAND_CHANNEL_UNSUPPORTED')
    }
    return connection.executeCommand(command)
  }

  /** 关闭全部连接（进程退出时调用）。 */
  async dispose(): Promise<void> {
    const all = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(all.map((c) => c.close()))
  }

  /** 取已缓存连接，无则按配置建立。 */
  private async acquire(conn: ConnectionRef): Promise<DriverConnection> {
    const existing = this.connections.get(conn.id)
    if (existing) return existing

    const config = await this.resolveConfig(conn)
    const connection = await getDriver(config.dialect).connect(config)
    this.connections.set(conn.id, connection)
    return connection
  }

  private async resolveConfig(conn: ConnectionRef): Promise<ConnectionConfig> {
    if (conn.config) return conn.config
    if (!this.store) {
      throw new Error(
        `ConnectionRef(${conn.id}) 未内联 config，且 LocalTransport 未配置 ConnectionConfigStore。`,
      )
    }
    return this.store.resolve(conn.id)
  }
}
