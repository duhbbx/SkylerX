/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./DialectSelect.vue', import.meta.url)), 'utf8')

describe('DialectSelect icons', () => {
  it('renders the current and option icons at 20 pixels', () => {
    expect(source.match(/:size="20"/g)).toHaveLength(2)
  })
})
