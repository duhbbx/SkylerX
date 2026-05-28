import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { type Row, diffRows, generateDataSync, valueLiteral } from './data-diff'

const cols = ['id', 'name', 'age']
const key = ['id']

const source: Row[] = [
  { id: 1, name: 'a', age: 10 },
  { id: 2, name: 'b', age: 20 }, // target 里 age 不同 → update
  { id: 3, name: 'c', age: 30 }, // target 没有 → insert
]
const target: Row[] = [
  { id: 1, name: 'a', age: 10 }, // 相同
  { id: 2, name: 'b', age: 99 },
  { id: 4, name: 'd', age: 40 }, // source 没有 → delete
]

describe('diffRows', () => {
  const d = diffRows(source, target, key, cols)
  it('classifies insert / update / delete by primary key', () => {
    expect(d.inserts.map((r) => r.id)).toEqual([3])
    expect(d.deletes.map((r) => r.id)).toEqual([4])
    expect(d.updates).toHaveLength(1)
    expect(d.updates[0].key).toEqual({ id: 2 })
    expect(d.updates[0].changed).toEqual(['age'])
  })
  it('treats number/string of equal value as same (driver tolerance)', () => {
    const d2 = diffRows([{ id: 1, v: 5 }], [{ id: 1, v: '5' }], ['id'], ['id', 'v'])
    expect(d2.updates).toHaveLength(0)
  })
  it('null vs value differs; null vs null same', () => {
    expect(
      diffRows([{ id: 1, v: null }], [{ id: 1, v: 1 }], ['id'], ['id', 'v']).updates,
    ).toHaveLength(1)
    expect(
      diffRows([{ id: 1, v: null }], [{ id: 1, v: null }], ['id'], ['id', 'v']).updates,
    ).toHaveLength(0)
  })
})

describe('valueLiteral', () => {
  it('renders SQL literals by JS type', () => {
    expect(valueLiteral(DbDialect.MySQL, null)).toBe('NULL')
    expect(valueLiteral(DbDialect.MySQL, 42)).toBe('42')
    expect(valueLiteral(DbDialect.MySQL, true)).toBe('TRUE')
    expect(valueLiteral(DbDialect.MySQL, "O'Brien")).toBe("'O''Brien'")
    expect(valueLiteral(DbDialect.MySQL, { a: 1 })).toBe('\'{"a":1}\'')
  })
})

describe('generateDataSync', () => {
  const d = diffRows(source, target, key, cols)
  const sql = generateDataSync(d, DbDialect.MySQL, '`t`', key, cols)
  it('emits INSERT / UPDATE / DELETE sections', () => {
    expect(sql).toContain("INSERT INTO `t` (`id`, `name`, `age`) VALUES (3, 'c', 30);")
    expect(sql).toContain('UPDATE `t` SET `age` = 20 WHERE `id` = 2;')
    expect(sql).toContain('DELETE FROM `t` WHERE `id` = 4;')
  })
  it('comments the destructive DELETE section', () => {
    expect(sql).toContain('-- 删除 1 行')
  })
})
