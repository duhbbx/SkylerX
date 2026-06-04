/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import type { SchemaInput } from '../migrate/convert'
import { erModel } from './model'

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
