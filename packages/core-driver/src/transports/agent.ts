import type {
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetadataNode,
  MetaScope,
  QueryResult,
  TestResult,
} from '@db-tool/shared-types'
import type { SqlTransport } from '../transport.js'

/**
 * agent 转发通道（中期能力，当前为占位骨架）。
 *
 * 设计意图：当目标库位于隔离网段（生产 VPC、内网堡垒区），中心 Web 服务
 * 连不到时，在该网段部署一个轻量 agent —— agent 内部其实就跑着一个
 * LocalTransport + core-driver。AgentTransport 负责把请求序列化后经
 * gRPC/WS 发给对应 agent，由 agent 在本地执行后回传结果。
 *
 * 这样方言/元数据逻辑在 agent 端零重写，且生产库无需对中心服务开放端口。
 */
export interface AgentClient {
  /** 向指定 agent 发送一个 RPC 调用并等待结果。 */
  call<T>(agentId: string, method: string, payload: unknown): Promise<T>
}

export class AgentTransport implements SqlTransport {
  /** connId → agentId 路由表（随请求逐步填充，供 disconnect 路由用） */
  private readonly routes = new Map<string, string>()

  constructor(private readonly client: AgentClient) {}

  async execute(
    conn: ConnectionRef,
    sql: string,
    params?: unknown[],
    options?: ExecuteOptions,
  ): Promise<QueryResult> {
    return this.client.call<QueryResult>(this.agentOf(conn), 'execute', {
      conn,
      sql,
      params,
      options,
    })
  }

  async fetchMetadata(conn: ConnectionRef, scope: MetaScope): Promise<MetadataNode[]> {
    return this.client.call<MetadataNode[]>(this.agentOf(conn), 'fetchMetadata', { conn, scope })
  }

  async executeBatch(
    conn: ConnectionRef,
    statements: string[],
    options?: ExecuteOptions,
  ): Promise<void> {
    return this.client.call<void>(this.agentOf(conn), 'executeBatch', { conn, statements, options })
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const agentId = config.agentId
    if (!agentId) {
      return { ok: false, message: 'agent 模式下 ConnectionConfig.agentId 不可为空' }
    }
    return this.client.call<TestResult>(agentId, 'testConnection', { config })
  }

  async cancel(conn: ConnectionRef): Promise<void> {
    return this.client.call<void>(this.agentOf(conn), 'cancel', { conn })
  }

  async disconnect(connId: string): Promise<void> {
    const agentId = this.routes.get(connId)
    if (!agentId) return // 该连接从未经本 transport 路由过，无需远端断开
    this.routes.delete(connId)
    await this.client.call<void>(agentId, 'disconnect', { connId })
  }

  private agentOf(conn: ConnectionRef): string {
    const agentId = conn.config?.agentId
    if (!agentId) {
      throw new Error(`ConnectionRef(${conn.id}) 缺少 agentId，无法路由到 agent。`)
    }
    this.routes.set(conn.id, agentId) // 记录路由，供 disconnect 用
    return agentId
  }
}
