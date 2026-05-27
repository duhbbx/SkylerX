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
})
