/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MySQL 系源库 profiler:MySQL / OceanBase / TiDB / GBase 等的 information_schema 画像。
 * MySQL 的「schema 即 database」,所以 listSchemas 返回各 database;profileSchema 按 db 画像。
 * 行数取 information_schema.TABLES.TABLE_ROWS 估算值,不做精确 COUNT(*)。
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

const SYS_DB = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])

async function scalar(exec: ProfileExec, sql: string, col = 'cnt'): Promise<number | null> {
  try {
    const rows = await exec(sql)
    if (!rows.length) return 0
    return num(rows[0][col] ?? rows[0][col.toUpperCase()])
  } catch {
    return null
  }
}

async function listDatabases(exec: ProfileExec): Promise<DatabaseInfo[]> {
  const size = new Map<string, number>()
  for (const r of await exec(
    `SELECT TABLE_SCHEMA AS name, SUM(DATA_LENGTH + INDEX_LENGTH) AS bytes
     FROM information_schema.TABLES GROUP BY TABLE_SCHEMA`,
  ).catch(() => [])) {
    size.set(String(r.name ?? r.NAME ?? ''), num(r.bytes ?? r.BYTES))
  }
  const rows = await exec(`SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA`)
  return rows.map((r) => {
    const name = String(r.name ?? r.NAME ?? '')
    return { name, system: SYS_DB.has(name.toLowerCase()), sizeBytes: size.get(name) }
  })
}

async function listSchemas(
  exec: ProfileExec,
  _database: string | undefined,
  showSystem = false,
): Promise<SchemaInfo[]> {
  // schema 即 database
  const rows = await exec(
    `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`,
  )
  const out: SchemaInfo[] = rows.map((r) => {
    const name = String(r.name ?? r.NAME ?? '')
    return { name, system: SYS_DB.has(name.toLowerCase()) }
  })
  return showSystem ? out : out.filter((s) => !s.system)
}

async function profileSchema(
  exec: ProfileExec,
  _database: string | undefined,
  schema: string,
): Promise<SchemaProfile> {
  const db = lit(schema)
  const warnings: string[] = []
  const inv: ObjectInventory = {}

  // 表/视图
  try {
    for (const r of await exec(
      `SELECT TABLE_TYPE AS t, count(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${db} GROUP BY TABLE_TYPE`,
    )) {
      const t = String(r.t ?? r.T ?? '').toUpperCase()
      if (t === 'BASE TABLE') inv.tables = num(r.cnt ?? r.CNT)
      else if (t === 'VIEW') inv.views = num(r.cnt ?? r.CNT)
    }
  } catch (e) {
    warnings.push(`对象盘点失败:${e instanceof Error ? e.message : String(e)}`)
  }
  // 存储过程 / 函数
  try {
    for (const r of await exec(
      `SELECT ROUTINE_TYPE AS t, count(*) AS cnt FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${db} GROUP BY ROUTINE_TYPE`,
    )) {
      const t = String(r.t ?? r.T ?? '').toUpperCase()
      if (t === 'PROCEDURE') inv.procedures = num(r.cnt ?? r.CNT)
      else if (t === 'FUNCTION') inv.functions = num(r.cnt ?? r.CNT)
    }
  } catch {
    /* 可选 */
  }
  // 约束
  let pkTables = 0
  try {
    for (const r of await exec(
      `SELECT CONSTRAINT_TYPE AS t, count(*) AS cnt FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ${db} GROUP BY CONSTRAINT_TYPE`,
    )) {
      const t = String(r.t ?? r.T ?? '').toUpperCase()
      const cnt = num(r.cnt ?? r.CNT)
      if (t === 'PRIMARY KEY') {
        inv.primaryKeys = cnt
        pkTables = cnt
      } else if (t === 'UNIQUE') inv.uniqueConstraints = cnt
      else if (t === 'FOREIGN KEY') inv.foreignKeys = cnt
      else if (t === 'CHECK') inv.checkConstraints = cnt
    }
  } catch {
    /* 可选 */
  }
  // 触发器
  let tablesWithTriggers: number | null = null
  try {
    const rows = await exec(
      `SELECT count(*) AS cnt, count(DISTINCT EVENT_OBJECT_TABLE) AS tbls FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ${db}`,
    )
    inv.triggers = num(rows[0]?.cnt ?? rows[0]?.CNT)
    tablesWithTriggers = num(rows[0]?.tbls ?? rows[0]?.TBLS)
  } catch {
    /* 可选 */
  }
  // 索引(非 PRIMARY)
  const idx = await scalar(
    exec,
    `SELECT count(*) AS cnt FROM (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${db} AND INDEX_NAME <> 'PRIMARY' GROUP BY TABLE_NAME, INDEX_NAME) x`,
  )
  if (idx != null) inv.indexes = idx
  // 分区表
  const part = await scalar(
    exec,
    `SELECT count(DISTINCT TABLE_NAME) AS cnt FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = ${db} AND PARTITION_NAME IS NOT NULL`,
  )
  if (part != null) inv.partitionedTables = part

  // 行数 + 大小
  let rowBuckets = bucketize([])
  let sizeBytes = 0
  let totalRows = 0
  let largestTables: TableSize[] = []
  try {
    const rows = await exec(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS rows, (DATA_LENGTH + INDEX_LENGTH) AS bytes
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${db} AND TABLE_TYPE = 'BASE TABLE'`,
    )
    const tables: TableSize[] = rows.map((r) => ({
      schema,
      name: String(r.name ?? r.NAME ?? ''),
      rows: Math.max(0, num(r.rows ?? r.ROWS)),
      bytes: num(r.bytes ?? r.BYTES),
    }))
    rowBuckets = bucketize(tables.map((t) => t.rows))
    sizeBytes = tables.reduce((a, t) => a + t.bytes, 0)
    totalRows = tables.reduce((a, t) => a + t.rows, 0)
    largestTables = [...tables].sort((a, b) => b.rows - a.rows).slice(0, 10)
  } catch (e) {
    warnings.push(`表统计失败:${e instanceof Error ? e.message : String(e)}`)
  }

  const lobColumns = await scalar(
    exec,
    `SELECT count(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${db}
       AND DATA_TYPE IN ('text','tinytext','mediumtext','longtext','blob','tinyblob','mediumblob','longblob','json')`,
  )
  const tablesWithComment = await scalar(
    exec,
    `SELECT count(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${db} AND TABLE_TYPE = 'BASE TABLE' AND TABLE_COMMENT <> ''`,
  )

  const tableCount = inv.tables ?? rowBuckets.total
  const metrics: SchemaMetrics = {
    totalRows,
    tablesWithoutPk: inv.tables != null ? Math.max(0, inv.tables - pkTables) : null,
    lobColumns,
    tablesWithTriggers,
    tablesWithComment,
  }

  return {
    database: schema,
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

export const mysqlProfiler: SourceProfiler = {
  dialect: DbDialect.MySQL,
  listDatabases,
  listSchemas,
  profileSchema,
}
