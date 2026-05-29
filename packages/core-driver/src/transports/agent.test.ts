/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import type {
  ConnectionConfig,
  ConnectionRef,
  ExecuteOptions,
  MetaScope,
  QueryResult,
} from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import type { SqlTransport } from '../transport.js'
import { AgentTransport } from './agent.js'
import { LoopbackAgentClient } from './agent-clients.js'

/** 记录调用的假 transport，模拟 agent 侧的 LocalTransport（不连真库）。 */
class SpyTransport implements SqlTransport {
  calls: { method: string; args: unknown[] }[] = []

  async execute(conn: ConnectionRef, sql: string, params?: unknown[], options?: ExecuteOptions) {
    this.calls.push({ method: 'execute', args: [conn, sql, params, options] })
    return { columns: [{ name: 'n' }], rows: [{ n: 1 }], rowCount: 1 } as unknown as QueryResult
  }
  async fetchMetadata(conn: ConnectionRef, scope: MetaScope) {
    this.calls.push({ method: 'fetchMetadata', args: [conn, scope] })
    return [{ kind: 'table', name: 't', path: ['t'] }] as never
  }
  async executeBatch(conn: ConnectionRef, statements: string[], options?: ExecuteOptions) {
    this.calls.push({ method: 'executeBatch', args: [conn, statements, options] })
  }
  async testConnection(config: ConnectionConfig) {
    this.calls.push({ method: 'testConnection', args: [config] })
    return { ok: true }
  }
  async cancel(conn: ConnectionRef) {
    this.calls.push({ method: 'cancel', args: [conn] })
  }
  async disconnect(connId: string) {
    this.calls.push({ method: 'disconnect', args: [connId] })
  }
}

const ref = (agentId?: string): ConnectionRef => ({
  id: 'c1',
  config: { id: 'c1', name: 'x', dialect: DbDialect.MySQL, host: 'h', port: 3306, user: 'u', agentId },
})

describe('AgentTransport ↔ dispatchAgentRpc (loopback)', () => {
  it('serializes execute through the client and back into the local transport', async () => {
    const spy = new SpyTransport()
    const t = new AgentTransport(new LoopbackAgentClient(spy))

    const r = await t.execute(ref('a1'), 'SELECT 1', [], { database: 'db' })

    expect(r.rowCount).toBe(1)
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].method).toBe('execute')
    expect(spy.calls[0].args[1]).toBe('SELECT 1')
    expect(spy.calls[0].args[3]).toEqual({ database: 'db' })
  })

  it('forwards fetchMetadata / executeBatch / cancel / testConnection', async () => {
    const spy = new SpyTransport()
    const t = new AgentTransport(new LoopbackAgentClient(spy))

    await t.fetchMetadata(ref('a1'), { connId: 'c1' } as MetaScope)
    await t.executeBatch(ref('a1'), ['UPDATE t SET x=1'], undefined)
    await t.cancel(ref('a1'))
    await t.testConnection(ref('a1').config!)

    expect(spy.calls.map((c) => c.method)).toEqual([
      'fetchMetadata',
      'executeBatch',
      'cancel',
      'testConnection',
    ])
  })

  it('routes disconnect to the agent that served the connection', async () => {
    const spy = new SpyTransport()
    const t = new AgentTransport(new LoopbackAgentClient(spy))

    await t.execute(ref('a1'), 'SELECT 1') // 建立 connId→agentId 路由
    await t.disconnect('c1')

    expect(spy.calls.at(-1)).toEqual({ method: 'disconnect', args: ['c1'] })
  })

  it('disconnect for an unknown connection is a no-op (never routed)', async () => {
    const spy = new SpyTransport()
    const t = new AgentTransport(new LoopbackAgentClient(spy))

    await t.disconnect('never-seen')

    expect(spy.calls).toHaveLength(0)
  })

  it('throws when the connection lacks an agentId', async () => {
    const spy = new SpyTransport()
    const t = new AgentTransport(new LoopbackAgentClient(spy))

    await expect(t.execute(ref(undefined), 'SELECT 1')).rejects.toThrow(/agentId/)
  })
})
