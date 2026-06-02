/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { assessBatch, assessItem } from './assess'
import type { RawColumn } from './convert'
import type { AssessInput } from './types'

const O = DbDialect.Oracle
const V = DbDialect.Vastbase

const tbl = (name: string, cols: RawColumn[]): AssessInput => ({
  kind: 'table',
  schema: 'HR',
  name,
  columns: cols,
})
const proc = (name: string, ddl: string): AssessInput => ({
  kind: 'procedure',
  schema: 'HR',
  name,
  ddl,
})

describe('assessItem grade (Oracle → Vastbase via IR)', () => {
  it('A: clean table, all mechanically-mappable columns', () => {
    const r = assessItem(tbl('t', [{ name: 'name', dataType: 'VARCHAR2(50)' }]), O, V)
    expect(r.grade).toBe('A')
    expect(r.converted).toContain('varchar(50)')
    expect(r.needsAi).toBe(false)
  })
  it('B: table with a DATE column (info-level semantic note)', () => {
    const r = assessItem(tbl('t', [{ name: 'd', dataType: 'DATE' }]), O, V)
    expect(r.grade).toBe('B')
    expect(r.converted).toContain('timestamp')
    expect(r.notes.some((n) => n.level === 'info')).toBe(true)
  })
  it('C: table with a ROWID column (review-level note)', () => {
    const r = assessItem(tbl('t', [{ name: 'rid', dataType: 'ROWID' }]), O, V)
    expect(r.grade).toBe('C')
    expect(r.notes.some((n) => n.level === 'review')).toBe(true)
  })
  it('C: any PL/SQL object is manual + needsAi', () => {
    const r = assessItem(proc('p', 'CREATE PROCEDURE p AS BEGIN NULL; END;'), O, V)
    expect(r.grade).toBe('C')
    expect(r.needsAi).toBe(true)
  })
  it('D: blocked capability (Spatial) outranks everything', () => {
    const r = assessItem(proc('g', 'CREATE FUNCTION g RETURN SDO_GEOMETRY AS BEGIN END;'), O, V)
    // function kind is procedural; with blocker it goes D
    expect(r.grade).toBe('D')
    expect(r.blockers.length).toBeGreaterThan(0)
    expect(r.needsAi).toBe(false)
  })
})

describe('assessBatch summary', () => {
  it('aggregates grades, readiness, AI candidates', () => {
    const inputs: AssessInput[] = [
      tbl('clean', [{ name: 'n', dataType: 'VARCHAR2(50)' }]), // A
      tbl('dated', [{ name: 'd', dataType: 'DATE' }]), // B
      proc('p', 'CREATE PROCEDURE p AS BEGIN NULL; END;'), // C
      { kind: 'function', schema: 'HR', name: 'g', ddl: 'RETURN SDO_GEOMETRY' }, // D
    ]
    const s = assessBatch(inputs, O, V)
    expect(s.byGrade).toEqual({ A: 1, B: 1, C: 1, D: 1 })
    expect(s.aiCandidates).toBe(1)
    expect(s.readiness).toBe(Math.round((100 + 80 + 40 + 0) / 4)) // 55
  })
  it('empty input → 100 readiness', () => {
    expect(assessBatch([], O, V).readiness).toBe(100)
  })
})
