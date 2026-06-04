/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { type MaskRule, applyMask, maskRows, ruleFor } from './masking'

const rules: MaskRule[] = [
  { name: 'phone', columnPattern: 'phone|mobile', kind: 'phone', enabled: true },
  { name: 'email', columnPattern: 'email', kind: 'email', enabled: true },
  { name: 'off', columnPattern: 'never', kind: 'default', enabled: false }, // disabled → ignored
]

describe('applyMask', () => {
  it('masks phone keeping head/tail', () => {
    expect(applyMask('13812345678', 'phone')).toBe('138****5678')
  })
  it('masks email local part', () => {
    expect(applyMask('alice@example.com', 'email')).toBe('a***@example.com')
  })
  it('passes through null/empty', () => {
    expect(applyMask(null, 'phone')).toBe(null)
    expect(applyMask('', 'email')).toBe('')
  })
})

describe('ruleFor', () => {
  it('matches by column-name regex, skips disabled', () => {
    expect(ruleFor('user_phone', rules)?.kind).toBe('phone')
    expect(ruleFor('contact_email', rules)?.kind).toBe('email')
    expect(ruleFor('never_col', rules)).toBe(null) // disabled rule
    expect(ruleFor('age', rules)).toBe(null)
  })
})

describe('maskRows', () => {
  const cols = ['id', 'phone', 'email']
  const rows = [
    { id: 1, phone: '13812345678', email: 'a@b.com' },
    { id: 2, phone: '13900000000', email: 'c@d.com' },
  ]
  it('masks only matched columns, leaves the rest intact', () => {
    const out = maskRows(cols, rows, rules)
    expect(out[0]).toEqual({ id: 1, phone: '138****5678', email: 'a***@b.com' })
    expect(out[1].phone).toBe('139****0000')
  })
  it('does not mutate the input rows', () => {
    const snapshot = JSON.parse(JSON.stringify(rows))
    maskRows(cols, rows, rules)
    expect(rows).toEqual(snapshot)
  })
  it('returns the same array when no column matches (zero-copy)', () => {
    const out = maskRows(['id', 'age'], rows, rules)
    expect(out).toBe(rows)
  })
})
