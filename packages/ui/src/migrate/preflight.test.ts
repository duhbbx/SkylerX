/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { checkTable, summarize } from './preflight'

const src = { schema: 'HR', name: 'EMP', columns: ['ID', 'NAME'], pk: ['ID'] }

describe('checkTable', () => {
  it('error when target table missing', () => {
    const r = checkTable(src, { exists: false, columns: [] })
    expect(r).toEqual([
      { table: 'HR.EMP', level: 'error', msg: expect.stringContaining('目标表不存在') },
    ])
  })
  it('error when columns missing (case-insensitive match)', () => {
    const r = checkTable(src, { exists: true, columns: ['id'] }) // NAME missing
    expect(r.some((i) => i.level === 'error' && /NAME/.test(i.msg))).toBe(true)
  })
  it('clean when all columns present (different case)', () => {
    expect(checkTable(src, { exists: true, columns: ['id', 'name'] })).toEqual([])
  })
  it('warns on no PK and on non-empty target', () => {
    const r = checkTable({ ...src, pk: [] }, { exists: true, columns: ['id', 'name'], rowCount: 5 })
    expect(r.filter((i) => i.level === 'warn').length).toBe(2)
  })
})

describe('summarize', () => {
  it('ok only when no errors', () => {
    expect(summarize([{ table: 't', level: 'warn', msg: 'x' }])).toEqual({
      errors: 0,
      warns: 1,
      ok: true,
    })
    expect(summarize([{ table: 't', level: 'error', msg: 'x' }]).ok).toBe(false)
  })
})
