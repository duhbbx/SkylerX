/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./TreeItem.vue', import.meta.url)), 'utf8')

describe('TreeItem connection indicators', () => {
  it('does not render environment or connection-status dots', () => {
    expect(source).not.toContain('class="env-dot"')
    expect(source).not.toContain('class="status-dot"')
  })

  it('renders connection dialect icons at 20 pixels', () => {
    expect(source).toContain(':size="20"')
    expect(source).toMatch(/\.ico-svg\s*{[^}]*width:\s*20px;[^}]*height:\s*20px;/s)
  })
})
