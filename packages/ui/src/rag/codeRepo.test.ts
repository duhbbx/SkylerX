/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataClient } from '@db-tool/shared-types'
import { buildCodeSearchExpansionOptions, resolveChatMaxTokens } from '../ai'
import {
  assertIndexSaved,
  codeIndexKey,
  containerKey,
  getRepoPath,
  planRefresh,
  refreshCodeIndex,
  retrieveCodeDetailed,
  resolveBoundContainer,
  setRepoPath,
  walkRepo,
} from './codeRepo'
import { encodeVec, saveIndex } from './store'

afterEach(() => vi.unstubAllGlobals())

describe('code search expansion chat options', () => {
  it('keeps the ordinary chat budget while bounding expansion requests', () => {
    expect(resolveChatMaxTokens()).toBe(2000)
    expect(buildCodeSearchExpansionOptions('如何查询订单用户')).toMatchObject({
      messages: [{ role: 'user', content: '如何查询订单用户' }],
      maxTokens: 96,
    })
  })
})

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
    await expect(retrieveCodeDetailed('missing-conn', 'app␟public', '/repo', 'find users', 3)).resolves.toEqual({
      context: '',
      mode: 'none',
      hitCount: 0,
      sources: [],
    })
  })

  it('returns no context before searching when the stored root differs from the binding', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo-a',
      chunks: [
        {
          id: 'code:secret.ts␟0',
          kind: 'code',
          title: 'secret.ts',
          text: 'repository A private implementation',
        },
      ],
    })
    const expand = vi.fn(async () => 'private implementation')

    await expect(
      retrieveCodeDetailed('c1', 'app␟public', '/repo-b', 'private', 3, undefined, expand),
    ).resolves.toEqual({ context: '', mode: 'none', hitCount: 0, sources: [] })
    expect(expand).not.toHaveBeenCalled()
  })
})

describe('lexical code-query expansion', () => {
  it('uses an injected English expansion to find code for a Chinese question', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:order-user-repository.ts␟0',
          kind: 'code',
          title: 'src/order-user-repository.ts',
          text: 'export class OrderUserRepository { findOrderUser() {} }',
        },
      ],
    })
    const expand = vi.fn(async () => 'order user repository mapper')

    const result = await retrieveCodeDetailed('c1', 'app␟public', '/repo', '如何查询订单用户', 3, undefined, expand)

    expect(expand).toHaveBeenCalledWith('如何查询订单用户', undefined)
    expect(result).toMatchObject({ mode: 'lexical', hitCount: 1, sources: ['src/order-user-repository.ts'] })
  })

  it('preserves original identifier terms when the expansion is incomplete', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:billing-gateway.ts␟0',
          kind: 'code',
          title: 'src/billing-gateway.ts',
          text: 'export class BillingGateway { charge() {} }',
        },
      ],
    })

    const result = await retrieveCodeDetailed(
      'c1',
      'app␟public',
      '/repo',
      'billing endpoint',
      3,
      undefined,
      async () => 'invoice mapper',
    )

    expect(result).toMatchObject({ hitCount: 1, sources: ['src/billing-gateway.ts'] })
  })

  it('falls back to the original lexical query when expansion fails', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:order-user-repository.ts␟0',
          kind: 'code',
          title: 'src/order-user-repository.ts',
          text: 'export class OrderUserRepository { findOrderUser() {} }',
        },
      ],
    })
    const expand = vi.fn(async () => {
      throw new Error('provider unavailable')
    })

    const result = await retrieveCodeDetailed('c1', 'app␟public', '/repo', 'order user', 3, undefined, expand)

    expect(expand).toHaveBeenCalledWith('order user', undefined)
    expect(result).toMatchObject({ mode: 'lexical', hitCount: 1, sources: ['src/order-user-repository.ts'] })
  })

  it('propagates an AbortError from the expander', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:order-user-repository.ts␟0',
          kind: 'code',
          title: 'src/order-user-repository.ts',
          text: 'export class OrderUserRepository { findOrderUser() {} }',
        },
      ],
    })
    const abortError = new DOMException('Expansion canceled', 'AbortError')

    await expect(
      retrieveCodeDetailed('c1', 'app␟public', '/repo', 'order user', 3, undefined, async () => {
        throw abortError
      }),
    ).rejects.toBe(abortError)
  })

  it('stops before expansion when the caller signal is already aborted', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'lexical',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:order-user-repository.ts␟0',
          kind: 'code',
          title: 'src/order-user-repository.ts',
          text: 'export class OrderUserRepository { findOrderUser() {} }',
        },
      ],
    })
    const controller = new AbortController()
    const abortError = new DOMException('Search canceled', 'AbortError')
    controller.abort(abortError)
    const expand = vi.fn(async () => 'order user repository')

    await expect(
      retrieveCodeDetailed('c1', 'app␟public', '/repo', 'order user', 3, controller.signal, expand),
    ).rejects.toBe(abortError)
    expect(expand).not.toHaveBeenCalled()
  })

  it('does not expand queries from a stored vector index', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    saveIndex({
      key: codeIndexKey('c1', 'app␟public'),
      builtAt: 1,
      mode: 'vector',
      codeSourceRoot: '/repo',
      chunks: [
        {
          id: 'code:order-user-repository.ts␟0',
          kind: 'code',
          title: 'src/order-user-repository.ts',
          text: 'export class OrderUserRepository { findOrderUser() {} }',
        },
      ],
      vectors: [encodeVec([1, 0])],
    })
    const expand = vi.fn(async () => 'unrelated terms')

    const result = await retrieveCodeDetailed('c1', 'app␟public', '/repo', 'order user', 3, undefined, expand)

    expect(expand).not.toHaveBeenCalled()
    expect(result).toMatchObject({ hitCount: 1, sources: ['src/order-user-repository.ts'] })
  })
})

