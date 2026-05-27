import type { DbDialect } from '@db-tool/shared-types'

export interface PlanNode {
  label: string
  detail: string
  cost: number
  rows: number
  children: PlanNode[]
}

function family(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if (['mysql', 'mariadb', 'oceanbase'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase'].includes(d)) return 'pg'
  return 'other'
}

/** 取可视化执行计划的查询；PG 用 JSON 解析成树，MySQL 用 TREE 文本。其余返回 null（回退表格 EXPLAIN）。 */
export function planQuery(
  dialect: DbDialect,
  sql: string,
): { sql: string; format: 'pg-json' | 'mysql-tree' } | null {
  const s = sql.trim().replace(/;\s*$/, '')
  if (!s) return null
  const f = family(dialect)
  if (f === 'pg') return { sql: `EXPLAIN (FORMAT JSON) ${s}`, format: 'pg-json' }
  if (f === 'mysql') return { sql: `EXPLAIN FORMAT=TREE ${s}`, format: 'mysql-tree' }
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
  return {
    label: String(p['Node Type'] ?? 'Node'),
    detail: parts.join(' '),
    cost: Number(p['Total Cost'] ?? 0),
    rows: Number(p['Plan Rows'] ?? 0),
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
