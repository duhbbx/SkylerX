/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { locale, setLocale, t } from './i18n'

describe('i18n', () => {
  beforeEach(() => setLocale('zh'))

  it('translates by key for the current locale', () => {
    expect(t('nav.title')).toBe('导航')
    setLocale('en')
    expect(t('nav.title')).toBe('Navigator')
  })

  it('interpolates {name} params', () => {
    setLocale('en')
    expect(t('bulk.selected', { n: 3 })).toBe('3 selected')
    setLocale('zh')
    expect(t('bulk.selected', { n: 3 })).toBe('已选 3 项')
  })

  it('falls back to zh, then to the raw key, for missing entries', () => {
    setLocale('en')
    expect(t('totally.unknown.key')).toBe('totally.unknown.key')
  })

  it('setLocale updates the reactive ref', () => {
    setLocale('en')
    expect(locale.value).toBe('en')
  })

  it('translates SSL and SSH scoped test actions', () => {
    expect(t('conn.ssl.test')).toBe('测试 SSL')
    expect(t('conn.ssh.test')).toBe('测试 SSH')
    setLocale('en')
    expect(t('conn.ssl.test')).toBe('Test SSL')
    expect(t('conn.ssh.test')).toBe('Test SSH')
  })
})
