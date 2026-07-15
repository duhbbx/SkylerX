/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { isReactive, reactive } from 'vue'
import {
  navConnectionScope,
  queryTabConnectionScope,
  snapshotConnectionScope,
} from './connectionScope'

describe('connection scope helpers', () => {
  it('keeps navigation scope stable within a renderer window', () => {
    expect(navConnectionScope()).toEqual(navConnectionScope())
    expect(navConnectionScope()).toMatchObject({ kind: 'navigation' })
    expect(navConnectionScope().id).toMatch(/^nav:/)
  })

  it('creates distinct query-tab scopes under the same renderer window', () => {
    const first = queryTabConnectionScope(1)
    const second = queryTabConnectionScope(2)

    expect(first).toMatchObject({ kind: 'query-tab' })
    expect(second).toMatchObject({ kind: 'query-tab' })
    expect(first.id).toMatch(/^tab:/)
    expect(second.id).toMatch(/^tab:/)
    expect(first.id).not.toBe(second.id)
  })

  it('snapshots a reactive query scope before it crosses the context bridge', () => {
    const reactiveScope = reactive(queryTabConnectionScope(3))

    expect(isReactive(reactiveScope)).toBe(true)
    expect(() => structuredClone(reactiveScope)).toThrow()

    const snapshot = snapshotConnectionScope(reactiveScope)

    expect(isReactive(snapshot)).toBe(false)
    expect(structuredClone(snapshot)).toEqual(reactiveScope)
  })
})
