/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import {
  assertIndexSaved,
  codeIndexKey,
  containerKey,
  getRepoPath,
  planRefresh,
  retrieveCodeDetailed,
  resolveBoundContainer,
  setRepoPath,
} from './codeRepo'

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

describe('code index retrieval diagnostics', () => {
  it('reports no retrieval when the code index is missing', async () => {
    await expect(retrieveCodeDetailed('missing-conn', 'app␟public', 'find users', 3)).resolves.toEqual({
      context: '',
      mode: 'none',
      hitCount: 0,
      sources: [],
    })
  })
})

describe('assertIndexSaved', () => {
  it('throws a storage-full error when the index cannot be persisted', () => {
    expect(() => assertIndexSaved(false)).toThrow('CODE_INDEX_STORAGE_FULL')
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

describe('planRefresh — incremental diff by mtime/size', () => {
  const manifest = {
    'a.ts': { mtime: 100, size: 10, chunkIds: ['code:a.ts␟0'] },
    'b.sql': { mtime: 200, size: 20, chunkIds: ['code:b.sql␟0'] },
  }
  it('re-embeds changed + new files, keeps unchanged, drops deleted', () => {
    const scanned = [
      { relPath: 'a.ts', mtime: 100, size: 10 },
      { relPath: 'b.sql', mtime: 999, size: 21 },
      { relPath: 'c.go', mtime: 5, size: 5 },
    ]
    const plan = planRefresh(manifest, scanned)
    expect(plan.unchanged).toEqual(['a.ts'])
    expect(plan.toReindex.sort()).toEqual(['b.sql', 'c.go'])
    expect(plan.deleted).toEqual([])
  })

  it('flags files that disappeared from the scan as deleted', () => {
    const plan = planRefresh(manifest, [{ relPath: 'a.ts', mtime: 100, size: 10 }])
    expect(plan.deleted).toEqual(['b.sql'])
    expect(plan.unchanged).toEqual(['a.ts'])
    expect(plan.toReindex).toEqual([])
  })
})

describe('resolveBoundContainer', () => {
  const conn = (keys: string[]) => ({
    extra: { codeRepos: Object.fromEntries(keys.map((k) => [k, { path: '/p/' + k }])) },
  })
  it('returns null when nothing bound', () => {
    expect(resolveBoundContainer(undefined, { database: 'shop' })).toBeNull()
    expect(resolveBoundContainer({}, { database: 'shop' })).toBeNull()
  })
  it('prefers an exact container match', () => {
    expect(resolveBoundContainer(conn(['shop␟', 'app␟public']), { database: 'shop' })).toBe('shop␟')
    expect(
      resolveBoundContainer(conn(['shop␟', 'app␟public']), { database: 'app', schema: 'public' }),
    ).toBe('app␟public')
  })
  it('uses the only bound repo regardless of context', () => {
    expect(resolveBoundContainer(conn(['app␟public']), { database: 'whatever' })).toBe('app␟public')
  })
  it('falls back to same-database: schema match, then schema-less, then first', () => {
    // multiple repos, no exact match; ctx db = warehouse
    const c = conn(['shop␟public', 'warehouse␟', 'warehouse␟sales'])
    // schema-less db-node bind matches a db-only ctx
    expect(resolveBoundContainer(c, { database: 'warehouse' })).toBe('warehouse␟')
    // schema match preferred when ctx has the schema
    expect(resolveBoundContainer(c, { database: 'warehouse', schema: 'sales' })).toBe('warehouse␟sales')
  })
  it('returns null when no bound repo shares the database', () => {
    expect(resolveBoundContainer(conn(['a␟x', 'b␟y']), { database: 'c', schema: 'z' })).toBeNull()
  })
})
