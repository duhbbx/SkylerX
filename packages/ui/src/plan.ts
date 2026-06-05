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

function family(d: DbDialect): 'mysql' | 'pg' | 'oracle' | 'other' {
  if (['mysql', 'mariadb', 'oceanbase', 'gbase8a'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase', 'vastbase', 'mogdb', 'panweidb', 'highgo'].includes(d)) return 'pg'
  if (['oracle', 'dm'].includes(d)) return 'oracle'
  return 'other'
}

export type PlanFormat = 'pg-json' | 'mysql-json' | 'mysql-tree' | 'oracle-rows'

/**
 * 取可视化执行计划的查询。
 *  - PG     : EXPLAIN (FORMAT JSON) → 解析成热力树（ANALYZE 时带实际行/耗时）
 *  - MySQL  : 默认 EXPLAIN FORMAT=JSON → 热力树；analyze 时 EXPLAIN ANALYZE（树形文本）
 *  - Oracle/DM: 先 `EXPLAIN PLAN FOR`（prep），再读 PLAN_TABLE → 按 id/parent_id 建树
 *  其余返回 null（上层回退普通表格 EXPLAIN）。
 *  返回里带 prep 的（Oracle）必须跟 sql 跑在同一连接上（PLAN_TABLE 是会话级 GTT）。
 *  analyze=true 会真正执行查询；DML 务必先确认。
 */
export function planQuery(
  dialect: DbDialect,
  sql: string,
  options?: { analyze?: boolean },
): { prep?: string; sql: string; format: PlanFormat } | null {
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
    // EXPLAIN ANALYZE 只能输出树形文本（不能跟 FORMAT=JSON）；不 analyze 时用 JSON 建热力树。
    return analyze
      ? { sql: `EXPLAIN ANALYZE ${s}`, format: 'mysql-tree' }
      : { sql: `EXPLAIN FORMAT=JSON ${s}`, format: 'mysql-json' }
  }
  if (f === 'oracle') {
    // EXPLAIN PLAN 没有 ANALYZE 概念；两步：写 PLAN_TABLE → 读出来按层级建树。
    return {
      prep: `EXPLAIN PLAN FOR ${s}`,
      sql: `SELECT id, parent_id, operation, options, object_name, cost, cardinality, bytes
            FROM plan_table ORDER BY id`,
      format: 'oracle-rows',
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

const numOf = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── MySQL EXPLAIN FORMAT=JSON → 树 ──
// 结构不规则：query_block 下可能是 nested_loop[] / table / ordering_operation / grouping_operation …
// 递归识别已知算子键，cost 取 cost_info（prefix_cost 累积 / query_cost），rows 取产出行数。
interface MyObj {
  [k: string]: unknown
}
function myCostInfo(o: MyObj): MyObj {
  return (o.cost_info as MyObj) ?? {}
}
function myTableNode(t: MyObj): PlanNode {
  const ci = myCostInfo(t)
  const access = String(t.access_type ?? 'table')
  const key = t.key ? ` (${String(t.key)})` : ''
  return {
    label: `${access}${key}`,
    detail: t.table_name ? `on ${String(t.table_name)}` : '',
    cost: numOf(ci.prefix_cost ?? ci.read_cost ?? ci.query_cost),
    rows: numOf(t.rows_produced_per_join ?? t.rows_examined_per_scan),
    relation: t.table_name ? String(t.table_name) : undefined,
    indexName: t.key ? String(t.key) : undefined,
    children: [],
  }
}
const MY_OP_KEYS = [
  'ordering_operation',
  'grouping_operation',
  'duplicates_removal',
  'materialized_from_subquery',
  'union_result',
]
function myOp(obj: MyObj, fallback: string): PlanNode {
  if (Array.isArray(obj.nested_loop)) {
    const kids = (obj.nested_loop as MyObj[]).map((e) => myOp(e, 'table'))
    return {
      label: 'Nested loop',
      detail: '',
      cost: kids.reduce((m, k) => Math.max(m, k.cost), 0),
      rows: kids.length ? kids[kids.length - 1].rows : 0,
      children: kids,
    }
  }
  if (obj.table) return myTableNode(obj.table as MyObj)
  for (const opKey of MY_OP_KEYS) {
    if (obj[opKey]) {
      const child = myOp(obj[opKey] as MyObj, opKey)
      return {
        label: opKey.replace(/_/g, ' '),
        detail: '',
        cost: Math.max(child.cost, numOf(myCostInfo(obj).query_cost)),
        rows: child.rows,
        children: [child],
      }
    }
  }
  if (obj.query_block) return myOp(obj.query_block as MyObj, 'query_block')
  return { label: fallback, detail: '', cost: numOf(myCostInfo(obj).query_cost), rows: 0, children: [] }
}
export function parseMysqlPlan(jsonText: string): PlanNode | null {
  try {
    const j = JSON.parse(jsonText) as MyObj
    const qb = j.query_block as MyObj | undefined
    if (!qb) return null
    const node = myOp(qb, 'query_block')
    const qcost = numOf(myCostInfo(qb).query_cost)
    if (qcost > node.cost) node.cost = qcost
    return node
  } catch {
    return null
  }
}

// ── Oracle / DM PLAN_TABLE 行 → 树（按 id / parent_id 链）──
type Row = Record<string, unknown>
function col(r: Row, key: string): unknown {
  return r[key] ?? r[key.toUpperCase()] ?? r[key.toLowerCase()]
}
export function parseOraclePlan(rows: Row[]): PlanNode | null {
  if (!rows?.length) return null
  const nodes = new Map<number, PlanNode & { _pid: number | null }>()
  for (const r of rows) {
    const id = numOf(col(r, 'id'))
    const pidRaw = col(r, 'parent_id')
    const op = String(col(r, 'operation') ?? '')
    const opt = col(r, 'options')
    const obj = col(r, 'object_name')
    nodes.set(id, {
      label: opt ? `${op} ${String(opt)}` : op,
      detail: obj ? `on ${String(obj)}` : '',
      cost: numOf(col(r, 'cost')),
      rows: numOf(col(r, 'cardinality')),
      relation: obj ? String(obj) : undefined,
      children: [],
      _pid: pidRaw == null || pidRaw === '' ? null : numOf(pidRaw),
    })
  }
  let root: PlanNode | null = null
  for (const n of nodes.values()) {
    if (n._pid == null) root = n
    else nodes.get(n._pid)?.children.push(n)
  }
  return root
}

/** 统一把一次 EXPLAIN 的结果转成 { tree, text }，供 QueryPane 直接喂给 PlanPanel。 */
export function buildPlanData(
  format: PlanFormat,
  result: { rows: Row[] },
): { tree: PlanNode | null; text: string | null } {
  const firstCell = (): string =>
    result.rows.map((r) => String(Object.values(r)[0] ?? '')).join('\n')
  switch (format) {
    case 'pg-json':
      return { tree: parsePgPlan(firstCell()), text: null }
    case 'mysql-json':
      return { tree: parseMysqlPlan(firstCell()), text: null }
    case 'oracle-rows':
      return { tree: parseOraclePlan(result.rows), text: null }
    default:
      return { tree: null, text: firstCell() }
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
