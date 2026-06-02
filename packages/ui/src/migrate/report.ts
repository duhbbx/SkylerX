/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移评估 —— 报告生成。
 *
 * 把 {@link AssessSummary}(+ 可选的 AI 转换结果)汇总成一份 Markdown 评估报告,
 * 供向导预览 / 导出。纯字符串拼接,无副作用,可单测。
 */
import { formatBytes } from '../ddl'
import { CATEGORY_LABEL, OBJECT_CATEGORIES, type SourceProfile } from './profile'
import { type AssessSummary, type CompatGrade, type ConvertResult, GRADE_LABEL } from './types'

const ORDER: CompatGrade[] = ['A', 'B', 'C', 'D']

/** 数字或 —(库不支持/未取到)。 */
function n(v: number | null | undefined): string {
  return v == null ? '—' : String(v)
}

function gradeName(g: CompatGrade): string {
  const [zh, en] = GRADE_LABEL[g]
  return `${g} ${zh}/${en}`
}

/** 一行可迁移就绪度的文字结论。 */
function verdict(readiness: number): string {
  if (readiness >= 90) return '✅ 高度可迁移:绝大多数对象可自动/辅助迁移,人工工作量小。'
  if (readiness >= 70) return '🟡 基本可迁移:存在少量需人工改写的对象,建议预留复核时间。'
  if (readiness >= 40) return '🟠 部分可迁移:相当比例对象含 Oracle 专有语法,需 AI + 人工逐个处理。'
  return '🔴 迁移有阻断:存在无等价能力(空间/外部包等),需先做架构层评估。'
}

export interface ReportOptions {
  /** AI 转换结果(可选);有则附「AI 转换」章节。 */
  conversions?: ConvertResult[]
  /** 源库画像(可选);有则附「源库画像」章节(对象盘点 / 风险指标 / 大表)。 */
  profile?: SourceProfile
  /** 报告生成时间戳(由调用方注入,模块内不取 Date 以便测试)。 */
  generatedAt?: string
}

/** 源库画像章节(对象盘点 + 风险指标 + 行数分桶 + 大表)。 */
function profileSection(p: SourceProfile): string[] {
  const L: string[] = []
  const t = p.totals
  L.push('## 源库画像')
  L.push('')
  L.push('### 总览')
  L.push('')
  L.push('| 指标 | 值 |')
  L.push('| --- | ---: |')
  L.push(`| Schema 数 | ${t.schemas} |`)
  L.push(`| 表数 | ${t.tables} |`)
  L.push(`| 对象总数 | ${t.objects} |`)
  L.push(`| 总大小 | ${formatBytes(t.sizeBytes)} |`)
  L.push(`| 估算总行数 | ${t.metrics.totalRows.toLocaleString()} |`)
  L.push(`| ≥100万行 表数 | ${t.rowBuckets.over1M} |`)
  L.push(`| ≥1000万行 表数 | ${t.rowBuckets.over10M} |`)
  L.push(`| ≥1亿行 表数 | ${t.rowBuckets.over100M} |`)
  L.push(`| 无主键表 | ${n(t.metrics.tablesWithoutPk)} |`)
  L.push(`| LOB 大对象列 | ${n(t.metrics.lobColumns)} |`)
  L.push(`| 带触发器表 | ${n(t.metrics.tablesWithTriggers)} |`)
  L.push(`| 有注释表 | ${n(t.metrics.tablesWithComment)} |`)
  L.push('')

  // 对象盘点(每 schema × 全类目;库不支持的列显示 —)
  L.push('### 对象盘点')
  L.push('')
  const cats = OBJECT_CATEGORIES
  L.push(`| Schema | ${cats.map((c) => CATEGORY_LABEL[c][0]).join(' | ')} |`)
  L.push(`| --- | ${cats.map(() => '---:').join(' | ')} |`)
  for (const sp of p.schemaProfiles) {
    L.push(`| ${sp.schema} | ${cats.map((c) => n(sp.inventory[c])).join(' | ')} |`)
  }
  L.push(`| **合计** | ${cats.map((c) => `**${n(t.inventory[c])}**`).join(' | ')} |`)
  L.push('')

  // 大表 Top
  const top = p.schemaProfiles
    .flatMap((sp) => sp.largestTables)
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 15)
  if (top.length) {
    L.push('### 大表 Top 15(按估算行数)')
    L.push('')
    L.push('| 表 | 估算行数 | 大小 |')
    L.push('| --- | ---: | ---: |')
    for (const x of top) {
      L.push(`| ${x.schema}.${x.name} | ${x.rows.toLocaleString()} | ${formatBytes(x.bytes)} |`)
    }
    L.push('')
  }
  return L
}

