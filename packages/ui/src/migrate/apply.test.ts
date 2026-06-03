/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { applyScript } from './apply'
import type { StmtRunner } from './validate'

const V = DbDialect.Vastbase
const DM = DbDialect.DM

function runner(failOn?: RegExp): { run: StmtRunner; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    run: async (sql) => {
      calls.push(sql)
      return failOn?.test(sql) ? { error: `boom: ${sql.slice(0, 8)}` } : {}
    },
  }
}
const ddl = 'CREATE TABLE t (a int);\nCREATE INDEX i ON t (a);'

describe('applyScript — PG atomic', () => {
  it('commit: BEGIN…COMMIT, all statements applied', async () => {
    const { run, calls } = runner()
    const r = await applyScript(run, ddl, V, { commit: true })
    expect(r).toMatchObject({ ok: true, committed: true, atomic: true, total: 2, succeeded: 2 })
    expect(calls[0]).toBe('BEGIN')
    expect(calls.at(-1)).toBe('COMMIT')
  })
  it('dry-run: BEGIN…ROLLBACK, validated but not committed', async () => {
    const { run, calls } = runner()
    const r = await applyScript(run, ddl, V, { commit: false })
    expect(r).toMatchObject({ ok: true, committed: false })
    expect(calls.at(-1)).toBe('ROLLBACK')
  })
  it('failure rolls back atomically', async () => {
    const { run, calls } = runner(/CREATE INDEX/)
    const r = await applyScript(run, ddl, V, { commit: true })
    expect(r).toMatchObject({ ok: false, committed: false, succeeded: 1 })
    expect(r.failedStatement).toBe('CREATE INDEX i ON t (a)')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
  })
})

describe('applyScript — non-atomic (DM)', () => {
  it('runs sequentially, no BEGIN/COMMIT, stops at first error', async () => {
    const { run, calls } = runner(/CREATE INDEX/)
    const r = await applyScript(run, ddl, DM, { commit: true })
    expect(r.atomic).toBe(false)
    expect(r.committed).toBe(true) // already-run statements persist (no rollback)
    expect(r.ok).toBe(false)
    expect(calls).not.toContain('BEGIN')
  })
  it('refuses dry-run on a non-transactional target', async () => {
    const { run } = runner()
    const r = await applyScript(run, ddl, DM, { commit: false })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不支持事务/)
  })
})
