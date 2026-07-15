/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { resolveDialogFileName } from './saveFile'

describe('resolveDialogFileName', () => {
  it('does not append a filter extension when picking an existing extensionless file', () => {
    expect(
      resolveDialogFileName('id_rsa', {
        mode: 'pick-existing',
        filter: { name: 'SSH private key', extensions: ['pem', 'key'] },
      }),
    ).toBe('id_rsa')
  })

  it('keeps appending a save extension when saving a new file', () => {
    expect(
      resolveDialogFileName('export', {
        mode: 'save',
        filter: { name: 'CSV', extensions: ['csv'] },
      }),
    ).toBe('export.csv')
  })
})
