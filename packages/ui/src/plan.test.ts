import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { flattenPlan, parsePgPlan, planQuery } from './plan'

describe('planQuery', () => {
  it('wraps PG queries in EXPLAIN (FORMAT JSON)', () => {
    expect(planQuery(DbDialect.PostgreSQL, 'SELECT 1')).toEqual({
      sql: 'EXPLAIN (FORMAT JSON) SELECT 1',
      format: 'pg-json',
    })
  })
  it('wraps MySQL queries in EXPLAIN FORMAT=TREE', () => {
    expect(planQuery(DbDialect.MySQL, 'SELECT 1;')).toEqual({
      sql: 'EXPLAIN FORMAT=TREE SELECT 1',
      format: 'mysql-tree',
    })
  })
  it('strips trailing semicolon before wrapping', () => {
    expect(planQuery(DbDialect.PostgreSQL, 'SELECT 1;  ')?.sql).toBe(
      'EXPLAIN (FORMAT JSON) SELECT 1',
    )
  })
  it('returns null for empty sql or unsupported dialects', () => {
    expect(planQuery(DbDialect.PostgreSQL, '   ')).toBeNull()
    expect(planQuery(DbDialect.SqlServer, 'SELECT 1')).toBeNull()
    expect(planQuery(DbDialect.Oracle, 'SELECT 1')).toBeNull()
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
