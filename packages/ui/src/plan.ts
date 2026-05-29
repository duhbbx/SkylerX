/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'

export interface PlanNode {
  label: string
  detail: string
  cost: number
  rows: number
  /** PG ANALYZE 实际行数（仅 EXPLAIN ANALYZE 有；否则 undefined） */
  actualRows?: number
  /** PG ANALYZE 实际耗时（ms，仅 EXPLAIN ANALYZE 有） */
  actualMs?: number
  /** PG 关系名 / 索引名（用于"看到底扫了谁"） */
  relation?: string
  indexName?: string
  children: PlanNode[]
}

/** 估算 vs 实际偏差倍数；>10 视为严重低估（典型的优化器统计过时） */
export function estimateSkew(n: PlanNode): number | null {
  if (n.actualRows == null || n.rows <= 0) return null
  return Math.max(n.rows, n.actualRows) / Math.max(1, Math.min(n.rows, n.actualRows))
}

function family(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if (['mysql', 'mariadb', 'oceanbase'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase'].includes(d)) return 'pg'
  return 'other'
}

/** 取可视化执行计划的查询；PG 用 JSON 解析成树，MySQL 用 TREE 文本。其余返回 null（回退表格 EXPLAIN）。
 *  options.analyze=true 会真正执行查询（PG 加 ANALYZE，MySQL 用 EXPLAIN ANALYZE FORMAT=JSON），
 *  得到实际行数和耗时；DML 务必先确认。 */
export function planQuery(
  dialect: DbDialect,
  sql: string,
  options?: { analyze?: boolean },
): { sql: string; format: 'pg-json' | 'mysql-tree' } | null {
  const s = sql.trim().replace(/;\s*$/, '')
  if (!s) return null
  const f = family(dialect)
  const analyze = options?.analyze === true
  if (f === 'pg') {
    return {
      sql: analyze ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${s}` : `EXPLAIN (FORMAT JSON) ${s}`,
      format: 'pg-json',
    }
  }
  if (f === 'mysql') {
    // MySQL 8.0.18+ 支持 EXPLAIN ANALYZE，输出树形文本（FORMAT=JSON 不能跟 ANALYZE）
    return {
      sql: analyze ? `EXPLAIN ANALYZE ${s}` : `EXPLAIN FORMAT=TREE ${s}`,
      format: 'mysql-tree',
    }
  }
  return null
}

interface PgPlan {
  Plans?: PgPlan[]
  [k: string]: unknown
}
function toNode(p: PgPlan): PlanNode {
  const parts: string[] = []
  if (p['Relation Name']) parts.push(`on ${String(p['Relation Name'])}`)
  if (p['Index Name']) parts.push(`using ${String(p['Index Name'])}`)
  if (p['Join Type']) parts.push(`${String(p['Join Type'])} join`)
  const actualRows = p['Actual Rows'] != null ? Number(p['Actual Rows']) : undefined
  const actualMs = p['Actual Total Time'] != null ? Number(p['Actual Total Time']) : undefined
  return {
    label: String(p['Node Type'] ?? 'Node'),
    detail: parts.join(' '),
    cost: Number(p['Total Cost'] ?? 0),
    rows: Number(p['Plan Rows'] ?? 0),
    actualRows,
    actualMs,
    relation: p['Relation Name'] ? String(p['Relation Name']) : undefined,
    indexName: p['Index Name'] ? String(p['Index Name']) : undefined,
    children: (p.Plans ?? []).map(toNode),
  }
}

export function parsePgPlan(jsonText: string): PlanNode | null {
  try {
    const arr = JSON.parse(jsonText) as Array<{ Plan: PgPlan }>
    const root = arr[0]?.Plan
    return root ? toNode(root) : null
  } catch {
    return null
  }
}

/** 拍平成 {node, depth} 列表，便于无递归组件渲染。 */
export function flattenPlan(root: PlanNode): { node: PlanNode; depth: number }[] {
  const out: { node: PlanNode; depth: number }[] = []
  const walk = (n: PlanNode, depth: number): void => {
    out.push({ node: n, depth })
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}
