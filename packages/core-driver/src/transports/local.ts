/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
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
 * 「连接已断」类错误：连接闲置过久被服务端关闭、网络抖动、TCP 半开等。
 * 这类错误在丢弃旧连接、用新连接重试后通常即可恢复，不该当成「连不上」弹连接窗口。
 *
 * 只匹配明确的「连接断开」信号，**不**含泛化的 ETIMEDOUT —— 后者可能是慢查询/语句超时，
 * 重试它会把超时的查询又跑一遍。命中范围尽量保守，宁可漏判（照常报错）也不误判（乱重试）。
 */
function isStaleConnError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : ''
  const re =
    /PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|Connection lost|Connection terminated|server closed the connection|terminating connection|Client has encountered a connection error|socket hang up|This socket has been ended|Cannot use a pool after calling end|connection is closed|read ECONNRESET/i
  return re.test(msg) || re.test(code)
}

/**
 * 进程内直连：在当前 Node 进程里用原生方言驱动直接连目标库。
 *
 * 桌面端（Electron 主进程）与 Web 一期（Node 服务端同网段）都用它。
 * 内部按连接 id 缓存已建立的 DriverConnection，避免重复握手。
 */
export class LocalTransport implements SqlTransport {
  private readonly connections = new Map<string, DriverConnection>()
  /** 进行中的建连 Promise（按 connId 去重并发 acquire，避免重复 connect()/建池） */
  private readonly pending = new Map<string, Promise<DriverConnection>>()
  /** sessionId → 持有 session 的 DriverConnection（用于 commit/rollback/end 路由） */
  private readonly sessionOwners = new Map<string, DriverConnection>()

  constructor(private readonly store?: ConnectionConfigStore) {}

  async execute(
    conn: ConnectionRef,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    return this.withReconnect(conn, (c) => c.execute(sql, params, options))
  }

  async fetchMetadata(conn: ConnectionRef, scope: MetaScope): Promise<MetadataNode[]> {
    return this.withReconnect(conn, (c) => c.fetchMetadata(scope))
  }

  async executeBatch(
    conn: ConnectionRef,
    statements: string[],
    options?: ExecuteOptions,
  ): Promise<void> {
    // 批执行在驱动里整体包事务：建连即失败 ⇒ 什么都没提交，整批重放是安全的。
    await this.withReconnect(conn, (c) => {
      if (!c.executeBatch) throw new Error('当前驱动不支持事务批执行')
      return c.executeBatch(statements, options)
    })
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
    return this.withReconnect(conn, (c) => {
      if (!c.executeCommand) {
        // 与上层约定的错误码,前端拿到就提示"此方言不支持命令通道"
        throw new Error('COMMAND_CHANNEL_UNSUPPORTED')
      }
      return c.executeCommand(command)
    })
  }

  /** 关闭全部连接（进程退出时调用）。 */
  async dispose(): Promise<void> {
    const all = [...this.connections.values()]
    this.connections.clear()
    await Promise.allSettled(all.map((c) => c.close()))
  }

  /**
   * 执行操作，遇「连接已断」自动重连重试一次（非事务通道用）。
   *
   * 策略：乐观执行（正常路径零额外开销，不做无谓的 ping 预检）。失败时只有同时满足
   *   1) 这条连接是从缓存**复用**的（reused）——新建即失败说明服务端真连不上，重试无意义；
   *   2) 错误是 isStaleConnError 认定的「连接断开」类
   * 才丢弃旧连接、用新连接重试一次。其余一律原样抛出（前端据此弹连接窗口）。
   *
   * 注意：闲置被服务端关闭的连接，查询根本没送达服务端，重放绝对安全（最常见，正是要解决的场景）；
   * 极少数「连接在服务端已执行后才断」的写操作重放可能重复，这是 auto-reconnect 通用取舍。
   * 事务会话（executeInSession 等）不走这里：事务状态无法重放。
   */
  private async withReconnect<T>(
    conn: ConnectionRef,
    run: (c: DriverConnection) => Promise<T>,
  ): Promise<T> {
    const reused = this.connections.has(conn.id)
    const connection = await this.acquire(conn)
    try {
      return await run(connection)
    } catch (err) {
      if (!reused || !isStaleConnError(err)) throw err
      console.warn(
        `[transport] connection ${conn.id} appears stale (${err instanceof Error ? err.message : err}); reconnecting and retrying once`,
      )
      await this.disconnect(conn.id).catch(() => {})
      const fresh = await this.acquire(conn)
      return run(fresh)
    }
  }

  /** 取已缓存连接，无则按配置建立。 */
  private async acquire(conn: ConnectionRef): Promise<DriverConnection> {
    const existing = this.connections.get(conn.id)
    if (existing) return existing

    // 复用进行中的建连 Promise：并发 acquire 同一 connId 时只 connect() 一次。
    // 之前是 check-then-act（get → await connect → set），两个并发调用都看到空缓存
    // 各建一条连接 → 各建一个池。多数驱动只是浪费/泄漏池，但 dmdb 对省略 poolAlias
    // 的池一律登记为 "default"，第二个直接抛 [20006] ECJS_POOL_ALIAS_CONFLICT。
    const inflight = this.pending.get(conn.id)
    if (inflight) return inflight

    const building = (async () => {
      const config = await this.resolveConfig(conn)
      const connection = await getDriver(config.dialect).connect(config)
      this.connections.set(conn.id, connection)
      return connection
    })()
    this.pending.set(conn.id, building)
    // 成败都清理 pending：成功后已落入 connections；失败后允许下次重连（不缓存失败）。
    void building.finally(() => this.pending.delete(conn.id)).catch(() => {})
    return building
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
