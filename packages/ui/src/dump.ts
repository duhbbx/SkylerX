/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
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

/** 生成库/schema 的数据字典（HTML：含目录 + 每表一节的表格，可打印 PDF）。 */
export function buildDataDictHtml(
  title: string,
  tables: { name: string; columns: MetadataNode[] }[],
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const toc = tables
    .map(
      (tbl) =>
        `<li><a href="#t-${encodeURIComponent(tbl.name)}">${esc(tbl.name)}</a> <span class="muted">(${tbl.columns.length})</span></li>`,
    )
    .join('')
  const sections = tables
    .map((tbl) => {
      const rows = tbl.columns
        .map((c) => {
          const d = c.detail ?? {}
          return `<tr><td>${esc(c.name)}</td><td>${esc(d.dataType ?? '')}</td><td>${d.nullable ? 'Y' : 'N'}</td><td>${d.primaryKey ? '🔑' : ''}</td><td>${esc(d.defaultValue == null ? '' : String(d.defaultValue))}</td><td>${esc(d.comment ?? '')}</td></tr>`
        })
        .join('\n')
      return `<section id="t-${encodeURIComponent(tbl.name)}">
<h2>${esc(tbl.name)}</h2>
<table><thead><tr><th>字段</th><th>类型</th><th>可空</th><th>主键</th><th>默认</th><th>注释</th></tr></thead><tbody>
${rows}
</tbody></table>
</section>`
    })
    .join('\n')
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)} · 数据字典</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#222}
h1{margin:0 0 8px}h2{margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.meta{color:#888;font-size:12px;margin-bottom:18px}
.toc{column-count:3;column-gap:24px;margin:0 0 24px;padding:0 0 0 18px;font-size:13px}
.toc li{break-inside:avoid}
.muted{color:#999;font-size:11px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#f3f3f5}
tr:nth-child(even) td{background:#fafafa}
a{color:#7c6cff;text-decoration:none}a:hover{text-decoration:underline}
@media print{section{break-inside:avoid}}
</style></head>
<body>
<h1>数据字典：${esc(title)}</h1>
<div class="meta">共 ${tables.length} 张表 · 生成于 ${new Date().toLocaleString()}</div>
<ol class="toc">${toc}</ol>
${sections}
</body></html>`
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
  const pks = cols
    .filter((c) => (c.detail as { primaryKey?: boolean })?.primaryKey)
    .map((c) => q(c.name))
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
