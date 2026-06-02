/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { buildExcel, buildHtmlDoc } from './export'
import { type SourceProfile, bucketize } from './profile'
import { buildReport } from './report'
import type { AssessSummary } from './types'

function fakeProfile(): SourceProfile {
  return {
    dialect: DbDialect.Oracle,
    databases: [{ name: 'ORCL', system: false, sizeBytes: 1024 }],
    schemas: [{ name: 'HR', system: false }],
    schemaProfiles: [
      {
        schema: 'HR',
        inventory: { tables: 2, views: 1, primaryKeys: 1 }, // synonyms/packages omitted → unsupported
        metrics: {
          totalRows: 1500,
          tablesWithoutPk: 1,
          lobColumns: 3,
          tablesWithTriggers: null,
          tablesWithComment: 2,
        },
        tableCount: 2,
        rowBuckets: bucketize([2e6, 50]),
        sizeBytes: 4096,
        largestTables: [{ schema: 'HR', name: 'BIG', rows: 2e6, bytes: 4000 }],
        warnings: [],
      },
    ],
    totals: {
      schemas: 1,
      tables: 2,
      objects: 4,
      sizeBytes: 4096,
      rowBuckets: bucketize([2e6, 50]),
      inventory: { tables: 2, views: 1, primaryKeys: 1 },
      metrics: {
        totalRows: 1500,
        tablesWithoutPk: 1,
        lobColumns: 3,
        tablesWithTriggers: null,
        tablesWithComment: 2,
      },
    },
  }
}

function fakeSummary(): AssessSummary {
  return {
    source: DbDialect.Oracle,
    target: DbDialect.Vastbase,
    items: [
      {
        kind: 'table',
        schema: 'HR',
        name: 'BIG',
        grade: 'B',
        converted: 'CREATE TABLE …',
        notes: [],
        blockers: [],
        needsAi: false,
      },
    ],
    byGrade: { A: 0, B: 1, C: 0, D: 0 },
    readiness: 80,
    aiCandidates: 0,
  }
}

describe('buildReport with profile', () => {
  it('embeds the source-profile section with inventory + risk metrics', () => {
    const md = buildReport(fakeSummary(), { profile: fakeProfile() })
    expect(md).toContain('## 源库画像')
    expect(md).toContain('对象盘点')
    expect(md).toContain('无主键表')
    // unsupported categories render as — ; supported ones as numbers
    expect(md).toMatch(/同义词/)
    expect(md).toContain('大表 Top')
  })
})

describe('buildHtmlDoc', () => {
  it('wraps rendered markdown in a full HTML doc', () => {
    const html = buildHtmlDoc('# 标题\n\n正文', { title: 'T' })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<h1')
    expect(html).not.toContain('window.print')
  })
  it('autoPrint injects a print script', () => {
    expect(buildHtmlDoc('# x', { title: 'T', autoPrint: true })).toContain('window.print')
  })
})

describe('buildExcel', () => {
  it('produces a non-empty .xlsx binary', async () => {
    const bytes = await buildExcel(fakeProfile(), fakeSummary(), [])
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(100)
    // xlsx files are zip archives → start with 'PK'
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })
})
