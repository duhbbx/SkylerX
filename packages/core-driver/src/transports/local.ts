import type {
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetadataNode,
  MetaScope,
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
