/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { lintSql } from './sqlLint'
import {
  type CustomLintRule,
  lintCustom,
  loadCustomRules,
  newRuleId,
  ruleError,
  saveCustomRules,
} from './sqlLintCustom'

const rule = (o: Partial<CustomLintRule>): CustomLintRule => ({
  id: 'r1',
  enabled: true,
  severity: 'warn',
  pattern: 'SELECT\\s+\\*',
  flags: 'i',
  message: '禁用 SELECT *',
  ...o,
})

describe('lintCustom', () => {
  it('fires a custom regex rule', () => {
    const f = lintCustom('select * from t', [rule({})])
    expect(f).toEqual([{ id: 'custom:r1', severity: 'warn', message: '禁用 SELECT *' }])
  })
  it('skips disabled rules and non-matches', () => {
    expect(lintCustom('select id from t', [rule({})])).toEqual([])
    expect(lintCustom('select * from t', [rule({ enabled: false })])).toEqual([])
  })
  it('invalid regex is skipped, not thrown', () => {
    expect(lintCustom('x', [rule({ pattern: '([' })])).toEqual([])
  })
  it('stripComments option ignores commented-out matches', () => {
    expect(lintCustom('-- select *\nselect id from t', [rule({ stripComments: true })])).toEqual([])
  })
})

describe('ruleError', () => {
  it('flags invalid regex and empty', () => {
    expect(ruleError({ pattern: '([', flags: '' })).toBeTruthy()
    expect(ruleError({ pattern: '', flags: '' })).toBe('正则为空')
    expect(ruleError({ pattern: 'a.b', flags: 'i' })).toBeNull()
  })
})

describe('store', () => {
  function mem() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }
  it('save / load round-trip; ignores corrupt', () => {
    const s = mem()
    saveCustomRules([rule({})], s)
    expect(loadCustomRules(s)[0].message).toBe('禁用 SELECT *')
    s.setItem('skylerx.lintRules', '{bad')
    expect(loadCustomRules(s)).toEqual([])
  })
  it('newRuleId varies by input', () => {
    expect(newRuleId(1, 0.1)).not.toBe(newRuleId(1, 0.9))
  })
})

describe('lintSql integration', () => {
  it('runs custom rules alongside built-in ones', () => {
    const f = lintSql('select * from t', { customRules: [rule({})] })
    expect(f.some((x) => x.id === 'custom:r1')).toBe(true)
  })
})
