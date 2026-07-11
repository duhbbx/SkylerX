/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest'
import { runCodeRepoBuild } from './codeRepoBuild'

describe('runCodeRepoBuild', () => {
  it('rejects an empty trimmed root without invoking either operation', async () => {
    const persist = vi.fn(async () => ({ id: 'conn-1' }))
    const refresh = vi.fn(async () => ({ fileCount: 2 }))

    await expect(runCodeRepoBuild('  ', { persist, refresh })).rejects.toThrow('CODE_REPO_PATH_REQUIRED')

    expect(persist).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('uses the trimmed root snapshot when the external path changes during persistence', async () => {
    let path = '  /repo  '
    const persist = vi.fn(async (root: string) => {
      path = '/other-repo'
      return { id: 'conn-1', root }
    })
    const refresh = vi.fn(async (root: string) => ({ root, fileCount: 2 }))

    const result = await runCodeRepoBuild(path, { persist, refresh })

    expect(persist).toHaveBeenCalledWith('/repo')
    expect(refresh).toHaveBeenCalledWith('/repo')
    expect(result).toEqual({
      root: '/repo',
      saved: { id: 'conn-1', root: '/repo' },
      refresh: { root: '/repo', fileCount: 2 },
    })
  })

  it('rejects without a success result when refresh fails', async () => {
    const persist = vi.fn(async () => ({ id: 'conn-1' }))
    const refresh = vi.fn(async () => {
      throw new Error('index failed')
    })
    const build = runCodeRepoBuild('/repo', { persist, refresh })

    await expect(build).rejects.toThrow('index failed')
    const result = await build.catch(() => undefined)

    expect(persist).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('persists before refreshing and returns both successful results', async () => {
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

    expect(calls).toEqual(['persist:/repo', 'refresh:/repo'])
    expect(result).toEqual({
      root: '/repo',
      saved: { id: 'conn-1' },
      refresh: { fileCount: 2 },
    })
  })
})