describe('assertIndexSaved', () => {
  it('throws a storage-full error when the index cannot be persisted', () => {
    expect(() => assertIndexSaved(false)).toThrow('CODE_INDEX_STORAGE_FULL')
  })
})

describe('refreshCodeIndex persistence failure', () => {
  it('rejects before writing the manifest when index storage is full', async () => {
    const writes: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: (key: string) => {
        writes.push(key)
        if (key.startsWith('skylerx.rag.code:')) throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    })
    const client = {
      files: {
        listDir: async () => [],
        pathJoin: async (...parts: string[]) => parts.join('/'),
      },
    } as unknown as DataClient

    await expect(refreshCodeIndex(client, 'c1', 'app␟public', '/repo', { nowMs: 1 })).rejects.toThrow(
      'CODE_INDEX_STORAGE_FULL',
    )
    expect(writes).not.toContain('skylerx.rag.codemanifest:c1␟app␟public')
  })
})

describe('refreshCodeIndex root identity', () => {
  it('fully rebuilds when the root changes despite identical relative metadata', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    })
    const client = {
      files: {
        listDir: async () => [{ name: 'same.ts', isDirectory: false, size: 12, mtime: 7 }],
        pathJoin: async (...parts: string[]) => parts.join('/'),
        readText: async (path: string) => path.endsWith('.gitignore') ? '' : `content from ${path.split('/')[1]}`,
      },
    } as unknown as DataClient

    const first = await refreshCodeIndex(client, 'c1', 'app␟public', '/repo-a', { nowMs: 1 })
    const second = await refreshCodeIndex(client, 'c1', 'app␟public', '/repo-b/', { nowMs: 2 })

    expect(first.index.chunks[0]?.text).toContain('repo-a')
    expect(second.index.codeSourceRoot).toBe('/repo-b')
    expect(second.index.chunks[0]?.text).toContain('repo-b')
    expect(second.index.chunks[0]?.text).not.toContain('repo-a')
  })
})

describe('walkRepo root traversal errors', () => {
  it('throws a specific error when the repository root cannot be listed', async () => {
    const client = {
      files: {
        listDir: async () => { throw new Error('EACCES') },
        pathJoin: async (...parts: string[]) => parts.join('/'),
      },
    } as unknown as DataClient

    await expect(walkRepo(client, '/private/repo')).rejects.toThrow('CODE_REPO_ROOT_UNREADABLE')
  })

  it('skips nested directories that cannot be listed', async () => {
    const client = {
      files: {
        listDir: async (path: string) => {
          if (path === '/repo') return [{ name: 'blocked', isDirectory: true, size: 0, mtime: 0 }]
          throw new Error('EACCES')
        },
        pathJoin: async (...parts: string[]) => parts.join('/'),
      },
    } as unknown as DataClient

    await expect(walkRepo(client, '/repo')).resolves.toEqual({ files: [], capped: false })
  })

  it('accepts a readable empty repository', async () => {
    const client = {
      files: {
        listDir: async () => [],
        pathJoin: async (...parts: string[]) => parts.join('/'),
      },
    } as unknown as DataClient

    await expect(walkRepo(client, '/repo')).resolves.toEqual({ files: [], capped: false })
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
