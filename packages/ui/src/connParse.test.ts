/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { extractJson, sanitizeParsedConnection } from './connParse'

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

describe('sanitizeParsedConnection', () => {
  it('keeps known string fields and trims them', () => {
    const out = sanitizeParsedConnection({ host: '  db1  ', user: 'root', database: 'app' })
    expect(out).toEqual({ host: 'db1', user: 'root', database: 'app' })
  })

  it('keeps a known dialect, drops an unknown one', () => {
    expect(sanitizeParsedConnection({ dialect: 'mysql' }).dialect).toBe('mysql')
    expect(sanitizeParsedConnection({ dialect: 'totally-made-up' }).dialect).toBeUndefined()
  })

  it('coerces a numeric-string port to a number and drops a bad port', () => {
    expect(sanitizeParsedConnection({ port: '5432' }).port).toBe(5432)
    expect(sanitizeParsedConnection({ port: 3306 }).port).toBe(3306)
    expect(sanitizeParsedConnection({ port: 'not-a-port' }).port).toBeUndefined()
  })

  it('strips empty strings instead of writing blanks', () => {
    const out = sanitizeParsedConnection({ host: '', user: '   ', database: 'app' })
    expect(out).toEqual({ database: 'app' })
  })

  it('drops unknown top-level keys', () => {
    const out = sanitizeParsedConnection({ host: 'db1', sqlInjection: 'DROP' })
    expect(out).toEqual({ host: 'db1' })
  })

  it('confines dialect-specific scalars to extra and drops non-scalars', () => {
    const out = sanitizeParsedConnection({
      dialect: 'mongodb',
      extra: { uri: 'mongodb://h:1', showSystemDatabases: true, junk: { nested: 1 } },
    })
    expect(out.extra).toEqual({ uri: 'mongodb://h:1', showSystemDatabases: true })
  })

  it('extracts ssl and marks it enabled when certs are present', () => {
    const out = sanitizeParsedConnection({ ssl: { ca: '---CA---' } })
    expect(out.ssl).toEqual({ enabled: true, ca: '---CA---' })
  })

  it('extracts an ssh tunnel and marks it enabled when a host is present', () => {
    const out = sanitizeParsedConnection({ ssh: { host: 'jump.example.com', port: '22', user: 'ec2' } })
    expect(out.ssh).toEqual({ enabled: true, host: 'jump.example.com', port: 22, user: 'ec2' })
  })

  it('returns an empty object for non-object input', () => {
    expect(sanitizeParsedConnection(null)).toEqual({})
    expect(sanitizeParsedConnection('nope')).toEqual({})
  })
})
