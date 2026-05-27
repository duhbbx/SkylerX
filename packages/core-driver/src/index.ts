/**
 * @db-tool/core-driver
 *
 * 数据库驱动抽象层 + 执行通道。桌面端（Electron 主进程）与 Web 服务端共用。
 *
 * 分层：
 *   SqlTransport      —— 决定 SQL「在哪执行」(Local 直连 / Agent 转发)
 *     └─ DatabaseDriver —— 决定「如何跟某种方言说话」(连接/执行/元数据)
 *          └─ 原生驱动 (mysql2 / pg / oracledb ...)
 *
 * 典型用法：
 *   import { LocalTransport, registerBuiltinDrivers } from '@db-tool/core-driver'
 *   registerBuiltinDrivers()
 *   const transport = new LocalTransport(configStore)
 *   const result = await transport.execute({ id: connId }, 'SELECT 1')
 */

// 类型（透传 shared-types，方便调用方单点导入）
export type {
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetadataNode,
  MetaScope,
  QueryColumn,
  QueryResult,
  SshConfig,
  SslConfig,
  TestResult,
} from '@db-tool/shared-types'
export { DbDialect, MetaNodeKind, TransportMode } from '@db-tool/shared-types'

// 接口
export type { DatabaseDriver, DriverConnection, SqlDialectHelpers } from './driver.js'
export type { ConnectionConfigStore, SqlTransport } from './transport.js'

// 注册中心
export { getDriver, hasDriver, registerDriver, registeredDialects } from './registry.js'

// 执行通道实现
export { LocalTransport } from './transports/local.js'
export { AgentTransport, type AgentClient } from './transports/agent.js'
// Agent 转发：线协议 + 服务端分发 + 现成客户端（回环 / HTTP）
export {
  type AgentRpcMethod,
  type AgentRpcPayloads,
  type AgentRpcRequest,
  dispatchAgentRpc,
} from './transports/agent-protocol.js'
export {
  type AgentEndpoint,
  HttpAgentClient,
  LoopbackAgentClient,
} from './transports/agent-clients.js'

// 方言
export { registerBuiltinDrivers } from './dialects/index.js'
export { DRIVER_PACKAGES } from './dialects/base.js'
