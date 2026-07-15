/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig } from '@db-tool/core-driver'
import { describe, expect, it } from 'vitest'
import { testSshConnection } from './ssh-tunnel'

class FakeSshClient {
  ended = false
  connectedWith: unknown = null
  private handlers = new Map<string, (arg?: Error) => void>()

  on(event: string, handler: (arg?: Error) => void): this {
    this.handlers.set(event, handler)
    return this
  }

  connect(options: unknown): void {
    this.connectedWith = options
    queueMicrotask(() => this.handlers.get('ready')?.())
  }

  end(): void {
    this.ended = true
  }
}

describe('testSshConnection', () => {
  it('authenticates to the SSH host only and closes the client', async () => {
    const fake = new FakeSshClient()
    const cfg = {
      host: 'mysql.internal',
      port: 3306,
      ssh: {
        enabled: true,
        host: 'jump.example.com',
        port: 22,
        user: 'root',
        privateKey: 'KEY',
      },
    } as ConnectionConfig

    await testSshConnection(cfg, () => fake)

    expect(fake.connectedWith).toMatchObject({
      host: 'jump.example.com',
      port: 22,
      username: 'root',
      privateKey: 'KEY',
      readyTimeout: 15000,
    })
    expect(fake.connectedWith).not.toMatchObject({ host: 'mysql.internal', port: 3306 })
    expect(fake.ended).toBe(true)
  })
})
