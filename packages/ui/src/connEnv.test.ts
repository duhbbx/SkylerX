import { describe, expect, it } from 'vitest'
import { connEnv, connReadOnly, isReadOnlyStatement } from './connEnv'

describe('connEnv', () => {
  it('reads valid env markers from extra.env', () => {
    expect(connEnv({ extra: { env: 'prod' } })).toBe('prod')
    expect(connEnv({ extra: { env: 'dev' } })).toBe('dev')
  })
  it('returns undefined for missing/invalid env', () => {
    expect(connEnv(undefined)).toBeUndefined()
    expect(connEnv({})).toBeUndefined()
    expect(connEnv({ extra: { env: 'staging' } })).toBeUndefined()
  })
})

describe('connReadOnly', () => {
  it('is true only when extra.readOnly === true', () => {
    expect(connReadOnly({ extra: { readOnly: true } })).toBe(true)
    expect(connReadOnly({ extra: { readOnly: false } })).toBe(false)
    expect(connReadOnly({ extra: {} })).toBe(false)
    expect(connReadOnly(undefined)).toBe(false)
  })
})

describe('isReadOnlyStatement', () => {
  it('allows read statements', () => {
    for (const s of ['SELECT 1', '  with x as (select 1) select * from x', 'SHOW TABLES', 'EXPLAIN SELECT 1', 'DESC users', 'DESCRIBE users', 'PRAGMA table_info(t)']) {
      expect(isReadOnlyStatement(s)).toBe(true)
    }
  })
  it('rejects write statements', () => {
    for (const s of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'DROP TABLE t', 'CREATE TABLE t (a int)', 'TRUNCATE t', 'ALTER TABLE t ADD c int']) {
      expect(isReadOnlyStatement(s)).toBe(false)
    }
  })
})
