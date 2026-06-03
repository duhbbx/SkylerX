/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { translateSql } from './sqlTranslate'

const O = DbDialect.Oracle
const V = DbDialect.Vastbase
const DM = DbDialect.DM
const MY = DbDialect.MySQL

describe('translateSql', () => {
  it('simple Oracle view → deterministic, no AI; functions mapped (PG target)', () => {
    const r = translateSql(
      "CREATE VIEW v AS SELECT id, NVL(name, 'x') AS name, SYSDATE AS now FROM emp",
      O,
      V,
    )
    expect(r.needsAi).toBe(false)
    expect(r.sql).toContain('COALESCE(') // NVL → COALESCE
    expect(r.sql).toContain('CURRENT_TIMESTAMP') // SYSDATE → CURRENT_TIMESTAMP
  })

  it('MINUS → EXCEPT and FROM DUAL dropped for PG target', () => {
    const r = translateSql('SELECT a FROM t MINUS SELECT 1 FROM DUAL', O, V)
    expect(r.needsAi).toBe(false)
    expect(r.sql).toContain('EXCEPT')
    expect(r.sql).not.toMatch(/FROM\s+DUAL/i)
  })

  it('DM target keeps Oracle-compatible NVL', () => {
    const r = translateSql('SELECT NVL(a, 0) FROM t', O, DM)
    expect(r.needsAi).toBe(false)
    expect(r.sql).toContain('NVL(') // DM supports NVL natively
  })

  it('hard constructs force AI', () => {
    expect(translateSql('SELECT DECODE(x,1,a,b) FROM t', O, V).needsAi).toBe(true)
    expect(
      translateSql('SELECT * FROM t START WITH id=1 CONNECT BY PRIOR id=pid', O, V).needsAi,
    ).toBe(true)
    expect(translateSql('SELECT * FROM a, b WHERE a.id = b.id (+)', O, V).needsAi).toBe(true)
    expect(translateSql('SELECT * FROM t WHERE ROWNUM <= 10', O, V).needsAi).toBe(true)
    expect(translateSql("SELECT LISTAGG(name, ',') FROM t", O, V).needsAi).toBe(true)
  })

  it('non-Oracle source defers to AI', () => {
    expect(translateSql('SELECT * FROM t', MY, V).needsAi).toBe(true)
  })

  it('MySQL target maps NVL → IFNULL', () => {
    const r = translateSql('SELECT NVL(a, 0) FROM t', O, MY)
    expect(r.needsAi).toBe(false)
    expect(r.sql).toContain('IFNULL(')
  })
})
