/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { codeIndexKey, containerKey, getRepoPath, setRepoPath } from './codeRepo'

describe('containerKey', () => {
  it('joins database + schema with a unit separator', () => {
    expect(containerKey({ database: 'shop' })).toBe('shop␟')
    expect(containerKey({ database: 'app', schema: 'public' })).toBe('app␟public')
    expect(containerKey({ schema: 'HR' })).toBe('␟HR')
    expect(containerKey({})).toBe('␟')
  })
})

describe('codeIndexKey', () => {
  it('namespaces by connId + container', () => {
    expect(codeIndexKey('c1', 'app␟public')).toBe('code:c1␟app␟public')
  })
})

describe('getRepoPath / setRepoPath on connection.extra', () => {
  it('round-trips a bound path under codeRepos[container]', () => {
    const conn: { extra?: Record<string, unknown> } = {}
    const next = setRepoPath(conn, 'app␟public', '/home/me/app')
    expect(getRepoPath(next, 'app␟public')).toBe('/home/me/app')
    expect(getRepoPath(next, 'other␟')).toBeUndefined()
  })

  it('removing a path drops the entry', () => {
    let conn: { extra?: Record<string, unknown> } = setRepoPath({}, 'k', '/p')
    conn = setRepoPath(conn, 'k', '')
    expect(getRepoPath(conn, 'k')).toBeUndefined()
  })
})
