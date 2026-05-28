import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { SQL_DEFAULT, buildEditDml, parseEditableTable } from './editable'

describe('parseEditableTable', () => {
  it('accepts simple SELECT *', () => {
    expect(parseEditableTable('select * from users')).toBe('users')
    expect(parseEditableTable('SELECT * FROM `shop`.`u` WHERE id=1')).toBe('`shop`.`u`')
  })
  it('rejects joins and aggregates', () => {
    expect(parseEditableTable('select * from a join b on a.i=b.i')).toBeNull()
  })
})

describe('buildEditDml with SQL_DEFAULT sentinel', () => {
  it('emits DEFAULT keyword (not a literal)', () => {
    const stmts = buildEditDml(DbDialect.MySQL, '`users`', ['id', 'name'], {
      updates: [{ original: { id: 1, name: 'a' }, changed: { name: { ...SQL_DEFAULT } } }],
      inserts: [],
      deletes: [],
    })
    expect(stmts).toHaveLength(1)
    expect(stmts[0]).toBe("UPDATE `users` SET `name` = DEFAULT WHERE `id` = 1 AND `name` = 'a'")
  })

  it('NULL still wins over sentinel checks', () => {
    const stmts = buildEditDml(DbDialect.PostgreSQL, '"t"', ['id'], {
      updates: [{ original: { id: 1 }, changed: { id: null } }],
      inserts: [],
      deletes: [],
    })
    expect(stmts[0]).toBe('UPDATE "t" SET "id" = NULL WHERE "id" = 1')
  })
})
