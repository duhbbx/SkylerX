/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { buildPlanData, flattenPlan, parseMysqlPlan, parseOraclePlan, parsePgPlan, planQuery } from './plan'

describe('planQuery', () => {
  it('wraps PG queries in EXPLAIN (FORMAT JSON)', () => {
    expect(planQuery(DbDialect.PostgreSQL, 'SELECT 1')).toEqual({
      sql: 'EXPLAIN (FORMAT JSON) SELECT 1',
      format: 'pg-json',
    })
  })
  it('uses EXPLAIN FORMAT=JSON for MySQL (heatmap tree), ANALYZE → tree text', () => {
    expect(planQuery(DbDialect.MySQL, 'SELECT 1;')).toEqual({
      sql: 'EXPLAIN FORMAT=JSON SELECT 1',
      format: 'mysql-json',
    })
    expect(planQuery(DbDialect.MySQL, 'SELECT 1', { analyze: true })).toEqual({
      sql: 'EXPLAIN ANALYZE SELECT 1',
      format: 'mysql-tree',
    })
  })
  it('Oracle/DM use a two-step EXPLAIN PLAN + PLAN_TABLE read', () => {
    const p = planQuery(DbDialect.Oracle, 'SELECT 1;')
    expect(p?.format).toBe('oracle-rows')
    expect(p?.prep).toBe('EXPLAIN PLAN FOR SELECT 1')
    expect(p?.sql).toContain('FROM plan_table')
    expect(planQuery(DbDialect.DM, 'SELECT 1')?.format).toBe('oracle-rows')
  })
  it('strips trailing semicolon before wrapping', () => {
    expect(planQuery(DbDialect.PostgreSQL, 'SELECT 1;  ')?.sql).toBe(
      'EXPLAIN (FORMAT JSON) SELECT 1',
    )
  })
  it('returns null for empty sql or unsupported dialects', () => {
    expect(planQuery(DbDialect.PostgreSQL, '   ')).toBeNull()
    expect(planQuery(DbDialect.SqlServer, 'SELECT 1')).toBeNull()
  })
})

describe('parseMysqlPlan', () => {
  const json = JSON.stringify({
    query_block: {
      select_id: 1,
      cost_info: { query_cost: '12.50' },
      nested_loop: [
        {
          table: {
            table_name: 'orders',
            access_type: 'ALL',
            rows_produced_per_join: 100,
            cost_info: { prefix_cost: '4.00' },
          },
        },
        {
          table: {
            table_name: 'users',
            access_type: 'eq_ref',
            key: 'PRIMARY',
            rows_produced_per_join: 1,
            cost_info: { prefix_cost: '12.50' },
          },
        },
      ],
    },
  })
  it('builds a nested-loop tree with table costs/relations', () => {
    const root = parseMysqlPlan(json)!
    expect(root.label).toBe('Nested loop')
    expect(root.cost).toBe(12.5) // 提升到 query_cost
    expect(root.children).toHaveLength(2)
    expect(root.children[0].relation).toBe('orders')
    expect(root.children[1].indexName).toBe('PRIMARY')
    expect(root.children[1].cost).toBe(12.5)
  })
  it('handles a single-table query_block', () => {
    const single = JSON.stringify({
      query_block: { cost_info: { query_cost: '1.20' }, table: { table_name: 't', access_type: 'const' } },
    })
    expect(parseMysqlPlan(single)?.relation).toBe('t')
  })
  it('returns null on malformed / non-plan json', () => {
    expect(parseMysqlPlan('nope')).toBeNull()
    expect(parseMysqlPlan('{}')).toBeNull()
  })
})

