/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { type ColumnHint, type TableHint, inferForeignKeys } from './fk-inference'

/** 测试辅助：快速造一张表 */
function table(name: string, columns: ColumnHint[]): TableHint {
  return { name, columns }
}
function pk(name = 'id', type: ColumnHint['type'] = 'int'): ColumnHint {
  return { name, type, primaryKey: true }
}
function col(name: string, type: ColumnHint['type'] = 'int', extras: Partial<ColumnHint> = {}) {
  return { name, type, ...extras }
}

describe('inferForeignKeys', () => {
  describe('基础后缀匹配', () => {
    it('简单 user_id → users(id)', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int'), col('name', 'string')]),
        table('orders', [pk('id', 'int'), col('user_id', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({
          fromTable: 'orders',
          fromCol: 'user_id',
          toTable: 'users',
          toCol: 'id',
        }),
      )
      const fk = result.find((r) => r.fromCol === 'user_id')!
      expect(fk.confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('支持 camelCase userId → users(id)', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('orders', [pk('id', 'int'), col('userId', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'userId', toTable: 'users', toCol: 'id' }),
      )
    })

    it('支持 _uuid 后缀', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'uuid')]),
        table('orders', [pk('id', 'uuid'), col('user_uuid', 'uuid')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'user_uuid', toTable: 'users' }),
      )
    })
  })

  describe('自引用', () => {
    it('parent_id 自引用本表 id', () => {
      const result = inferForeignKeys([
        table('categories', [pk('id', 'int'), col('parent_id', 'int', { nullable: true })]),
      ])
      const fk = result.find((r) => r.fromCol === 'parent_id')
      expect(fk).toBeDefined()
      expect(fk!.fromTable).toBe('categories')
      expect(fk!.toTable).toBe('categories')
      expect(fk!.toCol).toBe('id')
      expect(fk!.reason).toMatch(/自引用/)
    })

    it('parent_id 在没有 parent 表时只指向自己', () => {
      const result = inferForeignKeys([table('nodes', [pk('id', 'int'), col('parent_id', 'int')])])
      const fks = result.filter((r) => r.fromCol === 'parent_id')
      expect(fks.length).toBe(1)
      expect(fks[0].toTable).toBe('nodes')
    })
  })

  describe('命名约定 → users', () => {
    it('created_by → users(id)', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('posts', [pk('id', 'int'), col('created_by', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'created_by', toTable: 'users', toCol: 'id' }),
      )
    })

    it('updated_by → users(id)', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('posts', [pk('id', 'int'), col('updated_by', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'updated_by', toTable: 'users' }),
      )
    })

    it('owner_id 在 users 存在时优先指向 users（而不是不存在的 owners）', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('docs', [pk('id', 'int'), col('owner_id', 'int')]),
      ])
      const fk = result.find((r) => r.fromCol === 'owner_id')!
      expect(fk.toTable).toBe('users')
      expect(fk.reason).toMatch(/常用约定/)
    })

    it('created_by 在没有 users 表时不返回', () => {
      const result = inferForeignKeys([table('posts', [pk('id', 'int'), col('created_by', 'int')])])
      expect(result.find((r) => r.fromCol === 'created_by')).toBeUndefined()
    })
  })

  describe('目标表不存在', () => {
    it('user_id 在没有 users / user 表时不返回', () => {
      const result = inferForeignKeys([table('orders', [pk('id', 'int'), col('user_id', 'int')])])
      expect(result.find((r) => r.fromCol === 'user_id')).toBeUndefined()
    })

    it('随机命名 random_xyz 完全不命中后缀规则', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('t', [pk('id', 'int'), col('random_xyz', 'string')]),
      ])
      expect(result.find((r) => r.fromCol === 'random_xyz')).toBeUndefined()
    })
  })

  describe('类型兼容性', () => {
    it('类型不兼容降分但其它规则强时仍返回', () => {
      // user_id 是 string，users.id 是 int → 类型不兼容；但后缀+目标表存在仍有 0.8
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('orders', [pk('id', 'int'), col('user_id', 'string')]),
      ])
      const fk = result.find((r) => r.fromCol === 'user_id')
      expect(fk).toBeDefined()
      expect(fk!.confidence).toBeLessThan(0.9)
      expect(fk!.confidence).toBeGreaterThanOrEqual(0.3)
      expect(fk!.reason).toMatch(/类型不一致/)
    })

    it('类型完全相同（uuid↔uuid）提分', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'uuid')]),
        table('orders', [pk('id', 'uuid'), col('user_id', 'uuid')]),
      ])
      const fk = result.find((r) => r.fromCol === 'user_id')!
      expect(fk.confidence).toBeGreaterThanOrEqual(0.9)
      expect(fk.reason).toMatch(/类型兼容\(uuid\)/)
    })
  })

  describe('复合命名', () => {
    it('assigned_to_user_id → users(id)', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('tasks', [pk('id', 'int'), col('assigned_to_user_id', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({
          fromCol: 'assigned_to_user_id',
          toTable: 'users',
          toCol: 'id',
        }),
      )
    })

    it('billing_address_id → addresses(id)（取最后一段做复数）', () => {
      const result = inferForeignKeys([
        table('addresses', [pk('id', 'int')]),
        table('orders', [pk('id', 'int'), col('billing_address_id', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'billing_address_id', toTable: 'addresses' }),
      )
    })
  })

  describe('PK 列不被推为 FK 源', () => {
    it('某表的 id 列即使叫 user_id 也不当 FK 源', () => {
      // 罕见但有效场景：主键自己叫 user_id
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('user_profile', [{ name: 'user_id', type: 'int', primaryKey: true }]),
      ])
      expect(result.find((r) => r.fromTable === 'user_profile')).toBeUndefined()
    })

    it('常规 id 主键不被处理', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('orders', [pk('id', 'int'), col('user_id', 'int')]),
      ])
      expect(result.find((r) => r.fromCol === 'id')).toBeUndefined()
    })
  })

  describe('UUID 互推', () => {
    it('uuid 源 + uuid PK 全规则命中 → 高置信度', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'uuid')]),
        table('sessions', [pk('id', 'uuid'), col('user_id', 'uuid')]),
      ])
      const fk = result.find((r) => r.fromCol === 'user_id')!
      expect(fk.toTable).toBe('users')
      expect(fk.toCol).toBe('id')
      expect(fk.confidence).toBeGreaterThanOrEqual(0.9)
    })

    it('uuid → int 不兼容但仍可能返回', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('sessions', [pk('id', 'uuid'), col('user_id', 'uuid')]),
      ])
      const fk = result.find((r) => r.fromCol === 'user_id')!
      expect(fk.reason).toMatch(/类型不一致/)
    })
  })

  describe('排序与阈值', () => {
    it('结果按 confidence 倒序', () => {
      const result = inferForeignKeys([
        table('users', [pk('id', 'int')]),
        table('addresses', [pk('id', 'int')]),
        table('orders', [
          pk('id', 'int'),
          col('user_id', 'int'),
          col('billing_address_id', 'string'), // 类型不兼容
        ]),
      ])
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].confidence).toBeGreaterThanOrEqual(result[i].confidence)
      }
    })

    it('空 schema 返回空数组', () => {
      expect(inferForeignKeys([])).toEqual([])
    })

    it('单表无候选返回空', () => {
      const result = inferForeignKeys([table('flat', [pk('id', 'int'), col('name', 'string')])])
      expect(result).toEqual([])
    })
  })

  describe('复数化候选表', () => {
    it('category_id → categories（y→ies）', () => {
      const result = inferForeignKeys([
        table('categories', [pk('id', 'int')]),
        table('posts', [pk('id', 'int'), col('category_id', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'category_id', toTable: 'categories' }),
      )
    })

    it('user_id 在表名为单数 user 时也能匹配', () => {
      const result = inferForeignKeys([
        table('user', [pk('id', 'int')]),
        table('orders', [pk('id', 'int'), col('user_id', 'int')]),
      ])
      expect(result).toContainEqual(
        expect.objectContaining({ fromCol: 'user_id', toTable: 'user' }),
      )
    })
  })
})
