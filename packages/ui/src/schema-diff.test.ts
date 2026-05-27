import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { type TableSnapshot, diffSchemas, generateMigration } from './schema-diff'

const col = (name: string, dataType: string, extra: Partial<TableSnapshot['columns'][0]> = {}) => ({
  name,
  dataType,
  nullable: true,
  ...extra,
})

const source: TableSnapshot[] = [
  {
    name: 'users',
    columns: [
      col('id', 'int', { nullable: false, primaryKey: true }),
      col('name', 'varchar(100)', { nullable: false }),
      col('age', 'int'), // 目标里是 smallint → modify
    ],
  },
  { name: 'orders', columns: [col('id', 'int', { nullable: false, primaryKey: true })] }, // 目标没有 → added
]

const target: TableSnapshot[] = [
  {
    name: 'users',
    columns: [
      col('id', 'int', { nullable: false, primaryKey: true }),
      col('age', 'smallint'), // 类型不同
      col('legacy', 'text'), // 源没有 → drop
    ],
  },
  { name: 'audit', columns: [col('id', 'int')] }, // 源没有 → removed
]

describe('diffSchemas', () => {
  const diffs = diffSchemas(source, target)
  const byTable = Object.fromEntries(diffs.map((d) => [d.table, d]))

  it('flags source-only tables as added and target-only as removed', () => {
    expect(byTable.orders.status).toBe('added')
    expect(byTable.audit.status).toBe('removed')
  })

  it('detects add / drop / modify columns on shared tables', () => {
    const changes = byTable.users.columnChanges ?? []
    const kinds = Object.fromEntries(changes.map((c) => [c.column, c.kind]))
    expect(kinds.name).toBe('add') // 源有目标无
    expect(kinds.age).toBe('modify') // 类型不同
    expect(kinds.legacy).toBe('drop') // 目标有源无
  })

  it('treats identical tables as no diff', () => {
    const same = diffSchemas(source, source)
    expect(same.filter((d) => d.status === 'changed')).toHaveLength(0)
  })
})

describe('generateMigration', () => {
  const diffs = diffSchemas(source, target)

  it('creates source-only tables', () => {
    const sql = generateMigration(diffs, DbDialect.MySQL, source)
    expect(sql).toContain('CREATE TABLE `orders`')
    expect(sql).toContain('PRIMARY KEY (`id`)')
  })

  it('emits MySQL MODIFY COLUMN and ADD COLUMN', () => {
    const sql = generateMigration(diffs, DbDialect.MySQL, source)
    expect(sql).toContain('ADD COLUMN `name` varchar(100) NOT NULL')
    expect(sql).toContain('MODIFY COLUMN `age` int')
  })

  it('emits PostgreSQL ALTER COLUMN TYPE for modifications', () => {
    const sql = generateMigration(diffs, DbDialect.PostgreSQL, source)
    expect(sql).toContain('ALTER COLUMN "age" TYPE int')
  })

  it('comments out destructive DROP operations', () => {
    const sql = generateMigration(diffs, DbDialect.MySQL, source)
    expect(sql).toContain('-- 删列需谨慎')
    expect(sql).toContain('-- DROP TABLE `audit`')
  })
})
