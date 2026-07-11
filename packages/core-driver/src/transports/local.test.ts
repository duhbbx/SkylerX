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

// ── 闲置断线自动重连：失败再重连重试一次（仅复用的缓存连接 + 连接级错误）──
const OK = { columns: [{ name: 'n' }], rows: [{ n: 1 }], rowCount: 1 } as unknown as QueryResult

class FakeConn implements DriverConnection {
  calls = 0
  closed = false
  // errorOn(nth) 返回要抛的错误，null/undefined 表示该次成功
  constructor(private readonly errorOn: (nth: number) => unknown) {}
  async execute() {
    const err = this.errorOn(++this.calls)
    if (err) throw err
    return OK
  }
  async fetchMetadata() {
    return []
  }
  async ping() {}
  async close() {
    this.closed = true
  }
}

/** 注册假驱动，按 connect 顺序给每条连接一个失败脚本；built 暴露所有建出来的连接。 */
function registerFlakyDriver(scripts: Array<(nth: number) => unknown>) {
  const built: FakeConn[] = []
  const driver: DatabaseDriver = {
    dialect: DbDialect.MySQL,
    sql: {} as DatabaseDriver['sql'],
    async test() {
      return { ok: true }
    },
    async connect(): Promise<DriverConnection> {
      const c = new FakeConn(scripts[built.length] ?? (() => null))
      built.push(c)
      return c
    },
  }
  registerDriver(driver)
  return built
}

const myRef = (id: string): ConnectionRef => ({
  id,
  config: { id, name: id, dialect: DbDialect.MySQL } as ConnectionConfig,
})
const scopedRef = (id: string, scopeId?: string): ConnectionRef => ({
  id,
  scope: scopeId ? { id: scopeId, kind: 'query-tab' } : undefined,
  config: { id, name: id, dialect: DbDialect.MySQL } as ConnectionConfig,
})
const LOST = Object.assign(new Error('Connection lost: The server closed the connection.'), {
  code: 'PROTOCOL_CONNECTION_LOST',
})
const REFUSED = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:56503'), {
  code: 'ECONNREFUSED',
})
const SYNTAX = new Error('You have an error in your SQL syntax')

describe('LocalTransport 自动重连', () => {
  it('复用的缓存连接遇连接级错误 → 丢弃旧连接、新连接重试一次并成功', async () => {
    const built = registerFlakyDriver([(n) => (n === 2 ? LOST : null), () => null])
    const t = new LocalTransport()
    await t.execute(myRef('r1'), 'SELECT 1') // 建连 #0
    const r = await t.execute(myRef('r1'), 'SELECT 1') // 复用 #0 断线 → 重连 #1 成功
    expect(r).toEqual(OK)
    expect(built).toHaveLength(2)
    expect(built[0].closed).toBe(true)
  })

  it('新建连接首次就断 → 不重试，直接抛错', async () => {
    const built = registerFlakyDriver([() => LOST])
    const t = new LocalTransport()
    await expect(t.execute(myRef('r2'), 'SELECT 1')).rejects.toThrow(/Connection lost/)
    expect(built).toHaveLength(1)
  })

  it('复用连接遇普通 SQL 错误 → 不重试', async () => {
    const built = registerFlakyDriver([(n) => (n === 2 ? SYNTAX : null)])
    const t = new LocalTransport()
    await t.execute(myRef('r3'), 'SELECT 1')
    await expect(t.execute(myRef('r3'), 'bad')).rejects.toThrow(/SQL syntax/)
    expect(built).toHaveLength(1)
    expect(built[0].closed).toBe(false)
  })

  it('重试也失败 → 抛第二次的错误，不无限重试', async () => {
    const built = registerFlakyDriver([(n) => (n === 2 ? LOST : null), () => LOST])
    const t = new LocalTransport()
    await t.execute(myRef('r4'), 'SELECT 1')
    await expect(t.execute(myRef('r4'), 'SELECT 1')).rejects.toThrow(/Connection lost/)
    expect(built).toHaveLength(2)
  })
})

