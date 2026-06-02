/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移评估 —— 文档导出。
 *
 *  - Excel(.xlsx):多 sheet 结构化数据(概览/对象盘点/大表/评估明细/AI 转换),DBA 拿去分析
 *  - Word(.doc) :Markdown 报告渲染成带样式的 HTML,Word 直接打开(CJK 无障碍)
 *  - PDF        :同一份 HTML 打印窗口,走 Chromium 自带「另存为 PDF」(CJK 完美,免装库)
 *
 * 复用现有依赖:xlsx(SheetJS)、marked(renderMarkdown)。不引入 PDF/Word 库。
 */
import { formatBytes } from '../ddl'
import { renderMarkdown } from '../markdown'
import {
  CATEGORY_LABEL,
  OBJECT_CATEGORIES,
  type ObjectInventory,
  type SourceProfile,
  type TableSize,
} from './profile'
import type { AssessSummary, ConvertResult } from './types'

type Row = Array<string | number | null>

/** 盘点取值;缺失(库不支持)→ null(Excel 空格 / 文档显示 —)。 */
function invVal(inv: ObjectInventory, cat: (typeof OBJECT_CATEGORIES)[number]): number | null {
  return inv[cat] ?? null
}

/** 汇总所有 schema 的大表,按行数排序取前 N。 */
function topTables(profile: SourceProfile, n = 50): TableSize[] {
  const all = profile.schemaProfiles.flatMap((p) => p.largestTables)
  return [...all].sort((a, b) => b.rows - a.rows).slice(0, n)
}

// ── Excel ───────────────────────────────────────────────────────

/** 生成 .xlsx 二进制(Uint8Array)。 */
export async function buildExcel(
  profile: SourceProfile,
  summary: AssessSummary | null,
  conversions: ConvertResult[] = [],
): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const add = (name: string, aoa: Row[]): void => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31))
  }

  const t = profile.totals
  // 1) 概览
  add('概览 Overview', [
    ['指标 Metric', '值 Value'],
    ['源方言 Source', String(profile.dialect)],
    ['目标方言 Target', summary ? String(summary.target) : '—'],
    ['Schema 数', t.schemas],
    ['表数 Tables', t.tables],
    ['对象总数 Objects', t.objects],
    ['总大小 Size', formatBytes(t.sizeBytes)],
    ['估算总行数 Rows', t.metrics.totalRows],
    ['≥100万行 表数', t.rowBuckets.over1M],
    ['≥1000万行 表数', t.rowBuckets.over10M],
    ['≥1亿行 表数', t.rowBuckets.over100M],
    ['无主键表 No-PK tables', t.metrics.tablesWithoutPk ?? null],
    ['LOB 列数 LOB columns', t.metrics.lobColumns ?? null],
    ['带触发器表数', t.metrics.tablesWithTriggers ?? null],
    ['有注释表数', t.metrics.tablesWithComment ?? null],
    ['可迁移就绪度 Readiness', summary ? summary.readiness : '—'],
  ])

  // 2) 对象盘点(每 schema 一行 × 全类目)
  const invHeader: Row = ['Schema', ...OBJECT_CATEGORIES.map((c) => CATEGORY_LABEL[c][0])]
  const invRows: Row[] = profile.schemaProfiles.map((sp) => [
    sp.schema,
    ...OBJECT_CATEGORIES.map((c) => invVal(sp.inventory, c)),
  ])
  invRows.push(['合计 Total', ...OBJECT_CATEGORIES.map((c) => invVal(t.inventory, c))])
  add('对象盘点 Inventory', [invHeader, ...invRows])

  // 3) 大表 Top
  add('大表 Large tables', [
    ['Schema', '表 Table', '估算行数 Rows', '大小 Size'],
    ...topTables(profile).map((x) => [x.schema, x.name, x.rows, formatBytes(x.bytes)] as Row),
  ])

  // 4) 评估明细
  if (summary) {
    add('评估明细 Assessment', [
      ['对象 Object', '类型 Kind', '等级 Grade', '关注点 Concerns'],
      ...summary.items.map(
        (it) =>
          [
            `${it.schema}.${it.name}`,
            it.kind,
            it.grade,
            it.notes.map((nn) => nn.msg).join('; '),
          ] as Row,
      ),
    ])
  }

  // 5) AI 转换
  if (conversions.length) {
    add('AI 转换 Conversions', [
      ['对象 Object', '类型 Kind', '目标 SQL', '迁移说明 Notes', '错误 Error'],
      ...conversions.map(
        (c) => [`${c.schema}.${c.name}`, c.kind, c.sql, c.notes, c.error ?? ''] as Row,
      ),
    ])
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Uint8Array(out)
}

// ── Word / PDF(共享 HTML) ──────────────────────────────────────

const DOC_CSS = `
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; color: #222; line-height: 1.5; padding: 32px; max-width: 980px; margin: 0 auto; }
  h1 { font-size: 22px; border-bottom: 2px solid #2d7ff9; padding-bottom: 6px; }
  h2 { font-size: 17px; margin-top: 24px; border-left: 4px solid #2d7ff9; padding-left: 8px; }
  h3 { font-size: 14px; margin-top: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #f0f4fb; }
  pre { background: #1e1e1e; color: #dcdcdc; padding: 10px; border-radius: 6px; overflow: auto; font-size: 12px; white-space: pre-wrap; }
  code { font-family: "SFMono-Regular", Consolas, monospace; }
  blockquote { color: #666; border-left: 3px solid #ddd; margin: 8px 0; padding-left: 10px; }
  @media print { body { padding: 0; } pre { white-space: pre-wrap; } }
`

/**
 * 把 Markdown 报告包成完整 HTML 文档。
 * @param autoPrint true 时内嵌 onload 打印脚本(用于 PDF:打开即弹「另存为 PDF」)。
 */
export function buildHtmlDoc(
  markdown: string,
  opts: { title: string; autoPrint?: boolean },
): string {
  const body = renderMarkdown(markdown)
  const printScript = opts.autoPrint
    ? '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>'
    : ''
  // Word 识别的 office 命名空间头,确保 .doc 正常打开。
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title><style>${DOC_CSS}</style></head>
<body>${body}${printScript}</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )
}

/** 在新窗口打开可打印 HTML,触发浏览器「另存为 PDF」。 */
export function openPrintWindow(html: string): boolean {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank', 'noopener,width=900,height=1000')
  if (!w) {
    URL.revokeObjectURL(url)
    return false
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
