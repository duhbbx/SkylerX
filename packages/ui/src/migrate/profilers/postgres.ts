/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * PG 系源库 profiler:openGauss / Vastbase / PostgreSQL 的全量对象盘点 + 风险指标。
 * 行数取 pg_class.reltuples 估算值(秒级),不做精确 COUNT(*)(亿级表会拖死)。
 * openGauss 专有对象(包 gs_package / 同义词 pg_synonym)能取就取,取不到留 null。
 */
import { DbDialect } from '@db-tool/shared-types'
import {
  type DatabaseInfo,
  type ObjectInventory,
  type ProfileExec,
  type SchemaInfo,
  type SchemaMetrics,
  type SchemaProfile,
  type SourceProfiler,
  type TableSize,
  bucketize,
  lit,
  num,
} from '../profile'

async function listDatabases(exec: ProfileExec): Promise<DatabaseInfo[]> {
  const rows = await exec(
    `SELECT d.datname AS name, d.datistemplate AS is_template,
            pg_database_size(d.datname) AS size_bytes
     FROM pg_database d WHERE d.datallowconn ORDER BY d.datname`,
  )
  const SYS = new Set(['postgres', 'template0', 'template1'])
  return rows.map((r) => {
    const name = String(r.name ?? '')
    return { name, system: !!r.is_template || SYS.has(name), sizeBytes: num(r.size_bytes) }
  })
}

async function listSchemas(
  exec: ProfileExec,
  _database: string | undefined,
  showSystem = false,
): Promise<SchemaInfo[]> {
  const where = showSystem ? '' : 'WHERE n.oid >= 16384'
  const rows = await exec(
    `SELECT n.nspname AS name, n.oid AS oid FROM pg_namespace n ${where} ORDER BY n.nspname`,
  )
  return rows.map((r) => ({ name: String(r.name ?? ''), system: num(r.oid) < 16384 }))
}

/** 跑一条聚合查询,取第一行某列的数;失败返回 null(不计入盘点)。 */
async function scalar(exec: ProfileExec, sql: string, col = 'cnt'): Promise<number | null> {
  try {
    const rows = await exec(sql)
    if (!rows.length) return 0
    return num(rows[0][col])
  } catch {
    return null
  }
}