describe('LocalTransport scoped connection caches', () => {
  it('caches different driver connections for different scopes of the same connId', async () => {
    const built = registerFlakyDriver([() => null, () => null])
    const t = new LocalTransport()

    await t.execute(scopedRef('s1', 'tab:a'), 'SELECT 1')
    await t.execute(scopedRef('s1', 'tab:b'), 'SELECT 1')
    await t.execute(scopedRef('s1', 'tab:a'), 'SELECT 1')

    expect(built).toHaveLength(2)
  })

  it('releaseScope closes only the matching scoped connection', async () => {
    const built = registerFlakyDriver([() => null, () => null])
    const t = new LocalTransport()

    await t.execute(scopedRef('s2', 'tab:a'), 'SELECT 1')
    await t.execute(scopedRef('s2', 'tab:b'), 'SELECT 1')
    await t.releaseScope('s2', { id: 'tab:a', kind: 'query-tab' })

    expect(built[0].closed).toBe(true)
    expect(built[1].closed).toBe(false)
  })

  it('disconnect closes all scoped connections for a connId', async () => {
    const built = registerFlakyDriver([() => null, () => null, () => null])
    const t = new LocalTransport()

    await t.execute(scopedRef('s3', 'tab:a'), 'SELECT 1')
    await t.execute(scopedRef('s3', 'tab:b'), 'SELECT 1')
    await t.execute(scopedRef('other', 'tab:a'), 'SELECT 1')
    await t.disconnect('s3')

    expect(built[0].closed).toBe(true)
    expect(built[1].closed).toBe(true)
    expect(built[2].closed).toBe(false)
  })

  it('reconnects once for ECONNREFUSED on a reused scoped connection', async () => {
    const built = registerFlakyDriver([(n) => (n === 2 ? REFUSED : null), () => null])
    const t = new LocalTransport()

    await t.execute(scopedRef('s4', 'tab:a'), 'SELECT 1')
    const result = await t.execute(scopedRef('s4', 'tab:a'), 'SELECT 1')

    expect(result).toEqual(OK)
    expect(built).toHaveLength(2)
    expect(built[0].closed).toBe(true)
  })

  it('cancel targets only the scoped cached driver', async () => {
    class CancelConn extends FakeConn {
      canceled = false
      async cancelActive() {
        this.canceled = true
      }
    }
    const built: CancelConn[] = []
    registerDriver({
      dialect: DbDialect.ClickHouse,
      sql: {} as DatabaseDriver['sql'],
      async test() {
        return { ok: true }
      },
      async connect(): Promise<DriverConnection> {
        const c = new CancelConn(() => null)
        built.push(c)
        return c
      },
    })
    const refA: ConnectionRef = {
      id: 's5',
      scope: { id: 'tab:a', kind: 'query-tab' },
      config: { id: 's5', name: 's5', dialect: DbDialect.ClickHouse } as ConnectionConfig,
    }
    const refB: ConnectionRef = {
      id: 's5',
      scope: { id: 'tab:b', kind: 'query-tab' },
      config: { id: 's5', name: 's5', dialect: DbDialect.ClickHouse } as ConnectionConfig,
    }
    const t = new LocalTransport()

    await t.execute(refA, 'SELECT 1')
    await t.execute(refB, 'SELECT 1')
    await t.cancel(refB)

    expect(built[0].canceled).toBe(false)
    expect(built[1].canceled).toBe(true)
  })

  it('does not cache an in-flight connection after its scope is released', async () => {
    let connectStarted!: () => void
    let allowConnect!: () => void
    const started = new Promise<void>((resolve) => {
      connectStarted = resolve
    })
    const allow = new Promise<void>((resolve) => {
      allowConnect = resolve
    })
    const built: FakeConn[] = []
    registerDriver({
      dialect: DbDialect.Snowflake,
      sql: {} as DatabaseDriver['sql'],
      async test() {
        return { ok: true }
      },
      async connect(): Promise<DriverConnection> {
        connectStarted()
        await allow
        const c = new FakeConn(() => null)
        built.push(c)
        return c
      },
    })
    const ref: ConnectionRef = {
      id: 's6',
      scope: { id: 'tab:a', kind: 'query-tab' },
      config: { id: 's6', name: 's6', dialect: DbDialect.Snowflake } as ConnectionConfig,
    }
    const t = new LocalTransport()

    const first = t.execute(ref, 'SELECT 1').catch((error: unknown) => error)
    await started
    await t.releaseScope('s6', ref.scope)
    allowConnect()

    await expect(first).resolves.toBeInstanceOf(Error)
    expect(built[0].closed).toBe(true)

    await t.execute(ref, 'SELECT 1')
    expect(built).toHaveLength(2)
  })
})
