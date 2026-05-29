/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SqlTransport } from '../transport.js'
import type { AgentClient } from './agent.js'
import { type AgentRpcMethod, type AgentRpcPayloads, dispatchAgentRpc } from './agent-protocol.js'

/**
 * 进程内回环客户端：不走网络，直接在本进程把 RPC 派发给一个 SqlTransport。
 *
 * 用途：① 单元/集成测试无需起 agent 服务；② 单机 / 开发态把「agent 模式」
 * 退化成本地直连，便于在不部署 agent 的情况下走通同一条代码路径。
 */
export class LoopbackAgentClient implements AgentClient {
  /** 传单个 transport（所有 agentId 都路由到它），或传按 agentId 解析的函数。 */
  constructor(
    private readonly resolve: SqlTransport | ((agentId: string) => SqlTransport | undefined),
  ) {}

  async call<T>(agentId: string, method: string, payload: unknown): Promise<T> {
    const transport =
      typeof this.resolve === 'function' ? this.resolve(agentId) : this.resolve
    if (!transport) throw new Error(`没有为 agent「${agentId}」注册本地 transport`)
    return (await dispatchAgentRpc(
      transport,
      method as AgentRpcMethod,
      payload as AgentRpcPayloads[AgentRpcMethod],
    )) as T
  }
}

/** 一个 agent 的接入点：基址 + 可选鉴权令牌。 */
export interface AgentEndpoint {
  /** agent 宿主基址，如 https://agent-vpc-a.internal:8443 */
  url: string
  /** 可选 Bearer 令牌（中心 ↔ agent 互信） */
  token?: string
}

/**
 * HTTP 客户端：把 RPC POST 到对应 agent 的 `${url}/rpc`。
 *
 * agent 侧需提供一个把 {method, payload} 交给 {@link dispatchAgentRpc} 的 HTTP 端点
 * （见 db-tool-web 中的 agent 宿主）。这里只依赖全局 fetch（Node 18+），无额外依赖。
 */
export class HttpAgentClient implements AgentClient {
  constructor(
    private readonly endpoints: Map<string, AgentEndpoint> | ((agentId: string) => AgentEndpoint | undefined),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(agentId: string, method: string, payload: unknown): Promise<T> {
    const ep =
      typeof this.endpoints === 'function' ? this.endpoints(agentId) : this.endpoints.get(agentId)
    if (!ep) throw new Error(`未知 agent「${agentId}」：缺少接入点配置`)

    const res = await this.fetchImpl(`${ep.url.replace(/\/$/, '')}/rpc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ep.token ? { authorization: `Bearer ${ep.token}` } : {}),
      },
      body: JSON.stringify({ method, payload }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`agent「${agentId}」RPC ${method} 失败：HTTP ${res.status} ${text}`)
    }
    return (await res.json()) as T
  }
}