async function profileSchema(
  exec: ProfileExec,
  database: string | undefined,
  schema: string,
): Promise<SchemaProfile> {
  const ns = lit(schema)
  const warnings: string[] = []
  const inv: ObjectInventory = {}

  // 1) pg_class 按 relkind 一把梭:表/分区表/视图/物化视图/索引/序列
  try {
    const rows = await exec(
      `SELECT c.relkind AS kind, count(*)::int AS cnt
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${ns} GROUP BY c.relkind`,
    )
    const by: Record<string, number> = {}
    for (const r of rows) by[String(r.kind)] = num(r.cnt)
    inv.tables = (by.r ?? 0) + (by.p ?? 0)
    inv.partitionedTables = by.p ?? 0
    inv.views = by.v ?? 0
    inv.materializedViews = by.m ?? 0
    inv.indexes = (by.i ?? 0) + (by.I ?? 0)
    inv.sequences = by.S ?? 0
  } catch (e) {
    warnings.push(`对象盘点失败:${e instanceof Error ? e.message : String(e)}`)
  }

  // 2) pg_constraint 按类型:主键/外键/唯一/检查
  try {
    const rows = await exec(
      `SELECT c.contype AS t, count(*)::int AS cnt
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = ${ns} GROUP BY c.contype`,
    )
    const by: Record<string, number> = {}
    for (const r of rows) by[String(r.t)] = num(r.cnt)
    inv.primaryKeys = by.p ?? 0
    inv.foreignKeys = by.f ?? 0
    inv.uniqueConstraints = by.u ?? 0
    inv.checkConstraints = by.c ?? 0
  } catch {
    /* 约束盘点可选 */
  }

  // 3) pg_proc:函数 / 存储过程(prokind;旧版无此列则全计函数)
  try {
    const rows = await exec(
      `SELECT p.prokind AS k, count(*)::int AS cnt FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${ns} GROUP BY p.prokind`,
    )
    const by: Record<string, number> = {}
    for (const r of rows) by[String(r.k)] = num(r.cnt)
    inv.functions = (by.f ?? 0) + (by.a ?? 0) + (by.w ?? 0)
    inv.procedures = by.p ?? 0
  } catch {
    const total = await scalar(
      exec,
      `SELECT count(*)::int AS cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ${ns}`,
    )
    if (total != null) inv.functions = total
  }

  // 4) 触发器(排除内部),顺带数带触发器的表
  let tablesWithTriggers: number | null = null
  try {
    const rows = await exec(
      `SELECT count(*)::int AS cnt, count(DISTINCT t.tgrelid)::int AS tbls
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${ns} AND NOT t.tgisinternal`,
    )
    inv.triggers = num(rows[0]?.cnt)
    tablesWithTriggers = num(rows[0]?.tbls)
  } catch {
    /* 触发器可选 */
  }

  // 5) 自定义类型(枚举/域/范围/独立复合类型,排除表行类型)
  const types = await scalar(
    exec,
    `SELECT count(*)::int AS cnt FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = ${ns} AND t.typtype IN ('e','d','r','c')
       AND (t.typrelid = 0 OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))`,
  )
  if (types != null) inv.types = types

  // 6) openGauss 专有:包 / 同义词(取不到留 null)
  const pkgs = await scalar(
    exec,
    `SELECT count(*)::int AS cnt FROM gs_package p JOIN pg_namespace n ON n.oid = p.pkgnamespace WHERE n.nspname = ${ns}`,
  )
  if (pkgs != null) inv.packages = pkgs
  const syn = await scalar(
    exec,
    `SELECT count(*)::int AS cnt FROM pg_synonym s JOIN pg_namespace n ON n.oid = s.synnamespace WHERE n.nspname = ${ns}`,
  )
  if (syn != null) inv.synonyms = syn

  // 7) 表行数 + 大小(reltuples 估算)
  let rowBuckets = bucketize([])
  let sizeBytes = 0
  let largestTables: TableSize[] = []
  let totalRows = 0
  try {
    const rows = await exec(
      `SELECT c.relname AS name, c.reltuples::bigint AS rows, pg_total_relation_size(c.oid) AS bytes
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${ns} AND c.relkind IN ('r','p')`,
    )
    const tables: TableSize[] = rows.map((r) => ({
      schema,
      name: String(r.name ?? ''),
      rows: Math.max(0, num(r.rows)),
      bytes: num(r.bytes),
    }))
    rowBuckets = bucketize(tables.map((t) => t.rows))
    sizeBytes = tables.reduce((a, t) => a + t.bytes, 0)
    totalRows = tables.reduce((a, t) => a + t.rows, 0)
    largestTables = [...tables].sort((a, b) => b.rows - a.rows).slice(0, 10)
  } catch (e) {
    warnings.push(`表统计失败:${e instanceof Error ? e.message : String(e)}`)
  }

  // 8) 风险指标:LOB 列 / 有注释的表
  const lobColumns = await scalar(
    exec,
    `SELECT count(*)::int AS cnt FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${ns} AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
       AND a.atttypid IN ('text'::regtype, 'bytea'::regtype, 'xml'::regtype)`,
  )
  const tablesWithComment = await scalar(
    exec,
    `SELECT count(*)::int AS cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${ns} AND c.relkind IN ('r','p') AND obj_description(c.oid, 'pg_class') IS NOT NULL`,
  )

  const tableCount = inv.tables ?? rowBuckets.total
  const tablesWithoutPk =
    inv.tables != null && inv.primaryKeys != null ? Math.max(0, inv.tables - inv.primaryKeys) : null
  const metrics: SchemaMetrics = {
    totalRows,
    tablesWithoutPk,
    lobColumns,
    tablesWithTriggers,
    tablesWithComment,
  }

  return {
    database,
    schema,
    inventory: inv,
    metrics,
    tableCount,
    rowBuckets,
    sizeBytes,
    largestTables,
    warnings,
  }
}

export const postgresProfiler: SourceProfiler = {
  dialect: DbDialect.PostgreSQL,
  listDatabases,
  listSchemas,
  profileSchema,
}
