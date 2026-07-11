/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据血缘 —— 表级 lineage 提取(正则启发,非完整 parser)。
 *
 * 从 SQL 抽「哪些源表流入哪个目标」:FROM/JOIN 是源,INSERT INTO / CREATE … AS /
 * UPDATE / MERGE INTO / DELETE FROM 是目标;纯 SELECT 没写目标时归到「(结果)」节点。
 * CTE(WITH x AS …)名识别出来,既不当真实表、也作为中间节点。
 *
 * 表级足够看懂「这个查询/ETL 从哪来到哪去」;列级需要真 parser,本版不做。
 */

export interface StmtLineage {
  /** 目标对象(写入/建出的);纯查询为 undefined。 */
  target?: string
  /** 源表(已去 CTE、去重)。 */
  sources: string[]
  /** 本语句里的 CTE 名(中间节点)。 */
  ctes: string[]
}

export interface LineageGraph {
  nodes: Array<{ id: string; kind: 'table' | 'cte' | 'result' }>
  edges: Array<{ from: string; to: string }>
}

/** 去注释 + 去字符串字面量(避免把字符串里的 FROM 之类误当关键字)。 */
function clean(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]*)"/g, (_m, x) => x) // 去双引号但保留标识符内容
    .replace(/`([^`]*)`/g, (_m, x) => x)
    .replace(/\[([^\]]*)\]/g, (_m, x) => x)
}

/** 规范化表名:去尾随别名前的空白,保留 schema.table。 */
function norm(raw: string): string {
  return raw.trim().replace(/^["`[]|["`\]]$/g, '')
}

const TABLE = '[A-Za-z_][\\w$]*(?:\\.[A-Za-z_][\\w$]*)*'

/** 抽单条语句的血缘。 */
export function extractLineage(sql: string): StmtLineage {
  const s = clean(sql)
  // CTE 名:WITH x AS ( … ), y AS ( … )
  const ctes: string[] = []
  for (const m of s.matchAll(new RegExp(`(?:\\bwith\\b|,)\\s*(${TABLE})\\s+as\\s*\\(`, 'gi'))) {
    ctes.push(norm(m[1]))
  }
  const cteSet = new Set(ctes.map((c) => c.toLowerCase()))

  // 目标
  let target: string | undefined
  const tgt =
    new RegExp(`\\binsert\\s+into\\s+(${TABLE})`, 'i').exec(s) ??
    new RegExp(
      `\\bcreate\\s+(?:or\\s+replace\\s+)?(?:global\\s+temporary\\s+)?(?:table|view|materialized\\s+view)\\s+(?:if\\s+not\\s+exists\\s+)?(${TABLE})`,
      'i',
    ).exec(s) ??
    new RegExp(`\\bmerge\\s+into\\s+(${TABLE})`, 'i').exec(s) ??
    new RegExp(`\\bupdate\\s+(${TABLE})`, 'i').exec(s) ??
    new RegExp(`\\bdelete\\s+from\\s+(${TABLE})`, 'i').exec(s)
  if (tgt) target = norm(tgt[1])

  // 源:FROM / JOIN <table>
  const srcSet = new Map<string, string>() // lower → display
  for (const m of s.matchAll(new RegExp(`\\b(?:from|join)\\s+(${TABLE})`, 'gi'))) {
    const name = norm(m[1])
    const low = name.toLowerCase()
    if (cteSet.has(low)) continue // CTE 不是真实源表
    if (target && low === target.toLowerCase()) continue // UPDATE/DELETE 的自身不算源
    if (!srcSet.has(low)) srcSet.set(low, name)
  }
  return { target, sources: [...srcSet.values()], ctes }
}

/** 多条语句聚合成血缘图。无目标的语句汇到「(结果)」。 */
export function lineageGraph(statements: string[]): LineageGraph {
  const nodes = new Map<string, { id: string; kind: 'table' | 'cte' | 'result' }>()
  const edgeSet = new Set<string>()
  const edges: Array<{ from: string; to: string }> = []
  const addNode = (id: string, kind: 'table' | 'cte' | 'result'): void => {
    if (!nodes.has(id.toLowerCase())) nodes.set(id.toLowerCase(), { id, kind })
  }
  const addEdge = (from: string, to: string): void => {
    if (from.toLowerCase() === to.toLowerCase()) return
    const k = `${from.toLowerCase()}→${to.toLowerCase()}`
    if (!edgeSet.has(k)) {
      edgeSet.add(k)
      edges.push({ from, to })
    }
  }

  for (const stmt of statements) {
    if (!stmt.trim()) continue
    const lin = extractLineage(stmt)
    for (const c of lin.ctes) addNode(c, 'cte')
    const tgt = lin.target ?? '(结果)'
    addNode(tgt, lin.target ? 'table' : 'result')
    for (const src of lin.sources) {
      addNode(src, 'table')
      addEdge(src, tgt)
    }
  }
  return { nodes: [...nodes.values()], edges }
}
