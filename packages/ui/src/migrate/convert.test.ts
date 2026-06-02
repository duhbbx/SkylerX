/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { convertTable, convertType, hasStructuralPath } from './convert'

const O = DbDialect.Oracle
const V = DbDialect.Vastbase
const DM = DbDialect.DM

describe('convertType — Oracle types through IR', () => {
  it('to PG-family (Vastbase)', () => {
    expect(convertType('VARCHAR2(255)', O, V).sql).toBe('varchar(255)')
    expect(convertType('NUMBER(10,2)', O, V).sql).toBe('numeric(10,2)')
    expect(convertType('NUMBER(8)', O, V).sql).toBe('integer') // p<=9, scale 0 → int
    expect(convertType('NUMBER', O, V).sql).toBe('numeric')
    expect(convertType('DATE', O, V).sql).toBe('timestamp')
    expect(convertType('CLOB', O, V).sql).toBe('text')
    expect(convertType('BLOB', O, V).sql).toBe('bytea')
    expect(convertType('RAW(16)', O, V).sql).toBe('bytea') // length dropped
    expect(convertType('BINARY_DOUBLE', O, V).sql).toBe('double precision')
  })
  it('to Oracle-family (DM) — same IR, different emitter', () => {
    expect(convertType('VARCHAR2(255)', O, DM).sql).toBe('VARCHAR2(255)')
    expect(convertType('NUMBER(10,2)', O, DM).sql).toBe('NUMBER(10,2)')
    expect(convertType('CLOB', O, DM).sql).toBe('TEXT')
    expect(convertType('BLOB', O, DM).sql).toBe('BLOB')
  })
  it('carries semantic notes from parse + emit', () => {
    const r = convertType('DATE', O, V)
    expect(r.notes.some((n) => n.level === 'info' && /DATE/.test(n.msg))).toBe(true)
  })
  it('hasStructuralPath reflects registry coverage', () => {
    expect(hasStructuralPath(O, V)).toBe(true)
    expect(hasStructuralPath(O, DM)).toBe(true)
    expect(hasStructuralPath(O, DbDialect.MySQL)).toBe(false) // no mysql emitter yet
  })
})

describe('convertTable — full CREATE TABLE emit', () => {
  it('emits PG CREATE TABLE with types, defaults, NOT NULL, PK', () => {
    const { sql, notes } = convertTable(
      'HR',
      'EMP',
      [
        { name: 'ID', dataType: 'NUMBER(10)', nullable: false },
        { name: 'NAME', dataType: 'VARCHAR2(50)', nullable: false },
        { name: 'HIRED', dataType: 'DATE', default: 'SYSDATE' },
        { name: 'BIO', dataType: 'CLOB' },
      ],
      DbDialect.Oracle,
      DbDialect.Vastbase,
      { primaryKey: ['ID'] },
    )
    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('"ID" bigint NOT NULL') // NUMBER(10) > int4 safe range → bigint; uppercase id quoted
    expect(sql).toContain('varchar(50)')
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP') // SYSDATE rewritten
    expect(sql).toContain('PRIMARY KEY ("ID")')
    expect(notes.some((n) => /DATE/.test(n.msg))).toBe(true)
  })
  it('round-trips to DM keeping Oracle-style types and SYSDATE default', () => {
    const { sql } = convertTable(
      'HR',
      'EMP',
      [{ name: 'HIRED', dataType: 'DATE', default: 'SYSDATE' }],
      DbDialect.Oracle,
      DbDialect.DM,
    )
    expect(sql).toContain('TIMESTAMP')
    expect(sql).toContain('DEFAULT SYSDATE') // DM is Oracle-compatible, keep as-is
  })
})
