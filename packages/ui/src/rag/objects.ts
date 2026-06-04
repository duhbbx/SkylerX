/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 对象语料补充:批量取一个 schema 的视图(含物化视图)定义、函数/存储过程签名,
 * 切成 chunk 进索引。让「这个报表视图从哪几张表来?」「有没有算税的函数?」也能问。
 *
 * pg 家族(PostgreSQL / Vastbase / openGauss …)与 mysql 家族都已用 catalog 批量查 + 活验;
 * 其它家族(oracle / sqlserver)暂返回空 —— 宁可少索引,不发没验过的 SQL。
 * ddl.ts 的 objectDdlQuery 是逐对象取 DDL,这里要的是整 schema 一次拉,故单独写。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'
import type { ProfileExec } from '../migrate/profile'
import { lit } from '../migrate/profile'
import type { RagRoutine, RagView } from './corpus'

const str = (v: unknown): string => (v == null ? '' : String(v))
const g = (r: Record<string, unknown>, k: string): unknown => r[k] ?? r[k.toUpperCase()]

/** 批量取视图(+ 物化视图)定义。pg:pg_views/pg_matviews;mysql:information_schema.VIEWS(无物化视图)。 */
export async function readViews(
  exec: ProfileExec,
  dialect: DbDialect,
  schema: string,
): Promise<RagView[]> {
  const fam = familyOf(dialect)
  if (fam === 'mysql') {
    const rows = await exec(
      `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS def FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ${lit(schema)}`,
    )
    return rows.map((r) => ({
      schema,
      name: str(g(r, 'name')),
      definition: str(g(r, 'def')),
      materialized: false,
    }))
  }
  if (fam !== 'pg') return []
  const out: RagView[] = []
  const views = await exec(
    `SELECT viewname AS name, definition FROM pg_views WHERE schemaname = ${lit(schema)}`,
  )
  for (const r of views)
    out.push({ schema, name: str(r.name), definition: str(r.definition), materialized: false })
  // 物化视图:pg_matviews 是 PG 9.3+ 才有;openGauss/老内核没有 → 静默跳过。
  try {
    const mv = await exec(
      `SELECT matviewname AS name, definition FROM pg_matviews WHERE schemaname = ${lit(schema)}`,
    )
    for (const r of mv)
      out.push({ schema, name: str(r.name), definition: str(r.definition), materialized: true })
  } catch {
    /* 无 pg_matviews,忽略 */
  }
  return out
}

/** 批量取函数 / 存储过程签名(不含体)。pg:pg_proc;mysql:information_schema.ROUTINES + PARAMETERS。 */
export async function readRoutines(
  exec: ProfileExec,
  dialect: DbDialect,
  schema: string,
): Promise<RagRoutine[]> {
  const fam = familyOf(dialect)
  if (fam === 'mysql') return readMysqlRoutines(exec, schema)
  if (fam !== 'pg') return []
  // prokind 是 PG 11+ 才有(p=函数,a=聚合,w=窗口,f=过程);老内核没有这列 →
  // 退化成「全当 function」。两条查询分支,失败回退。
  const base = `pg_get_function_arguments(p.oid) AS args, pg_get_function_result(p.oid) AS result,
       n.nspname AS schema, p.proname AS name`
  const from = `FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ${lit(schema)}`
  let rows: Array<Record<string, unknown>>
  let hasKind = true
  try {
    rows = await exec(`SELECT p.prokind AS kind, ${base} ${from} AND p.prokind IN ('f','p')`)
  } catch {
    hasKind = false
    rows = await exec(`SELECT ${base} ${from}`)
  }
  return rows.map((r) => ({
    schema,
    name: str(r.name),
    kind: hasKind && str(r.kind) === 'p' ? ('procedure' as const) : ('function' as const),
    signature: `(${str(r.args)})${r.result ? ` RETURNS ${str(r.result)}` : ''}`,
  }))
}

/** MySQL 例程:ROUTINES 给名字/类型/返回类型,PARAMETERS 给参数列表(ORDINAL_POSITION 0 = 函数返回)。 */
async function readMysqlRoutines(exec: ProfileExec, schema: string): Promise<RagRoutine[]> {
  const routines = await exec(
    `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS ret
     FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${lit(schema)}`,
  )
  const params = await exec(
    `SELECT SPECIFIC_NAME AS rname, PARAMETER_NAME AS pname, DTD_IDENTIFIER AS ptype, ORDINAL_POSITION AS pos
     FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = ${lit(schema)} ORDER BY SPECIFIC_NAME, ORDINAL_POSITION`,
  )
  const argsByRoutine = new Map<string, string[]>()
  for (const r of params) {
    if (Number(g(r, 'pos')) === 0) continue // 0 = 函数返回值,不是入参
    const rn = str(g(r, 'rname'))
    if (!argsByRoutine.has(rn)) argsByRoutine.set(rn, [])
    argsByRoutine.get(rn)?.push(`${str(g(r, 'pname'))} ${str(g(r, 'ptype'))}`.trim())
  }
  return routines.map((r) => {
    const name = str(g(r, 'name'))
    const isProc = str(g(r, 'type')).toUpperCase() === 'PROCEDURE'
    const ret = str(g(r, 'ret'))
    const args = (argsByRoutine.get(name) ?? []).join(', ')
    return {
      schema,
      name,
      kind: isProc ? ('procedure' as const) : ('function' as const),
      signature: `(${args})${!isProc && ret ? ` RETURNS ${ret}` : ''}`,
    }
  })
}
