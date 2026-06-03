/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { type SizeSnapshot, project } from './project'
import { canMeasureSize, dbSizeQuery, parseSize } from './sizeQuery'
import { addSnapshot, clearSnapshots, loadSnapshots } from './store'

const DAY = 86_400_000
const T = 1_700_000_000_000

describe('project', () => {
  it('needs >= 2 points', () => {
    expect(project([])).toBeNull()
    expect(project([{ at: T, bytes: 100 }])).toBeNull()
  })
  it('linear growth → slope, 7/30/90-day projection', () => {
    const snaps: SizeSnapshot[] = [
      { at: T, bytes: 100 },
      { at: T + 10 * DAY, bytes: 200 },
    ]
    const p = project(snaps)!
    expect(p.perDayBytes).toBeCloseTo(10) // (200-100)/10
    expect(p.current).toBeCloseTo(200)
    expect(p.in7d).toBeCloseTo(270)
    expect(p.in30d).toBeCloseTo(500)
    expect(p.in90d).toBeCloseTo(1100)
  })
  it('ETA to threshold', () => {
    const p = project(
      [
        { at: T, bytes: 100 },
        { at: T + 10 * DAY, bytes: 200 },
      ],
      { thresholdBytes: 300 },
    )!
    expect(p.etaDays).toBeCloseTo(10) // (300-200)/10
  })
  it('flat data → no ETA, projection stays', () => {
    const p = project(
      [
        { at: T, bytes: 500 },
        { at: T + 5 * DAY, bytes: 500 },
      ],
      { thresholdBytes: 1000 },
    )!
    expect(p.perDayBytes).toBeCloseTo(0)
    expect(p.etaDays).toBeUndefined()
  })
})

describe('store', () => {
  function mem() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
  }
  it('add / load / clear, sorted', () => {
    const s = mem()
    addSnapshot('c1', { at: T + DAY, bytes: 200 }, s)
    addSnapshot('c1', { at: T, bytes: 100 }, s)
    expect(loadSnapshots('c1', s).map((x) => x.bytes)).toEqual([100, 200]) // sorted by time
    clearSnapshots('c1', s)
    expect(loadSnapshots('c1', s)).toEqual([])
  })
  it('isolates per connection + ignores corrupt', () => {
    const s = mem()
    addSnapshot('a', { at: T, bytes: 1 }, s)
    s.setItem('skylerx.storage-trend.bad', '{nope')
    expect(loadSnapshots('a', s).length).toBe(1)
    expect(loadSnapshots('bad', s)).toEqual([])
  })
})

describe('sizeQuery', () => {
  it('per-family SQL', () => {
    expect(dbSizeQuery(DbDialect.Vastbase)).toContain('pg_database_size')
    expect(dbSizeQuery(DbDialect.MySQL)).toContain('information_schema.TABLES')
    expect(dbSizeQuery(DbDialect.Oracle)).toContain('user_segments')
    expect(dbSizeQuery(DbDialect.SqlServer)).toContain('sys.database_files')
  })
  it('parseSize handles bytes/BYTES/first column', () => {
    expect(parseSize({ bytes: '1024' })).toBe(1024)
    expect(parseSize({ BYTES: 2048 })).toBe(2048)
    expect(parseSize(undefined)).toBe(0)
  })
  it('canMeasureSize', () => {
    expect(canMeasureSize(DbDialect.Vastbase)).toBe(true)
    expect(canMeasureSize(DbDialect.MongoDB)).toBe(false)
  })
})
