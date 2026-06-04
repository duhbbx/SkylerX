/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 对象语料补充:批量取一个 schema 的视图(含物化视图)定义、函数/存储过程签名,
 * 切成 chunk 进索引。让「这个报表视图从哪几张表来?」「有没有算税的函数?」也能问。
 *
 * 目前 pg 家族(PostgreSQL / Vastbase / openGauss …)用 catalog 批量查、已活验;
 * 其它家族(oracle / mysql / sqlserver)暂返回空 —— 宁可少索引,不发没验过的 SQL。
 * ddl.ts 的 objectDdlQuery 是逐对象取 DDL,这里要的是整 schema 一次拉,故单独写。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'
import type { ProfileExec } from '../migrate/profile'
import { lit } from '../migrate/profile'
import type { RagRoutine, RagView } from './corpus'

const str = (v: unknown): string => (v == null ? '' : String(v))

/** 批量取视图 + 物化视图定义。pg 家族:pg_views(+ pg_matviews,老内核没有则忽略)。 */
export async function readViews(
  exec: ProfileExec,
  dialect: DbDialect,
  schema: string,
): Promise<RagView[]> {
  if (familyOf(dialect) !== 'pg') return []
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

/** 批量取函数 / 存储过程签名(不含函数体)。pg 家族:pg_proc + pg_namespace。 */
export async function readRoutines(
  exec: ProfileExec,
  dialect: DbDialect,
  schema: string,
): Promise<RagRoutine[]> {
  if (familyOf(dialect) !== 'pg') return []
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
