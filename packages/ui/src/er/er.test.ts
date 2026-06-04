/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import type { SchemaInput } from '../migrate/convert'
import { erModel, focusModel } from './model'

const schema: SchemaInput = {
  tables: [
    {
      schema: 's',
      name: 'customer',
      columns: [{ name: 'id', dataType: 'int' }],
      primaryKey: ['id'],
    },
    {
      schema: 's',
      name: 'orders',
      columns: [
        { name: 'id', dataType: 'int' },
        { name: 'customer_id', dataType: 'int' },
      ],
      primaryKey: ['id'],
    },
  ],
  foreignKeys: [
    { table: 'orders', columns: ['customer_id'], refTable: 'customer', refColumns: ['id'] },
    // 引用本 schema 之外的表 → 应计入 externalRefs,不连线
    { table: 'orders', columns: ['region_id'], refTable: 'region', refColumns: ['id'] },
  ],
}

describe('erModel', () => {
  it('builds table nodes with column count + PK + fkOut', () => {
    const m = erModel(schema)
    expect(m.nodes.map((n) => n.id).sort()).toEqual(['customer', 'orders'])
    const orders = m.nodes.find((n) => n.id === 'orders')!
    expect(orders.columns).toBe(2)
    expect(orders.pk).toEqual(['id'])
    expect(orders.fkOut).toBe(1) // 只数指向已知表的外键
  })
  it('keeps intra-schema FK edges and counts external refs separately', () => {
    const m = erModel(schema)
    expect(m.edges).toEqual([{ from: 'orders', to: 'customer', columns: ['customer_id'] }])
    expect(m.externalRefs).toBe(1) // orders → region(本 schema 外)
  })
  it('empty schema → empty model', () => {
    expect(erModel({ tables: [] })).toEqual({ nodes: [], edges: [], externalRefs: 0 })
  })
})

describe('focusModel', () => {
  const big: SchemaInput = {
    tables: [
      { schema: 's', name: 'orders', columns: [{ name: 'id', dataType: 'int' }] },
      { schema: 's', name: 'customer', columns: [{ name: 'id', dataType: 'int' }] },
      { schema: 's', name: 'product', columns: [{ name: 'id', dataType: 'int' }] },
      { schema: 's', name: 'unrelated', columns: [{ name: 'id', dataType: 'int' }] },
    ],
    foreignKeys: [
      { table: 'orders', columns: ['cid'], refTable: 'customer', refColumns: ['id'] },
      { table: 'orders', columns: ['pid'], refTable: 'product', refColumns: ['id'] },
    ],
  }
  it('empty query → unchanged model', () => {
    const m = erModel(big)
    expect(focusModel(m, '')).toBe(m)
  })
  it('focuses on matched table + 1-hop FK neighbors, counts hidden links', () => {
    const f = focusModel(erModel(big), 'orders', 1)
    expect(f.nodes.map((n) => n.id).sort()).toEqual(['customer', 'orders', 'product']) // unrelated dropped
    expect(f.edges).toHaveLength(2)
  })
  it('matching a leaf pulls in its parent only (1 hop)', () => {
    const f = focusModel(erModel(big), 'customer', 1)
    expect(f.nodes.map((n) => n.id).sort()).toEqual(['customer', 'orders'])
    expect(f.externalRefs).toBe(1) // orders→product edge crosses out of the focused set
  })
  it('case-insensitive substring match', () => {
    expect(focusModel(erModel(big), 'CUST', 0).nodes.map((n) => n.id)).toEqual(['customer'])
  })
})
