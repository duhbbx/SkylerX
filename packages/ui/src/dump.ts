import type { DbDialect, MetadataNode } from '@db-tool/shared-types'
import { quoteId } from './ddl'
import { toInsertSql } from './io'

type Row = Record<string, unknown>

/** 生成库/schema 的数据字典（Markdown：每表一节，列出字段/类型/可空/主键/默认/注释）。 */
export function buildDataDictMarkdown(
  title: string,
  tables: { name: string; columns: MetadataNode[] }[],
): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const out: string[] = [
    `# 数据字典：${title}`,
    '',
    `> 共 ${tables.length} 张表 · 生成于 ${new Date().toLocaleString()}`,
    '',
  ]
  for (const tbl of tables) {
    out.push(`## ${tbl.name}`, '')
    out.push('| 字段 | 类型 | 可空 | 主键 | 默认 | 注释 |', '| --- | --- | --- | --- | --- | --- |')
    for (const c of tbl.columns) {
      const d = c.detail ?? {}
      out.push(
        `| ${esc(c.name)} | ${esc(d.dataType ?? '')} | ${d.nullable ? 'Y' : 'N'} | ${d.primaryKey ? '🔑' : ''} | ${esc(d.defaultValue == null ? '' : String(d.defaultValue))} | ${esc(d.comment ?? '')} |`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}

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
