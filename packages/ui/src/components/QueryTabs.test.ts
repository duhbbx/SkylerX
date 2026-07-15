/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./QueryTabs.vue', import.meta.url)), 'utf8')

describe('QueryTabs header', () => {
  it('uses 20 pixel dialect icons', () => {
    expect(source).toContain(':size="20" class="t-dialect"')
  })

  it('keeps fixed actions and an all-tabs management menu', () => {
    expect(source).toContain('class="qtab-actions"')
    expect(source).toContain('class="qtab-menu"')
    expect(source).toContain('@click="activateFromMenu(t.id)"')
    expect(source).toContain('@click.stop="togglePin(t.id)"')
    expect(source).toContain('@click.stop="close(t.id)"')
  })

  it('hides the horizontal tab scrollbar', () => {
    expect(source).toMatch(/\.qtab-bar\s*{[^}]*scrollbar-width:\s*none;/s)
    expect(source).toMatch(/\.qtab-bar::-webkit-scrollbar\s*{[^}]*display:\s*none;/s)
  })
})
