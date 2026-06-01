/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { connEnv, connReadOnly, isReadOnlyStatement, isStructureChangingStatement } from './connEnv'

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
    for (const s of [
      'SELECT 1',
      '  with x as (select 1) select * from x',
      'SHOW TABLES',
      'EXPLAIN SELECT 1',
      'DESC users',
      'DESCRIBE users',
      'PRAGMA table_info(t)',
    ]) {
      expect(isReadOnlyStatement(s)).toBe(true)
    }
  })
  it('rejects write statements', () => {
    for (const s of [
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a=1',
      'DELETE FROM t',
      'DROP TABLE t',
      'CREATE TABLE t (a int)',
      'TRUNCATE t',
      'ALTER TABLE t ADD c int',
    ]) {
      expect(isReadOnlyStatement(s)).toBe(false)
    }
  })
})

describe('isStructureChangingStatement', () => {
  it('flags DDL that adds/removes/renames objects', () => {
    for (const s of [
      'CREATE TABLE t (a int)',
      'create or replace package pkg as end;',
      '  DROP SYNONYM s',
      'ALTER TABLE t ADD c int',
      'TRUNCATE TABLE t',
      'RENAME a TO b',
      "COMMENT ON TABLE t IS 'x'",
    ]) {
      expect(isStructureChangingStatement(s)).toBe(true)
    }
  })
  it('ignores DML / reads / privilege changes', () => {
    for (const s of [
      'SELECT 1',
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a=1',
      'DELETE FROM t',
      'GRANT SELECT ON t TO u',
      'REVOKE SELECT ON t FROM u',
    ]) {
      expect(isStructureChangingStatement(s)).toBe(false)
    }
  })
  it('sees through leading comments', () => {
    expect(isStructureChangingStatement('-- make a table\nCREATE TABLE t (a int)')).toBe(true)
    expect(isStructureChangingStatement('/* ddl */ DROP TABLE t')).toBe(true)
    // a comment that merely mentions create must not flip a SELECT
    expect(isStructureChangingStatement('-- create later\nSELECT 1')).toBe(false)
  })
})
