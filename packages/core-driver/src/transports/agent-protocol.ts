import type {
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetaScope,
} from '@db-tool/shared-types'
import type { SqlTransport } from '../transport.js'

/**
 * Agent 转发的线协议。
 *
 * AgentTransport（中心侧）把每个 SqlTransport 调用序列化成 {method, payload}，
 * 经 AgentClient 发往内网 agent；agent 侧用 {@link dispatchAgentRpc} 把它还原成
 * 对本地 LocalTransport 的调用。两端共享本文件的类型，方言/元数据逻辑零重写。
 */
export type AgentRpcMethod =
  | 'execute'
  | 'fetchMetadata'
  | 'executeBatch'
  | 'testConnection'
  | 'cancel'
  | 'disconnect'

export interface AgentRpcPayloads {
  execute: { conn: ConnectionRef; sql: string; params?: unknown[]; options?: ExecuteOptions }
  fetchMetadata: { conn: ConnectionRef; scope: MetaScope }
  executeBatch: { conn: ConnectionRef; statements: string[]; options?: ExecuteOptions }
  testConnection: { config: ConnectionConfig }
  cancel: { conn: ConnectionRef }
  disconnect: { connId: string }
}

export interface AgentRpcRequest<M extends AgentRpcMethod = AgentRpcMethod> {
  method: M
  payload: AgentRpcPayloads[M]
}

/**
 * Agent 侧请求分发：把一条收到的 RPC 还原成对本地 transport 的调用。
 *
 * agent 宿主（HTTP/WS 服务）收到请求后调用本函数即可，transport 一般是
 * `new LocalTransport(localStore)`。返回值序列化后回传给中心。
 */
export async function dispatchAgentRpc(
  transport: SqlTransport,
  method: AgentRpcMethod,
  payload: AgentRpcPayloads[AgentRpcMethod],
): Promise<unknown> {
  switch (method) {
    case 'execute': {
      const p = payload as AgentRpcPayloads['execute']
      return transport.execute(p.conn, p.sql, p.params, p.options)
    }
    case 'fetchMetadata': {
      const p = payload as AgentRpcPayloads['fetchMetadata']
      return transport.fetchMetadata(p.conn, p.scope)
    }
    case 'executeBatch': {
      const p = payload as AgentRpcPayloads['executeBatch']
      await transport.executeBatch(p.conn, p.statements, p.options)
      return null
    }
    case 'testConnection': {
      const p = payload as AgentRpcPayloads['testConnection']
      return transport.testConnection(p.config)
    }
    case 'cancel': {
      const p = payload as AgentRpcPayloads['cancel']
      await transport.cancel(p.conn)
      return null
    }
    case 'disconnect': {
      const p = payload as AgentRpcPayloads['disconnect']
      await transport.disconnect(p.connId)
      return null
    }
    default: {
      throw new Error(`未知 agent RPC 方法：${String(method)}`)
    }
  }
}
