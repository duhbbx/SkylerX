/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL 规则引擎（启发式，不做完整 parser）。
 *
 * 与 QueryPane.dangerOf 的区别：
 *  - dangerOf 主要给单语句出一句话提示，与现有「prod 二次输入连接名」流程绑定；
 *  - lintSql 是更通用的规则集，按 severity 分级（error/warn/info）：
 *      error → 弹确认才执行
 *      warn  → toast 提示，仍然执行
 *      info  → 静默（调用方决定是否在 UI 上挂角标）
 *
 *  规则尽量便宜：纯 regex/字符串扫，避免在执行热路径上拖慢用户。
 */
import type { ConnectionEnv } from '@db-tool/shared-types'
import { type CustomLintRule, lintCustom } from './sqlLintCustom'

export type LintSeverity = 'error' | 'warn' | 'info'

export interface LintFinding {
  id: string
  severity: LintSeverity
  message: string
}

export interface LintContext {
  /** 连接环境标记（dev/test/prod）；prod 触发更严格规则 */
  connEnv?: ConnectionEnv
  /** 整连接只读：只读连接由 isReadOnlyStatement 拦截写语句，本 linter 不再重复判 */
  isReadOnly?: boolean
  /** 用户自定义正则规则（在内置规则之外一起跑）。 */
  customRules?: CustomLintRule[]
}

interface Rule {
  id: string
  severity: LintSeverity
  /** 命中时返回提示文案；不命中返回 null */
  match: (sql: string, ctx: LintContext) => string | null
}

/** 去掉注释（行注释 + 块注释），避免 `-- WHERE` 误判为有 WHERE。 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** 取首个关键字（select / update / delete / drop ...），全小写。 */
function firstKeyword(sql: string): string {
  const m = sql.trim().match(/^\s*(\w+)/)
  return m ? m[1].toLowerCase() : ''
}

const RULES: Rule[] = [
  {
    id: 'no-where-update',
    severity: 'error',
    match: (sql) => {
      const s = stripComments(sql)
      if (firstKeyword(s) !== 'update') return null
      if (/\bwhere\b/i.test(s)) return null
      return 'UPDATE 缺少 WHERE 子句，将更新整张表'
    },
  },
  {
    id: 'no-where-delete',
    severity: 'error',
    match: (sql) => {
      const s = stripComments(sql)
      if (!/^\s*delete\s+from\b/i.test(s)) return null
      if (/\bwhere\b/i.test(s)) return null
      return 'DELETE 缺少 WHERE 子句，将清空整张表'
    },
  },
  {
    id: 'prod-drop',
    severity: 'error',
    match: (sql, ctx) => {
      if (ctx.connEnv !== 'prod') return null
      const s = stripComments(sql)
      const m = s.match(/^\s*drop\s+(table|database|schema|index|view)\b/i)
      if (!m) return null
      return `生产环境执行 DROP ${m[1].toUpperCase()}`
    },
  },
  {
    id: 'prod-truncate',
    severity: 'warn',
    match: (sql, ctx) => {
      if (ctx.connEnv !== 'prod') return null
      const s = stripComments(sql)
      if (!/^\s*truncate\b/i.test(s)) return null
      return '生产环境执行 TRUNCATE'
    },
  },
  {
    id: 'cross-join',
    severity: 'warn',
    match: (sql) => {
      const s = stripComments(sql)
      if (firstKeyword(s) !== 'select') return null
      // 多表 FROM：`FROM a, b` 或 `FROM a JOIN b` 不带 ON
      const fromMatch = s.match(/\bfrom\b([\s\S]*?)(\bwhere\b|\bgroup\b|\border\b|\blimit\b|;|$)/i)
      if (!fromMatch) return null
      const fromClause = fromMatch[1]
      // `FROM a, b` 形式：逗号分隔多表
      const commaJoin = /,/.test(fromClause) && !/\bjoin\b/i.test(fromClause)
      // `JOIN` 但缺 `ON` / `USING`
      const bareJoin =
        /\bjoin\b/i.test(fromClause) &&
        !/\b(on|using)\b/i.test(fromClause) &&
        !/\bnatural\s+join\b/i.test(fromClause) &&
        !/\bcross\s+join\b/i.test(fromClause)
      if (commaJoin || bareJoin) return '多表查询未指定连接条件（疑似笛卡尔积）'
      return null
    },
  },
  {
    id: 'select-star',
    severity: 'info',
    match: (sql) => {
      const s = stripComments(sql)
      if (!/^\s*select\s+\*/i.test(s)) return null
      // 子查询 `SELECT *` 一般用于 EXISTS/COUNT，不报
      return 'SELECT * 建议显式列出列名'
    },
  },
  {
    id: 'forgotten-limit',
    severity: 'info',
    match: (sql) => {
      const s = stripComments(sql)
      if (firstKeyword(s) !== 'select') return null
      if (/\blimit\b/i.test(s)) return null
      if (/\bfetch\s+first\b/i.test(s)) return null // ANSI
      if (/\btop\s+\d+/i.test(s)) return null // SQL Server
      if (/\bcount\s*\(/i.test(s)) return null // 聚合常无需 LIMIT
      return 'SELECT 没有 LIMIT，可能拉回大量数据'
    },
  },
]

/** 对单条 SQL 跑规则集，返回所有命中的 finding。 */
export function lintSql(sql: string, ctx: LintContext): LintFinding[] {
  const out: LintFinding[] = []
  if (!sql || !sql.trim()) return out
  for (const r of RULES) {
    const msg = r.match(sql, ctx)
    if (msg) out.push({ id: r.id, severity: r.severity, message: msg })
  }
  // 用户自定义正则规则(可选)
  if (ctx.customRules?.length) out.push(...lintCustom(sql, ctx.customRules))
  return out
}

/** 对多条语句聚合 lint：每条单独跑，汇总（去重 id 仅保留最严重 severity）。 */
export function lintStatements(statements: string[], ctx: LintContext): LintFinding[] {
  const byId = new Map<string, LintFinding>()
  const sevRank: Record<LintSeverity, number> = { info: 0, warn: 1, error: 2 }
  for (const stmt of statements) {
    for (const f of lintSql(stmt, ctx)) {
      const prev = byId.get(f.id)
      if (!prev || sevRank[f.severity] > sevRank[prev.severity]) byId.set(f.id, f)
    }
  }
  return [...byId.values()]
}
