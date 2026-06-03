/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import {
  type RowReader,
  type RowWriter,
  buildColumnStats,
  buildInsert,
  buildInsertParams,
  buildPagedSelect,
  chunkRows,
  compareColumnStats,
  copyTable,
  maxRowsPerInsert,
  parseColumnStats,
  placeholder,
  reconcile,
  runPool,
  supportsConflictSkip,
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

describe('column-level reconcile', () => {
  it('buildColumnStats: per-column nonNull/min/max as text (PG)', () => {
    expect(buildColumnStats(V, 'hr', 'emp', ['id', 'name'])).toBe(
      'SELECT COUNT("id") AS "id__nn", (MIN("id"))::text AS "id__mn", (MAX("id"))::text AS "id__mx", ' +
        'COUNT("name") AS "name__nn", (MIN("name"))::text AS "name__mn", (MAX("name"))::text AS "name__mx" ' +
        'FROM "hr"."emp"',
    )
  })
  it('castText differs by family', () => {
    expect(buildColumnStats(O, 'HR', 'EMP', ['ID'])).toContain('TO_CHAR(MIN("ID"))')
    expect(buildColumnStats(MY, 'hr', 'emp', ['id'])).toContain('CAST(MIN(`id`) AS CHAR)')
  })
  it('parseColumnStats + compareColumnStats', () => {
    const src = parseColumnStats(
      { id__nn: 100, id__mn: '1', id__mx: '100', name__nn: 98, name__mn: 'a', name__mx: 'z' },
      ['id', 'name'],
    )
    const same = compareColumnStats(src, [...src])
    expect(same.ok).toBe(true)
    const tgt = parseColumnStats(
      { id__nn: 100, id__mn: '1', id__mx: '99', name__nn: 97, name__mn: 'a', name__mx: 'z' },
      ['id', 'name'],
    )
    const diff = compareColumnStats(src, tgt)
    expect(diff.ok).toBe(false)
    expect(diff.diffs.find((d) => d.column === 'id')?.detail).toMatch(/max 100→99/)
    expect(diff.diffs.find((d) => d.column === 'name')?.detail).toMatch(/非空数 98→97/)
  })
})

describe('parameterized insert', () => {
  it('placeholder per family', () => {
    expect(placeholder('pg', 0)).toBe('$1')
    expect(placeholder('oracle', 2)).toBe(':3')
    expect(placeholder('mysql', 5)).toBe('?')
  })
  it('buildInsertParams uses binds, not literals', () => {
    const { sql, params } = buildInsertParams(
      V,
      'hr',
      'emp',
      ['id', 'name'],
      [
        { id: 1, name: "O'Brien" },
        { id: 2, name: null },
      ],
    )
    expect(sql).toBe('INSERT INTO "hr"."emp" ("id", "name") VALUES ($1, $2), ($3, $4)')
    expect(params).toEqual([1, "O'Brien", 2, null]) // raw values, driver escapes
  })
  it('maxRowsPerInsert respects PG 65535 param cap', () => {
    expect(maxRowsPerInsert(V, 10)).toBe(6500) // 65000/10
    expect(maxRowsPerInsert(MY, 10)).toBe(100) // 1000/10
    expect(maxRowsPerInsert(V, 100)).toBe(650)
  })
  it('chunkRows splits to bound statement size', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkRows([], 2)).toEqual([])
  })
})

describe('incremental + parallel', () => {
  it('onConflict → PG ON CONFLICT DO NOTHING', () => {
    const { sql } = buildInsertParams(V, 'hr', 'emp', ['id', 'name'], [{ id: 1, name: 'a' }], {
      onConflict: ['id'],
    })
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING')
  })
  it('onConflict → MySQL INSERT IGNORE', () => {
    const { sql } = buildInsertParams(MY, 'app', 't', ['id'], [{ id: 1 }], { onConflict: ['id'] })
    expect(sql.startsWith('INSERT IGNORE INTO')).toBe(true)
  })
  it('onConflict ignored for Oracle (no equivalent)', () => {
    const { sql } = buildInsertParams(O, 'HR', 'T', ['ID'], [{ ID: 1 }], { onConflict: ['ID'] })
    expect(sql).not.toMatch(/CONFLICT|IGNORE/)
  })
  it('supportsConflictSkip', () => {
    expect(supportsConflictSkip(V)).toBe(true)
    expect(supportsConflictSkip(MY)).toBe(true)
    expect(supportsConflictSkip(O)).toBe(false)
  })
  it('runPool runs all items with bounded concurrency', async () => {
    const done: number[] = []
    let active = 0
    let maxActive = 0
    await runPool([1, 2, 3, 4, 5], 2, async (x) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      done.push(x)
    })
    expect(done.sort()).toEqual([1, 2, 3, 4, 5])
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
