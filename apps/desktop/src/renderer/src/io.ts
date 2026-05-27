import type { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

export type ExportFormat = 'csv' | 'json' | 'sql'
type Row = Record<string, unknown>

// ── 导出 ──

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(columns: string[], rows: Row[]): string {
  const head = columns.map(csvCell).join(',')
  if (!rows.length) return `${head}\r\n`
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\r\n')
  return `${head}\r\n${body}\r\n`
}

export function toJSON(rows: Row[]): string {
  return JSON.stringify(rows, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2)
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

/** 每行一条 INSERT 语句（数组形式，供 executeBatch 分批执行）。 */
export function rowInserts(
  dialect: DbDialect | undefined,
  tableRef: string,
  columns: string[],
  rows: Row[],
): string[] {
  const colList = columns.map((c) => (dialect != null ? quoteId(dialect, c) : `"${c}"`)).join(', ')
  return rows.map(
    (r) => `INSERT INTO ${tableRef} (${colList}) VALUES (${columns.map((c) => sqlLiteral(r[c])).join(', ')});`,
  )
}

export function toInsertSql(
  dialect: DbDialect | undefined,
  tableRef: string,
  columns: string[],
  rows: Row[],
): string {
  return rowInserts(dialect, tableRef, columns, rows).join('\n')
}

export function exportRows(
  format: ExportFormat,
  columns: string[],
  rows: Row[],
  opts: { dialect?: DbDialect; tableRef?: string } = {},
): string {
  if (format === 'csv') return toCSV(columns, rows)
  if (format === 'json') return toJSON(rows)
  return toInsertSql(opts.dialect, opts.tableRef ?? 'table_name', columns, rows)
}

// ── 导入 (CSV → INSERT) ──

/** 解析 CSV 文本为二维数组（处理引号转义、CRLF、BOM）。 */
export function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/**
 * CSV 数据行 → 批量 INSERT（按 chunk 合并多值；空串视为 NULL）。
 * columns 为目标列名（已与数据列按位置对齐），dataRows 不含表头。
 */
export function buildInsertStatements(
  dialect: DbDialect,
  tableRef: string,
  columns: string[],
  dataRows: string[][],
  chunkSize = 200,
): string[] {
  const colList = columns.map((c) => quoteId(dialect, c)).join(', ')
  const lit = (s: string | undefined) => (s == null || s === '' ? 'NULL' : `'${s.replace(/'/g, "''")}'`)
  const out: string[] = []
  for (let i = 0; i < dataRows.length; i += chunkSize) {
    const values = dataRows
      .slice(i, i + chunkSize)
      .map((r) => `(${columns.map((_c, ci) => lit(r[ci])).join(', ')})`)
      .join(', ')
    out.push(`INSERT INTO ${tableRef} (${colList}) VALUES ${values};`)
  }
  return out
}
