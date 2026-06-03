/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import {
  type StmtRunner,
  splitStatements,
  supportsTxnValidation,
  validateDdl,
  validateInTxn,
} from './validate'

describe('splitStatements', () => {
  it('strips comment lines and splits on ;', () => {
    expect(
      splitStatements('-- header\nCREATE TABLE t (a int);\n-- c\nCREATE INDEX i ON t (a);'),
    ).toEqual(['CREATE TABLE t (a int)', 'CREATE INDEX i ON t (a)'])
  })
})

describe('supportsTxnValidation', () => {
  it('only PG-family supports transactional DDL validation', () => {
    expect(supportsTxnValidation(DbDialect.Vastbase)).toBe(true)
    expect(supportsTxnValidation(DbDialect.PostgreSQL)).toBe(true)
    expect(supportsTxnValidation(DbDialect.MySQL)).toBe(false)
    expect(supportsTxnValidation(DbDialect.Oracle)).toBe(false)
    expect(supportsTxnValidation(DbDialect.DM)).toBe(false)
  })
})

/** mock runner: throws-as-error for statements matching `failOn`. */
function runner(failOn?: RegExp): { run: StmtRunner; calls: string[] } {
  const calls: string[] = []
  const run: StmtRunner = async (sql) => {
    calls.push(sql)
    return failOn?.test(sql) ? { error: `syntax error near "${sql.slice(0, 10)}"` } : {}
  }
  return { run, calls }
}

describe('validateInTxn', () => {
  it('wraps in BEGIN/ROLLBACK and passes when all statements succeed', async () => {
    const { run, calls } = runner()
    const r = await validateInTxn(run, 'CREATE TABLE t (a int);\nCREATE INDEX i ON t (a);')
    expect(r).toEqual({ ok: true, supported: true })
    expect(calls[0]).toBe('BEGIN')
    expect(calls.at(-1)).toBe('ROLLBACK') // always rolls back — no residue
  })

  it('stops at first failing statement, reports it, still rolls back', async () => {
    const { run, calls } = runner(/CREATE INDEX/)
    const r = await validateInTxn(run, 'CREATE TABLE t (a int);\nCREATE INDEX i ON t (a);')
    expect(r.ok).toBe(false)
    expect(r.failedStatement).toBe('CREATE INDEX i ON t (a)')
    expect(r.error).toMatch(/syntax error/)
    expect(calls).toContain('ROLLBACK')
  })

  it('empty DDL → ok without touching the connection', async () => {
    const { run, calls } = runner()
    expect(await validateInTxn(run, '-- only a comment')).toEqual({ ok: true, supported: true })
    expect(calls).toEqual([])
  })
})

describe('validateDdl', () => {
  it('skips (supported=false) for non-PG targets', async () => {
    const { run, calls } = runner()
    const r = await validateDdl(run, 'CREATE TABLE t (a int)', DbDialect.MySQL)
    expect(r).toEqual({ ok: true, supported: false })
    expect(calls).toEqual([]) // never ran anything on an unsupported target
  })
  it('runs txn validation for PG-family', async () => {
    const { run } = runner()
    const r = await validateDdl(run, 'CREATE TABLE t (a int)', DbDialect.Vastbase)
    expect(r.supported).toBe(true)
    expect(r.ok).toBe(true)
  })
})
