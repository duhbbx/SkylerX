/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { DIALECT_IDS, dialectOptions } from './dialects'

describe('dialects', () => {
  it('exposes a non-empty option list with value + label', () => {
    expect(dialectOptions.length).toBeGreaterThanOrEqual(39)
    for (const o of dialectOptions) {
      expect(typeof o.value).toBe('string')
      expect(o.value.length).toBeGreaterThan(0)
      expect(typeof o.label).toBe('string')
    }
  })

  it('DIALECT_IDS contains every option value and known ids', () => {
    expect(DIALECT_IDS.size).toBe(dialectOptions.length)
    expect(DIALECT_IDS.has('mysql')).toBe(true)
    expect(DIALECT_IDS.has('postgresql')).toBe(true)
    expect(DIALECT_IDS.has('not-a-real-dialect')).toBe(false)
  })
})
