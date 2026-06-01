/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConnectionConfig, ConnectionRef, MetaScope, QueryResult } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import type { DatabaseDriver, DriverConnection } from '../driver.js'
import { registerDriver } from '../registry.js'
import { LocalTransport } from './local.js'

function fakeConnection(): DriverConnection {
  return {
    async execute() {
      return { columns: [], rows: [], rowCount: 0 } as unknown as QueryResult
    },
    async fetchMetadata() {
      return []
    },
    async ping() {},
    async close() {},
  }
}

/**
 * 注册一个假驱动：connect 故意慢一拍（10ms），并对 connect 调用计数，
 * 这样并发 acquire 才能在缓存写入前都挤进来，暴露 check-then-act 竞态。
 */
function registerCountingDriver(dialect: DbDialect, opts: { failFirst?: boolean } = {}) {
  const state = { connectCalls: 0 }
  const driver: DatabaseDriver = {
    dialect,
    sql: {} as DatabaseDriver['sql'],
    async test() {
      return { ok: true }
    },
    async connect(_config: ConnectionConfig): Promise<DriverConnection> {
      const n = ++state.connectCalls
      await new Promise((r) => setTimeout(r, 10))
      if (opts.failFirst && n === 1) throw new Error('boom')
      return fakeConnection()
    },
  }
  registerDriver(driver)
  return state
}

const ref = (id: string): ConnectionRef => ({
  id,
  config: { id, name: id, dialect: DbDialect.DM } as ConnectionConfig,
})

const connScope = { parentKind: 'connection', path: [] } as unknown as MetaScope

describe('LocalTransport.acquire concurrency', () => {
  it('dedupes concurrent acquire for the same connId — connect runs once', async () => {
    const state = registerCountingDriver(DbDialect.DM)
    const t = new LocalTransport()

    await Promise.all([
      t.fetchMetadata(ref('c1'), connScope),
      t.fetchMetadata(ref('c1'), connScope),
      t.fetchMetadata(ref('c1'), connScope),
    ])

    // 竞态修复前：3 次 acquire 各建一条连接（dmdb 下第 2 条就 [20006]）。
    expect(state.connectCalls).toBe(1)
  })

  it('does not cache a failed connect — a later call retries', async () => {
    const state = registerCountingDriver(DbDialect.DM, { failFirst: true })
    const t = new LocalTransport()

    await expect(t.fetchMetadata(ref('c2'), connScope)).rejects.toThrow('boom')
    // 第一次失败不应污染缓存；第二次必须重新 connect。
    await t.fetchMetadata(ref('c2'), connScope)
    expect(state.connectCalls).toBe(2)
  })
})
