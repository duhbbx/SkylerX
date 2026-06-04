/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { type ResultSet, diffResults, isIdentical } from './diff'

const rs = (columns: string[], rows: Array<Record<string, unknown>>): ResultSet => ({
  columns,
  rows,
})

describe('diffResults', () => {
  it('keyed: detects added / removed / changed / same', () => {
    const a = rs(
      ['id', 'name', 'age'],
      [
        { id: 1, name: 'a', age: 10 },
        { id: 2, name: 'b', age: 20 },
        { id: 3, name: 'c', age: 30 },
      ],
    )
    const b = rs(
      ['id', 'name', 'age'],
      [
        { id: 1, name: 'a', age: 10 }, // same
        { id: 2, name: 'b', age: 21 }, // changed (age)
        { id: 4, name: 'd', age: 40 }, // added
      ],
    )
    const d = diffResults(a, b, ['id'])
    expect(d.same).toBe(1)
    expect(d.removed.map((r) => r.a?.id)).toEqual([3])
    expect(d.added.map((r) => r.b?.id)).toEqual([4])
    expect(d.changed.length).toBe(1)
    expect(d.changed[0].changedCols).toEqual(['age'])
    expect(isIdentical(d)).toBe(false)
  })
  it('identical sets', () => {
    const a = rs(['id'], [{ id: 1 }, { id: 2 }])
    expect(isIdentical(diffResults(a, a, ['id']))).toBe(true)
  })
  it('null vs empty string are distinct', () => {
    const a = rs(['id', 'v'], [{ id: 1, v: null }])
    const b = rs(['id', 'v'], [{ id: 1, v: '' }])
    expect(diffResults(a, b, ['id']).changed.length).toBe(1)
  })
  it('no key → all shared columns are the key (multiset diff, no "changed")', () => {
    const a = rs(['x'], [{ x: 1 }, { x: 2 }])
    const b = rs(['x'], [{ x: 2 }, { x: 3 }])
    const d = diffResults(a, b, [])
    expect(d.removed.map((r) => r.a?.x)).toEqual([1])
    expect(d.added.map((r) => r.b?.x)).toEqual([3])
    expect(d.changed.length).toBe(0)
    expect(d.same).toBe(1)
  })
  it('reports columns only on one side', () => {
    const d = diffResults(rs(['id', 'a'], []), rs(['id', 'b'], []), ['id'])
    expect(d.colsOnlyInA).toEqual(['a'])
    expect(d.colsOnlyInB).toEqual(['b'])
    expect(d.compareCols).toEqual(['id'])
  })
})
