/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { translateDdl, translateOracleType } from './oracleToDm'

describe('translateOracleType', () => {
  it('VARCHAR2 → VARCHAR 保留长度', () => {
    expect(translateOracleType('VARCHAR2(255)')).toBe('VARCHAR(255)')
  })
  it('NUMBER 带精度', () => {
    expect(translateOracleType('NUMBER(10,2)')).toBe('NUMERIC(10,2)')
  })
  it('裸 NUMBER 无长度', () => {
    expect(translateOracleType('NUMBER')).toBe('NUMERIC')
  })
  it('未识别类型原样', () => {
    expect(translateOracleType('MY_CUSTOM_T')).toBe('MY_CUSTOM_T')
  })
  it('大小写不敏感', () => {
    expect(translateOracleType('varchar2(64)')).toBe('VARCHAR(64)')
  })
})

describe('translateDdl', () => {
  it('CREATE TABLE 列类型批量替换', () => {
    const oracle = `CREATE TABLE T_USER (
      ID NUMBER(19) PRIMARY KEY,
      NAME VARCHAR2(64) NOT NULL,
      BIO CLOB,
      AVATAR RAW(2000),
      CREATED DATE
    )`
    const { sql, warnings } = translateDdl(oracle)
    expect(sql).toContain('NUMERIC(19)')
    expect(sql).toContain('VARCHAR(64)')
    expect(sql).toContain('VARBINARY(2000)')
    expect(sql).toContain('CLOB')
    // DATE 类型告警必带
    expect(warnings.some((w) => w.includes('DATE'))).toBe(true)
  })

  it('SYSDATE → CURRENT_TIMESTAMP', () => {
    const { sql, warnings } = translateDdl('SELECT SYSDATE FROM DUAL')
    expect(sql).toContain('CURRENT_TIMESTAMP')
    expect(sql).toContain('DUAL')
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('NVL → COALESCE', () => {
    const { sql } = translateDdl('SELECT NVL(name, "anonymous") FROM users')
    expect(sql).toContain('COALESCE(')
    expect(sql).not.toContain('NVL(')
  })

  it('DECODE 不替换但发 warning', () => {
    const { sql, warnings } = translateDdl(
      'SELECT DECODE(status, 1, "on", 0, "off") FROM t',
    )
    expect(sql).toContain('DECODE(')
    expect(warnings.some((w) => w.includes('DECODE'))).toBe(true)
  })

  it('CONNECT BY 保留并 warning', () => {
    const { sql, warnings } = translateDdl(
      'SELECT id FROM t START WITH p IS NULL CONNECT BY PRIOR id = p',
    )
    expect(sql).toContain('CONNECT BY')
    expect(warnings.some((w) => w.includes('CONNECT BY'))).toBe(true)
  })

  it('LONG RAW 应优先匹配,不被 LONG 抢', () => {
    const { sql } = translateDdl('DATA LONG RAW')
    expect(sql).toContain('VARBINARY')
    expect(sql).not.toContain('CLOB RAW')
  })

  it('空输入安全', () => {
    expect(translateDdl('').sql).toBe('')
    expect(translateDdl('').warnings).toEqual([])
  })
})