/** 生成 Markdown 评估报告。 */
export function buildReport(summary: AssessSummary, opts: ReportOptions = {}): string {
  const { source, target, items, byGrade, readiness, aiCandidates } = summary
  const L: string[] = []

  L.push(`# 信创迁移评估报告 — ${source} → ${target}`)
  if (opts.generatedAt) L.push(`\n> 生成时间:${opts.generatedAt}`)
  L.push('')
  L.push(`**可迁移就绪度:${readiness}/100**`)
  L.push('')
  L.push(verdict(readiness))
  L.push('')

  // 源库画像(若有)
  if (opts.profile?.schemaProfiles.length) L.push(...profileSection(opts.profile))

  // 等级分布
  L.push('## 等级分布')
  L.push('')
  L.push('| 等级 | 含义 | 对象数 |')
  L.push('| --- | --- | ---: |')
  for (const g of ORDER) {
    L.push(`| ${g} | ${gradeName(g).slice(2)} | ${byGrade[g]} |`)
  }
  L.push(`| **合计** | | **${items.length}** |`)
  L.push('')
  L.push(`> 建议交 AI 语义转换的对象:**${aiCandidates}** 个(C 级)。`)
  L.push('')

  // 明细
  L.push('## 对象明细')
  L.push('')
  L.push('| 对象 | 类型 | 等级 | 关注点 |')
  L.push('| --- | --- | --- | --- |')
  for (const it of sortItems(items)) {
    const concerns = it.notes.map((n) => n.msg)
    const summary1 = concerns.length ? truncate(concerns.join('; '), 120) : '—'
    L.push(`| \`${it.schema}.${it.name}\` | ${it.kind} | ${it.grade} | ${escapePipes(summary1)} |`)
  }
  L.push('')

  // 阻断项专列(D 级)
  const blocked = items.filter((it) => it.grade === 'D')
  if (blocked.length) {
    L.push('## ⚠ 阻断项(需架构层评估)')
    L.push('')
    for (const it of blocked) {
      L.push(`- \`${it.schema}.${it.name}\` (${it.kind}): ${it.blockers.join('; ')}`)
    }
    L.push('')
  }

  // AI 转换结果
  if (opts.conversions?.length) {
    L.push('## AI 语义转换结果(只读,需人工复核)')
    L.push('')
    for (const c of opts.conversions) {
      L.push(`### \`${c.schema}.${c.name}\` (${c.kind})`)
      L.push('')
      if (c.error) {
        L.push(`> ❌ 转换失败:${c.error}`)
        L.push('')
        continue
      }
      if (c.sql) {
        L.push('```sql')
        L.push(c.sql)
        L.push('```')
        L.push('')
      }
      if (c.notes) {
        L.push('**迁移说明:**')
        L.push('')
        L.push(c.notes)
        L.push('')
      }
    }
  }

  return L.join('\n')
}

function sortItems<T extends { grade: CompatGrade; schema: string; name: string }>(
  items: T[],
): T[] {
  const rank: Record<CompatGrade, number> = { D: 0, C: 1, B: 2, A: 3 }
  return [...items].sort(
    (a, b) =>
      rank[a.grade] - rank[b.grade] ||
      `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
  )
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
