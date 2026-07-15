/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest'
import { readConnectionSecretFile } from './connectionSecretFile'

describe('readConnectionSecretFile', () => {
  it('returns null when the user cancels file selection', async () => {
    const selectFile = vi.fn(async () => null)
    const readText = vi.fn(async () => 'unused')

    await expect(readConnectionSecretFile({ selectFile, readText }, 'sshPrivateKey')).resolves.toBeNull()
    expect(readText).not.toHaveBeenCalled()
  })

  it('reads selected SSH private key content as text', async () => {
    const selectFile = vi.fn(async () => '/keys/jump.pem')
    const readText = vi.fn(async () => '-----BEGIN OPENSSH PRIVATE KEY-----\n...')

    await expect(readConnectionSecretFile({ selectFile, readText }, 'sshPrivateKey')).resolves.toBe(
      '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
    )
    expect(selectFile).toHaveBeenCalledWith({
      filters: [
        { name: 'All files', extensions: ['*'] },
        { name: 'SSH private key', extensions: ['pem', 'key', 'p8', 'ppk', 'txt'] },
      ],
      showHidden: true,
    })
    expect(readText).toHaveBeenCalledWith('/keys/jump.pem')
  })

  it('strips trailing line breaks when reading a database password file', async () => {
    const selectFile = vi.fn(async () => '/secrets/db-password.txt')
    const readText = vi.fn(async () => 's3cr3t\r\n')

    await expect(readConnectionSecretFile({ selectFile, readText }, 'dbPassword')).resolves.toBe(
      's3cr3t',
    )
  })
})
