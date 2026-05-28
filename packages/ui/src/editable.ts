import type { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

type Row = Record<string, unknown>

export interface EditChanges {
  /** 改动的现有行：原始行 + 变更的列 */
  updates: Array<{ original: Row; changed: Record<string, unknown> }>
  /** 新增行 */
  inserts: Row[]
  /** 删除的现有行（用原始值匹配） */
  deletes: Row[]
}

const MYSQL = ['mysql', 'mariadb', 'oceanbase']
const PAGINATABLE = ['mysql', 'mariadb', 'oceanbase', 'postgresql', 'kingbase', 'sqlserver']

/** 该方言是否支持可编辑网格（MySQL 系 + PG 系 + SQL Server）。 */
export function dialectEditable(dialect: DbDialect): boolean {
  return PAGINATABLE.includes(dialect)
}

/**
 * 解析「简单单表 SELECT *」，返回表引用（保持用户书写的限定/转义形式）；否则 null。
 * 拒绝 JOIN / 多表 / 聚合等复杂查询。
 */
export function parseEditableTable(sql: string): string | null {
  const s = sql.trim().replace(/;\s*$/, '')
  if (/\bjoin\b/i.test(s)) return null
  const m = /^select\s+\*\s+from\s+([^\s,()]+)\s*(where\b|order\s+by\b|group\s+by\b|limit\b|fetch\b|$)/i.exec(
    s,
  )
  if (!m) return null
  // FROM 与下一关键字之间若还有逗号（多表）已被 [^\s,()]+ 排除
  return m[1]
}

/** SQL 原样表达式哨兵：用于「设为 DEFAULT / CURRENT_TIMESTAMP」等不是字面量的赋值。 */
export const SQL_DEFAULT = { __sql: 'DEFAULT' } as const
export function isSqlSentinel(v: unknown): v is { __sql: string } {
  return !!v && typeof v === 'object' && typeof (v as { __sql?: unknown }).__sql === 'string'
}

function lit(v: unknown, dialect: DbDialect): string {
  if (v === null || v === undefined) return 'NULL'
  if (isSqlSentinel(v)) return v.__sql
  if (typeof v === 'number') return String(v)
  // MySQL 系与 SQL Server(bit) 用 1/0；PG 系用 TRUE/FALSE
  if (typeof v === 'boolean') {
    return MYSQL.includes(dialect) || dialect === 'sqlserver' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE'
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

function whereClause(columns: string[], row: Row, dialect: DbDialect): string {
  return columns
    .map((c) => {
      const v = row[c]
      return v === null || v === undefined
        ? `${quoteId(dialect, c)} IS NULL`
        : `${quoteId(dialect, c)} = ${lit(v, dialect)}`
    })
    .join(' AND ')
}

/**
 * 由编辑变更生成 DML（删除 → 更新 → 插入）。
 * 用整行原值匹配 WHERE（无主键依赖）；重复行会一并影响，提交在事务中。
 */
export function buildEditDml(
  dialect: DbDialect,
  table: string,
  columns: string[],
  changes: EditChanges,
): string[] {
  const stmts: string[] = []

  for (const del of changes.deletes) {
    stmts.push(`DELETE FROM ${table} WHERE ${whereClause(columns, del, dialect)}`)
  }
  for (const up of changes.updates) {
    const cols = Object.keys(up.changed)
    if (!cols.length) continue
    const set = cols.map((c) => `${quoteId(dialect, c)} = ${lit(up.changed[c], dialect)}`).join(', ')
    stmts.push(`UPDATE ${table} SET ${set} WHERE ${whereClause(columns, up.original, dialect)}`)
  }
  for (const ins of changes.inserts) {
    const cols = Object.keys(ins).filter((c) => ins[c] !== undefined && ins[c] !== '')
    if (!cols.length) continue
    const names = cols.map((c) => quoteId(dialect, c)).join(', ')
    const vals = cols.map((c) => lit(ins[c], dialect)).join(', ')
    stmts.push(`INSERT INTO ${table} (${names}) VALUES (${vals})`)
  }

  return stmts
}