describe('parseOraclePlan', () => {
  // PLAN_TABLE 行（大写列名，模拟 Oracle 驱动返回）
  const rows = [
    { ID: 0, PARENT_ID: null, OPERATION: 'SELECT STATEMENT', OPTIONS: null, OBJECT_NAME: null, COST: 5, CARDINALITY: 100 },
    { ID: 1, PARENT_ID: 0, OPERATION: 'HASH JOIN', OPTIONS: null, OBJECT_NAME: null, COST: 5, CARDINALITY: 100 },
    { ID: 2, PARENT_ID: 1, OPERATION: 'TABLE ACCESS', OPTIONS: 'FULL', OBJECT_NAME: 'ORDERS', COST: 2, CARDINALITY: 50 },
    { ID: 3, PARENT_ID: 1, OPERATION: 'INDEX', OPTIONS: 'UNIQUE SCAN', OBJECT_NAME: 'USERS_PK', COST: 1, CARDINALITY: 1 },
  ]
  it('links id/parent_id into a tree (case-insensitive cols)', () => {
    const root = parseOraclePlan(rows)!
    expect(root.label).toBe('SELECT STATEMENT')
    expect(root.children[0].label).toBe('HASH JOIN')
    const hj = root.children[0]
    expect(hj.children.map((c) => c.label)).toEqual(['TABLE ACCESS FULL', 'INDEX UNIQUE SCAN'])
    expect(hj.children[0].detail).toContain('on ORDERS')
    expect(root.cost).toBe(5)
  })
  it('returns null on empty', () => {
    expect(parseOraclePlan([])).toBeNull()
  })
})

describe('buildPlanData', () => {
  it('routes oracle-rows through parseOraclePlan', () => {
    const r = { rows: [{ ID: 0, PARENT_ID: null, OPERATION: 'SELECT STATEMENT', COST: 1, CARDINALITY: 1 }] }
    expect(buildPlanData('oracle-rows', r).tree?.label).toBe('SELECT STATEMENT')
  })
  it('falls back to text for mysql-tree (first cell joined)', () => {
    const r = { rows: [{ EXPLAIN: '-> Nested loop' }, { EXPLAIN: '  -> Table scan' }] }
    const d = buildPlanData('mysql-tree', r)
    expect(d.tree).toBeNull()
    expect(d.text).toContain('Nested loop')
  })
})

describe('parsePgPlan', () => {
  const json = JSON.stringify([
    {
      Plan: {
        'Node Type': 'Nested Loop',
        'Join Type': 'Inner',
        'Total Cost': 100.5,
        'Plan Rows': 42,
        Plans: [
          { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', 'Total Cost': 30, 'Plan Rows': 10 },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'users',
            'Index Name': 'users_pkey',
            'Total Cost': 5,
            'Plan Rows': 1,
          },
        ],
      },
    },
  ])

  it('parses the root node + costs', () => {
    const root = parsePgPlan(json)
    expect(root?.label).toBe('Nested Loop')
    expect(root?.detail).toContain('Inner join')
    expect(root?.cost).toBe(100.5)
    expect(root?.rows).toBe(42)
    expect(root?.children).toHaveLength(2)
  })

  it('captures relation + index detail on children', () => {
    const root = parsePgPlan(json)!
    expect(root.children[0].detail).toContain('on orders')
    expect(root.children[1].detail).toContain('using users_pkey')
  })

  it('returns null on malformed json', () => {
    expect(parsePgPlan('not json')).toBeNull()
    expect(parsePgPlan('[]')).toBeNull()
  })
})

describe('flattenPlan', () => {
  it('depth-first flattens with correct depths', () => {
    const root = parsePgPlan(
      JSON.stringify([
        {
          Plan: {
            'Node Type': 'A',
            'Total Cost': 1,
            'Plan Rows': 1,
            Plans: [{ 'Node Type': 'B', 'Total Cost': 1, 'Plan Rows': 1 }],
          },
        },
      ]),
    )!
    const rows = flattenPlan(root)
    expect(rows.map((r) => [r.node.label, r.depth])).toEqual([
      ['A', 0],
      ['B', 1],
    ])
  })
})
