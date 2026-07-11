/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest'
import { normalizeCodeRepoRoot, runCodeRepoBuild } from './codeRepoBuild'

describe('normalizeCodeRepoRoot', () => {
  it('keeps POSIX roots distinct when they end in backslash or space', () => {
    const roots = ['/tmp/repo', '/tmp/repo\\', '/tmp/repo ']

    expect(roots.map(normalizeCodeRepoRoot)).toEqual(roots)
    expect(new Set(roots.map(normalizeCodeRepoRoot))).toHaveLength(3)
  })

  it('removes only redundant POSIX trailing slashes', () => {
    expect(normalizeCodeRepoRoot('/tmp/repo/')).toBe('/tmp/repo')
    expect(normalizeCodeRepoRoot('/tmp/repo///')).toBe('/tmp/repo')
    expect(normalizeCodeRepoRoot('///')).toBe('/')
    expect(normalizeCodeRepoRoot('/')).toBe('/')
  })

  it('normalizes Windows drive and UNC separator equivalents', () => {
    expect(normalizeCodeRepoRoot('C:\\repo\\')).toBe('C:/repo')
    expect(normalizeCodeRepoRoot('C:/repo/')).toBe('C:/repo')
    expect(normalizeCodeRepoRoot('C:\\')).toBe('C:/')
    expect(normalizeCodeRepoRoot('C:/')).toBe('C:/')
    expect(normalizeCodeRepoRoot('\\\\server\\share\\repo\\')).toBe('//server/share/repo')
    expect(normalizeCodeRepoRoot('//server/share/repo/')).toBe('//server/share/repo')
  })

  it('uses trimming only to reject all-whitespace input', () => {
    expect(normalizeCodeRepoRoot('   ')).toBe('')
    expect(normalizeCodeRepoRoot(' /tmp/repo ')).toBe(' /tmp/repo ')
  })
})

describe('runCodeRepoBuild', () => {
  it('rejects an empty trimmed root without invoking either operation', async () => {
    const persist = vi.fn(async () => ({ id: 'conn-1' }))
    const refresh = vi.fn(async () => ({ fileCount: 2 }))

    await expect(runCodeRepoBuild('  ', { persist, refresh })).rejects.toThrow('CODE_REPO_PATH_REQUIRED')

    expect(persist).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('passes the exact normalized root to refresh and persist', async () => {
    let path = '  /repo  '
    const persist = vi.fn(async (root: string) => ({ id: 'conn-1', root }))
    const refresh = vi.fn(async (root: string) => {
      path = '/other-repo'
      return { root, fileCount: 2 }
    })

    const result = await runCodeRepoBuild(path, { persist, refresh })

    expect(persist).toHaveBeenCalledWith('  /repo  ')
    expect(refresh).toHaveBeenCalledWith('  /repo  ')
    expect(result).toEqual({
      root: '  /repo  ',
      saved: { id: 'conn-1', root: '  /repo  ' },
      refresh: { root: '  /repo  ', fileCount: 2 },
    })
  })

  it('does not persist the binding when refresh fails', async () => {
    const persist = vi.fn(async () => ({ id: 'conn-1' }))
    const refresh = vi.fn(async () => {
      throw new Error('index failed')
    })
    const build = runCodeRepoBuild('/repo', { persist, refresh })

    await expect(build).rejects.toThrow('index failed')
    const result = await build.catch(() => undefined)

    expect(persist).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('refreshes before persisting and returns both successful results', async () => {
    const calls: string[] = []
    const persist = vi.fn(async (root: string) => {
      calls.push(`persist:${root}`)
      return { id: 'conn-1' }
    })
    const refresh = vi.fn(async (root: string) => {
      calls.push(`refresh:${root}`)
      return { fileCount: 2 }
    })

    const result = await runCodeRepoBuild('/repo', { persist, refresh })

    expect(calls).toEqual(['refresh:/repo', 'persist:/repo'])
    expect(result).toEqual({
      root: '/repo',
      saved: { id: 'conn-1' },
      refresh: { fileCount: 2 },
    })
  })
})
