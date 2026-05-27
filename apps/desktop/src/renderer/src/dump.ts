import type { DbDialect, MetadataNode } from '@db-tool/shared-types'
import { quoteId } from './ddl'
import { toInsertSql } from './io'

type Row = Record<string, unknown>

/** 由列元数据重建 CREATE TABLE（结构 dump；含主键，不含索引/外键——v1）。 */
export function buildCreateFromColumns(
  dialect: DbDialect,
  tableRef: string,
  cols: MetadataNode[],
): string {
  const q = (s: string) => quoteId(dialect, s)
  const lines = cols.map((c) => {
    const d = (c.detail ?? {}) as {
      dataType?: string
      nullable?: boolean
      primaryKey?: boolean
      defaultValue?: unknown
    }
    let s = `  ${q(c.name)} ${d.dataType ?? ''}`
    if (d.nullable === false) s += ' NOT NULL'
    if (d.defaultValue != null && String(d.defaultValue) !== '') s += ` DEFAULT ${d.defaultValue}`
    return s
  })
  const pks = cols.filter((c) => (c.detail as { primaryKey?: boolean })?.primaryKey).map((c) => q(c.name))
  if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)
  return `CREATE TABLE ${tableRef} (\n${lines.join(',\n')}\n);`
}

/** 生成单表 SQL dump：结构（+可选数据 INSERT）。 */
export function buildTableDump(
  dialect: DbDialect,
  tableRef: string,
  cols: MetadataNode[],
  rows: Row[],
  withData = true,
): string {
  const create = buildCreateFromColumns(dialect, tableRef, cols)
  if (!withData) return `-- 表结构\n${create}\n`
  const colNames = cols.map((c) => c.name)
  const inserts = rows.length ? toInsertSql(dialect, tableRef, colNames, rows) : '-- （无数据）'
  return `-- 表结构\n${create}\n\n-- 数据（${rows.length} 行）\n${inserts}\n`
}
