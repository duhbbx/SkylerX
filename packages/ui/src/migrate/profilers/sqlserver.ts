/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL Server 源库 profiler:sys.* + INFORMATION_SCHEMA 画像。
 * SQL Server 的 schema 在 database 内(dbo 等);profileSchema 在当前连接库内按 schema 画像。
 * 行数取 sys.dm_db_partition_stats 估算,不做精确 COUNT(*);无对应能力的对象留 null。
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

const SYS_DB = new Set(['master', 'model', 'msdb', 'tempdb'])
const SYS_SCHEMA = new Set([
  'sys',
  'information_schema',
  'guest',
  'db_owner',
  'db_accessadmin',
  'db_securityadmin',
  'db_ddladmin',
  'db_backupoperator',
  'db_datareader',
  'db_datawriter',
  'db_denydatareader',
  'db_denydatawriter',
])

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
    'SELECT DB_NAME(database_id) AS name, CAST(SUM(size) AS bigint) * 8 * 1024 AS bytes FROM sys.master_files GROUP BY database_id',
  ).catch(() => [])) {
    size.set(String(r.name ?? r.NAME ?? ''), num(r.bytes ?? r.BYTES))
  }
  const rows = await exec('SELECT name FROM sys.databases')
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
  const rows = await exec('SELECT name FROM sys.schemas ORDER BY name')
  const out: SchemaInfo[] = rows.map((r) => {
    const name = String(r.name ?? r.NAME ?? '')
    return { name, system: SYS_SCHEMA.has(name.toLowerCase()) }
  })
  return showSystem ? out : out.filter((s) => !s.system)
}

async function profileSchema(
  exec: ProfileExec,
  _database: string | undefined,
  schema: string,
): Promise<SchemaProfile> {
  const sc = lit(schema)
  const warnings: string[] = []
  const inv: ObjectInventory = {}

  // sys.objects 一把梭(U/V/P/FN/IF/TF/TR/PK/UQ/F/C)
  let pkCount = 0
  try {
    for (const r of await exec(
      `SELECT o.type AS t, count(*) AS cnt FROM sys.objects o
       JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = ${sc} GROUP BY o.type`,
    )) {
      const t = String(r.t ?? r.T ?? '')
        .trim()
        .toUpperCase()
      const cnt = num(r.cnt ?? r.CNT)
      if (t === 'U') inv.tables = cnt
      else if (t === 'V') inv.views = cnt
      else if (t === 'P') inv.procedures = cnt
      else if (['FN', 'IF', 'TF', 'AF'].includes(t)) inv.functions = (inv.functions ?? 0) + cnt
      else if (t === 'TR') inv.triggers = cnt
      else if (t === 'PK') {
        inv.primaryKeys = cnt
        pkCount = cnt
      } else if (t === 'UQ') inv.uniqueConstraints = cnt
      else if (t === 'F') inv.foreignKeys = cnt
      else if (t === 'C') inv.checkConstraints = cnt
    }
  } catch (e) {
    warnings.push(`对象盘点失败:${e instanceof Error ? e.message : String(e)}`)
  }

  // 索引(排除堆、主键、唯一约束背后的)
  const idx = await scalar(
    exec,
    `SELECT count(*) AS cnt FROM sys.indexes i
     JOIN sys.objects o ON o.object_id = i.object_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id
     WHERE s.name = ${sc} AND o.type = 'U' AND i.type > 0 AND i.is_primary_key = 0 AND i.is_unique_constraint = 0`,
  )
  if (idx != null) inv.indexes = idx

  // 行数 + 大小
  let rowBuckets = bucketize([])
  let sizeBytes = 0
  let totalRows = 0
  let largestTables: TableSize[] = []
  try {
    const rows = await exec(
      `SELECT o.name AS name,
              SUM(CASE WHEN ps.index_id IN (0,1) THEN ps.row_count ELSE 0 END) AS rows,
              SUM(ps.used_page_count) * 8 * 1024 AS bytes
       FROM sys.objects o
       JOIN sys.schemas s ON s.schema_id = o.schema_id
       JOIN sys.dm_db_partition_stats ps ON ps.object_id = o.object_id
       WHERE s.name = ${sc} AND o.type = 'U'
       GROUP BY o.name`,
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
    warnings.push(
      `表统计失败(可能缺少 VIEW DATABASE STATE 权限):${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const lobColumns = await scalar(
    exec,
    `SELECT count(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ${sc} AND (DATA_TYPE IN ('text','ntext','image','xml')
       OR (DATA_TYPE IN ('varchar','nvarchar','varbinary') AND CHARACTER_MAXIMUM_LENGTH = -1))`,
  )
  const tablesWithTriggers = await scalar(
    exec,
    `SELECT count(DISTINCT t.parent_id) AS cnt FROM sys.triggers t
     JOIN sys.objects o ON o.object_id = t.parent_id
     JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = ${sc}`,
  )

  const tableCount = inv.tables ?? rowBuckets.total
  const metrics: SchemaMetrics = {
    totalRows,
    tablesWithoutPk: inv.tables != null ? Math.max(0, inv.tables - pkCount) : null,
    lobColumns,
    tablesWithTriggers,
    tablesWithComment: null, // SQL Server 注释走扩展属性,本版不取
  }

  return {
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

export const sqlServerProfiler: SourceProfiler = {
  dialect: DbDialect.SqlServer,
  listDatabases,
  listSchemas,
  profileSchema,
}
