/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import {
  type RowReader,
  type RowWriter,
  buildInsert,
  buildPagedSelect,
  copyTable,
  reconcile,
  valueLiteral,
} from './dataMigrate'

const V = DbDialect.Vastbase
const MY = DbDialect.MySQL
const O = DbDialect.Oracle

/** in-memory source of N rows. */
function source(n: number): RowReader {
  const all = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `n${i + 1}` }))
  return async (offset, limit) => all.slice(offset, offset + limit)
}
function sink(): { writer: RowWriter; rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = []
  return { writer: async (batch) => void rows.push(...batch), rows }
}

describe('copyTable', () => {
  it('copies all rows in batches and reports progress', async () => {
    const { writer, rows } = sink()
    const progress: number[] = []
    const r = await copyTable(source(2500), writer, {
      batchSize: 1000,
      onProgress: (p) => progress.push(p.copied),
    })
    expect(r).toEqual({ copied: 2500, batches: 3, aborted: false }) // 1000+1000+500
    expect(rows.length).toBe(2500)
    expect(progress).toEqual([1000, 2000, 2500])
  })
  it('stops on abort and reports partial', async () => {
    const ac = new AbortController()
    const { writer } = sink()
    let seen = 0
    const r = await copyTable(
      async (o, l) => {
        if (seen >= 1000) ac.abort()
        seen += l
        return source(5000)(o, l)
      },
      writer,
      { batchSize: 1000, signal: ac.signal },
    )
    expect(r.aborted).toBe(true)
    expect(r.copied).toBeLessThan(5000)
  })
  it('empty source → zero batches', async () => {
    const { writer } = sink()
    expect(await copyTable(source(0), writer, {})).toEqual({
      copied: 0,
      batches: 0,
      aborted: false,
    })
  })
})

describe('valueLiteral', () => {
  it('null / number / string / bigint', () => {
    expect(valueLiteral(null, V)).toBe('NULL')
    expect(valueLiteral(undefined, V)).toBe('NULL')
    expect(valueLiteral(42, V)).toBe('42')
    expect(valueLiteral(Number.NaN, V)).toBe('NULL')
    expect(valueLiteral("O'Brien", V)).toBe("'O''Brien'")
    expect(valueLiteral(10n, V)).toBe('10')
  })
  it('boolean differs by family', () => {
    expect(valueLiteral(true, V)).toBe('true')
    expect(valueLiteral(false, MY)).toBe('0')
    expect(valueLiteral(true, MY)).toBe('1')
  })
  it('binary literal per family', () => {
    const b = new Uint8Array([0xde, 0xad])
    expect(valueLiteral(b, V)).toBe("'\\xdead'")
    expect(valueLiteral(b, MY)).toBe('0xdead')
    expect(valueLiteral(b, O)).toBe("'dead'")
  })
  it('Date → ISO literal; object → json', () => {
    expect(valueLiteral(new Date('2026-06-03T00:00:00Z'), V)).toBe("'2026-06-03T00:00:00.000Z'")
    expect(valueLiteral({ a: 1 }, V)).toBe('\'{"a":1}\'')
  })
})

describe('SQL builders', () => {
  it('buildPagedSelect: PG LIMIT/OFFSET vs Oracle OFFSET/FETCH', () => {
    expect(buildPagedSelect(V, 'hr', 'emp', ['id'], 100, 50)).toBe(
      'SELECT * FROM "hr"."emp" ORDER BY "id" LIMIT 50 OFFSET 100',
    )
    expect(buildPagedSelect(O, 'HR', 'EMP', ['ID'], 100, 50)).toBe(
      'SELECT * FROM "HR"."EMP" ORDER BY "ID" OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY',
    )
  })
  it('buildInsert: multi-row literals with coercion', () => {
    const sql = buildInsert(
      V,
      'hr',
      'emp',
      ['id', 'name'],
      [
        { id: 1, name: 'a' },
        { id: 2, name: null },
      ],
    )
    expect(sql).toBe('INSERT INTO "hr"."emp" ("id", "name") VALUES (1, \'a\'), (2, NULL)')
  })
  it('reconcile', () => {
    expect(reconcile(100, 100)).toEqual({ source: 100, target: 100, ok: true, diff: 0 })
    expect(reconcile(100, 98)).toEqual({ source: 100, target: 98, ok: false, diff: -2 })
  })
})
