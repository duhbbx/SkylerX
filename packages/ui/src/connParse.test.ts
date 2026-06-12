/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { extractJson } from './connParse'

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"host":"db1","port":3306}')).toEqual({ host: 'db1', port: 3306 })
  })

  it('parses a ```json fenced block', () => {
    const text = 'Here you go:\n```json\n{"host":"db1"}\n```\nHope that helps.'
    expect(extractJson(text)).toEqual({ host: 'db1' })
  })

  it('parses an object surrounded by prose', () => {
    const text = 'The connection is {"user":"root","database":"app"} as requested.'
    expect(extractJson(text)).toEqual({ user: 'root', database: 'app' })
  })

  it('ignores braces inside string values', () => {
    expect(extractJson('{"password":"a{b}c"}')).toEqual({ password: 'a{b}c' })
  })

  it('throws on input with no JSON object', () => {
    expect(() => extractJson('sorry, I could not find anything')).toThrow()
  })

  it('throws on empty input', () => {
    expect(() => extractJson('')).toThrow()
  })
})
