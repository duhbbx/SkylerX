/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { extractSql, fmtOracleType } from './ai'

describe('extractSql', () => {
  it('pulls the first ```sql fenced block', () => {
    const md = 'sure:\n```sql\nSELECT 1;\n```\nthen done'
    expect(extractSql(md)).toBe('SELECT 1;')
  })
  it('falls back to any fenced block when no sql tag', () => {
    expect(extractSql('```\nSELECT * FROM t;\n```')).toBe('SELECT * FROM t;')
  })
  it('returns the trimmed input when no fence', () => {
    expect(extractSql('  SELECT now();  ')).toBe('SELECT now();')
  })
})

describe('fmtOracleType', () => {
  it('char/raw types carry length', () => {
    expect(fmtOracleType('VARCHAR2', 50, null, null)).toBe('VARCHAR2(50)')
    expect(fmtOracleType('CHAR', 1, null, null)).toBe('CHAR(1)')
    expect(fmtOracleType('NVARCHAR2', 20, null, null)).toBe('NVARCHAR2(20)')
    expect(fmtOracleType('RAW', 16, null, null)).toBe('RAW(16)')
  })
  it('NUMBER carries precision and scale', () => {
    expect(fmtOracleType('NUMBER', null, 10, 2)).toBe('NUMBER(10,2)')
    expect(fmtOracleType('NUMBER', null, 10, 0)).toBe('NUMBER(10)')
    expect(fmtOracleType('NUMBER', null, 10, null)).toBe('NUMBER(10)')
  })
  it('NUMBER without precision stays bare', () => {
    expect(fmtOracleType('NUMBER', null, null, null)).toBe('NUMBER')
  })
  it('other types pass through unchanged', () => {
    expect(fmtOracleType('DATE', null, null, null)).toBe('DATE')
    expect(fmtOracleType('CLOB', 4000, null, null)).toBe('CLOB')
    expect(fmtOracleType('TIMESTAMP(6)', null, null, 6)).toBe('TIMESTAMP(6)')
  })
})
