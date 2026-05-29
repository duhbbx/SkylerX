/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

export type ExportFormat = 'csv' | 'json' | 'sql' | 'markdown' | 'html'
type Row = Record<string, unknown>

// ── 导出 ──

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s =
    v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
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

/**
 * Tab-Separated Values：Excel / Notion / 飞书表格直接粘贴粘出来表格。
 * 跟 CSV 同样的转义思路，但分隔符是 \t，引号在含 \t/换行时才用。
 */
export function toTSV(columns: string[], rows: Row[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s =
      v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map(cell).join('\t')
  if (!rows.length) return `${head}\n`
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join('\t')).join('\n')
  return `${head}\n${body}\n`
}

/**
 * 只输出 SQL VALUES 列表（不含 INSERT INTO 头），方便粘进 INSERT...VALUES、
 * VALUES (...) 子查询、或 ON CONFLICT...EXCLUDED 这类场景。
 * 形如 `(1, 'a'), (2, 'b'), (3, NULL)`。
 */
export function toSqlValuesList(columns: string[], rows: Row[]): string {
  return rows.map((r) => `(${columns.map((c) => sqlLiteral(r[c])).join(', ')})`).join(',\n')
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export function toMarkdown(columns: string[], rows: Row[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = `| ${columns.map(esc).join(' | ')} |`
  const sep = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${columns.map((c) => esc(cellText(r[c]))).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

export function toHTML(columns: string[], rows: Row[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const th = columns.map((c) => `<th>${esc(c)}</th>`).join('')
  const trs = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${esc(cellText(r[c]))}</td>`).join('')}</tr>`)
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>SkylerX export</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#222}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f3f3f5;position:sticky;top:0}
tr:nth-child(even) td{background:#fafafa}
</style></head>
<body>
<p>${rows.length} rows · exported ${new Date().toLocaleString()}</p>
<table><thead><tr>${th}</tr></thead><tbody>
${trs}
</tbody></table>
</body></html>`
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
    (r) =>
      `INSERT INTO ${tableRef} (${colList}) VALUES (${columns.map((c) => sqlLiteral(r[c])).join(', ')});`,
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
  if (format === 'markdown') return toMarkdown(columns, rows)
  if (format === 'html') return toHTML(columns, rows)
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

/** 单元格值统一转字符串：null/undefined→''(视为 NULL)，对象/数组→JSON，其余→String。 */
function jsonCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * 解析 JSON 为 string[][]（首行表头），复用 CSV 同一导入管线。
 * 支持「对象数组」(键并集为表头) 与「数组的数组」(原样)；单对象按一行处理。
 */
export function parseJSON(text: string): string[][] {
  const data = JSON.parse(text) as unknown
  const arr = (Array.isArray(data) ? data : [data]) as unknown[]
  if (!arr.length) return []
  if (Array.isArray(arr[0])) return arr.map((r) => (r as unknown[]).map(jsonCell))
  const keys: string[] = []
  for (const o of arr) {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
    }
  }
  const rows = arr.map((o) => keys.map((k) => jsonCell((o as Record<string, unknown>)?.[k])))
  return [keys, ...rows]
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
  const lit = (s: string | undefined) =>
    s == null || s === '' ? 'NULL' : `'${s.replace(/'/g, "''")}'`
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
