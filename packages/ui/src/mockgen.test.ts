/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { buildMockInserts, mockValue } from './mockgen'

describe('mockValue', () => {
  it('uses sequential ids for integer primary keys', () => {
    expect(mockValue('int', 0, true)).toBe('1')
    expect(mockValue('bigint', 4, true)).toBe('5')
  })
  it('maps types to plausible literals', () => {
    expect(mockValue('decimal(10,2)', 0)).toMatch(/^\d+\.\d{2}$/)
    expect(mockValue('boolean', 0)).toMatch(/^(TRUE|FALSE)$/)
    expect(mockValue('date', 0)).toMatch(/^'\d{4}-\d{2}-\d{2}'$/)
    expect(mockValue('datetime', 0)).toMatch(/^'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'$/)
    expect(mockValue('varchar(50)', 0)).toMatch(/^'[a-z]+_\d+'$/)
    expect(mockValue('uuid', 0)).toMatch(/^'.+'$/)
  })
})

describe('buildMockInserts', () => {
  const cols = [
    { name: 'id', type: 'int', pk: true },
    { name: 'name', type: 'varchar(50)' },
  ]
  it('emits a multi-row INSERT with quoted columns and N rows', () => {
    const sql = buildMockInserts(DbDialect.MySQL, '`t`', cols, 3)
    expect(sql).toContain('INSERT INTO `t` (`id`, `name`) VALUES')
    expect((sql.match(/\(\d+, '[^']+'\)/g) ?? []).length).toBe(3)
    expect(sql).toContain('(1, ')
    expect(sql).toContain('(3, ')
  })
  it('chunks large counts into multiple statements', () => {
    const sql = buildMockInserts(DbDialect.PostgreSQL, '"t"', cols, 250, 100)
    expect((sql.match(/INSERT INTO/g) ?? []).length).toBe(3)
  })
  it('returns empty for no columns or zero count', () => {
    expect(buildMockInserts(DbDialect.MySQL, '`t`', [], 5)).toBe('')
    expect(buildMockInserts(DbDialect.MySQL, '`t`', cols, 0)).toBe('')
  })
})
