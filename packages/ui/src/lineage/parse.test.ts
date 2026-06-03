/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { extractLineage, lineageGraph } from './parse'

describe('extractLineage', () => {
  it('SELECT with JOIN → sources, no target', () => {
    const r = extractLineage(
      'SELECT a.* FROM hr.emp a JOIN hr.dept d ON a.did = d.id WHERE a.x > 0',
    )
    expect(r.target).toBeUndefined()
    expect(r.sources.sort()).toEqual(['hr.dept', 'hr.emp'])
  })
  it('INSERT INTO ... SELECT → target + sources', () => {
    const r = extractLineage(
      'INSERT INTO rpt.daily SELECT * FROM sales JOIN cust ON sales.cid = cust.id',
    )
    expect(r.target).toBe('rpt.daily')
    expect(r.sources.sort()).toEqual(['cust', 'sales'])
  })
  it('CREATE VIEW ... AS', () => {
    expect(extractLineage('CREATE VIEW v AS SELECT 1 FROM t').target).toBe('v')
    expect(extractLineage('CREATE MATERIALIZED VIEW mv AS SELECT * FROM big').target).toBe('mv')
  })
  it('CTE names are excluded from real sources', () => {
    const r = extractLineage('WITH c AS (SELECT * FROM base) SELECT * FROM c JOIN other ON 1=1')
    expect(r.ctes).toEqual(['c'])
    expect(r.sources.sort()).toEqual(['base', 'other']) // c (the CTE) is not a source table
  })
  it('strips comments and string literals', () => {
    const r = extractLineage("SELECT 'FROM fake' AS x FROM real -- FROM commented")
    expect(r.sources).toEqual(['real'])
  })
  it('UPDATE target is not its own source', () => {
    const r = extractLineage('UPDATE t SET a = (SELECT v FROM src) WHERE 1=1')
    expect(r.target).toBe('t')
    expect(r.sources).toEqual(['src'])
  })
})

describe('lineageGraph', () => {
  it('chains across statements (target of one is source of next)', () => {
    const g = lineageGraph([
      'INSERT INTO stg.x SELECT * FROM raw.a',
      'INSERT INTO mart.y SELECT * FROM stg.x JOIN dim.d ON 1=1',
    ])
    expect(g.edges).toContainEqual({ from: 'raw.a', to: 'stg.x' })
    expect(g.edges).toContainEqual({ from: 'stg.x', to: 'mart.y' })
    expect(g.edges).toContainEqual({ from: 'dim.d', to: 'mart.y' })
  })
  it('bare SELECT routes to a result node', () => {
    const g = lineageGraph(['SELECT * FROM t'])
    expect(g.nodes.find((n) => n.kind === 'result')).toBeTruthy()
    expect(g.edges).toContainEqual({ from: 't', to: '(结果)' })
  })
})
