/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import {
  type ProfileExec,
  bucketize,
  inventoryTotal,
  lit,
  profileSource,
  profilerFor,
} from './profile'

describe('bucketize', () => {
  it('counts cumulative thresholds (≥1M / ≥10M / ≥100M)', () => {
    const b = bucketize([5e5, 2e6, 5e7, 3e8, 0])
    expect(b).toEqual({ total: 5, over1M: 3, over10M: 2, over100M: 1 })
  })
})

describe('lit / inventoryTotal', () => {
  it('escapes quotes', () => {
    expect(lit("O'BRIEN")).toBe("'O''BRIEN'")
  })
  it('sums inventory ignoring null/missing', () => {
    expect(inventoryTotal({ tables: 3, views: 2, indexes: 5 })).toBe(10)
  })
})

type Entry = [RegExp, Array<Record<string, unknown>> | Error]
function mockExec(map: Entry[]): ProfileExec {
  return async (sql: string) => {
    for (const [re, val] of map) {
      if (re.test(sql)) {
        if (val instanceof Error) throw val
        return val
      }
    }
    return []
  }
}

describe('postgresProfiler.profileSchema (mock exec)', () => {
  it('builds full inventory, metrics and buckets', async () => {
    const p = profilerFor(DbDialect.Vastbase)!
    const exec = mockExec([
      [
        /GROUP BY c\.relkind/,
        [
          { kind: 'r', cnt: 4 },
          { kind: 'p', cnt: 1 }, // partitioned table (also counts in tables)
          { kind: 'v', cnt: 2 },
          { kind: 'm', cnt: 1 },
          { kind: 'S', cnt: 3 },
          { kind: 'i', cnt: 7 },
        ],
      ],
      [
        /GROUP BY c\.contype/,
        [
          { t: 'p', cnt: 3 },
          { t: 'f', cnt: 2 },
          { t: 'u', cnt: 1 },
          { t: 'c', cnt: 4 },
        ],
      ],
      [
        /GROUP BY p\.prokind/,
        [
          { k: 'f', cnt: 6 },
          { k: 'p', cnt: 2 },
        ],
      ],
      [/pg_trigger/, [{ cnt: 5, tbls: 3 }]],
      [/pg_type t/, [{ cnt: 2 }]],
      [/gs_package/, new Error('relation gs_package does not exist')], // → packages null
      [/pg_synonym/, new Error('relation pg_synonym does not exist')], // → synonyms null
      [
        /pg_total_relation_size/,
        [
          { name: 'big', rows: 2e8, bytes: 9000 },
          { name: 'mid', rows: 5e6, bytes: 500 },
          { name: 'small', rows: 100, bytes: 50 },
          { name: 'big2', rows: 3e6, bytes: 200 },
          { name: 'p1', rows: 0, bytes: 0 },
        ],
      ],
      [/atttypid IN/, [{ cnt: 8 }]], // lob columns
      [/obj_description/, [{ cnt: 4 }]], // tables with comment
    ])
    const prof = await p.profileSchema(exec, undefined, 'public')
    expect(prof.inventory).toMatchObject({
      tables: 5,
      partitionedTables: 1,
      views: 2,
      materializedViews: 1,
      indexes: 7,
      sequences: 3,
      primaryKeys: 3,
      foreignKeys: 2,
      uniqueConstraints: 1,
      checkConstraints: 4,
      functions: 6,
      procedures: 2,
      triggers: 5,
      types: 2,
    })
    expect(prof.inventory.packages).toBeUndefined() // unsupported → null/omitted
    expect(prof.inventory.synonyms).toBeUndefined()
    expect(prof.tableCount).toBe(5)
    expect(prof.metrics.totalRows).toBe(2e8 + 5e6 + 100 + 3e6)
    expect(prof.metrics.tablesWithoutPk).toBe(2) // 5 tables - 3 PKs
    expect(prof.metrics.lobColumns).toBe(8)
    expect(prof.metrics.tablesWithTriggers).toBe(3)
    expect(prof.metrics.tablesWithComment).toBe(4)
    expect(prof.rowBuckets).toEqual({ total: 5, over1M: 3, over10M: 1, over100M: 1 })
  })

  it('relkind query failure → warning, degraded inventory', async () => {
    const p = profilerFor(DbDialect.PostgreSQL)!
    const exec = mockExec([[/GROUP BY c\.relkind/, new Error('boom')]])
    const prof = await p.profileSchema(exec, undefined, 'public')
    expect(prof.warnings.some((w) => /对象盘点失败/.test(w))).toBe(true)
  })
})

describe('oracleProfiler.listSchemas (mock exec)', () => {
  it('filters system schemas via oracle_maintained', async () => {
    const p = profilerFor(DbDialect.Oracle)!
    const exec = mockExec([
      [
        /all_users/,
        [
          { NAME: 'HR', OM: 'N' },
          { NAME: 'SYS', OM: 'Y' },
          { NAME: 'APP', OM: 'N' },
        ],
      ],
    ])
    const schemas = await p.listSchemas(exec, undefined, false)
    expect(schemas.map((s) => s.name)).toEqual(['HR', 'APP'])
  })
})

describe('profileSource orchestration', () => {
  it('aggregates inventory + metrics across schemas', async () => {
    const exec = mockExec([
      [/pg_database/, [{ name: 'postgres', is_template: false, size_bytes: 1000 }]],
      [/FROM pg_namespace n WHERE/, [{ name: 'public', oid: 16500 }]],
      [/GROUP BY c\.relkind/, [{ kind: 'r', cnt: 2 }]],
      [/GROUP BY c\.contype/, [{ t: 'p', cnt: 1 }]],
      [
        /pg_total_relation_size/,
        [
          { name: 'a', rows: 2e6, bytes: 100 },
          { name: 'b', rows: 50, bytes: 20 },
        ],
      ],
    ])
    const res = await profileSource(exec, DbDialect.Vastbase, { schemas: ['public'] })
    expect(res.totals.schemas).toBe(1)
    expect(res.totals.tables).toBe(2)
    expect(res.totals.inventory.tables).toBe(2)
    expect(res.totals.inventory.primaryKeys).toBe(1)
    expect(res.totals.metrics.tablesWithoutPk).toBe(1)
    expect(res.totals.rowBuckets.over1M).toBe(1)
  })

  it('unsupported dialect → empty profile', async () => {
    const res = await profileSource(mockExec([]), DbDialect.MongoDB, { schemas: [] })
    expect(res.schemaProfiles).toEqual([])
    expect(res.totals.objects).toBe(0)
  })
})
