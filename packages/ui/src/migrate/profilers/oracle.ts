/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Oracle / DM 源库 profiler:基于数据字典视图(all_ 与 dba_ 系列)的全量对象盘点 + 风险指标。
 * 行数取 all_tables.num_rows(依赖统计信息收集,非精确 COUNT(*));
 * 大小取 dba_segments,无 DBA 权限时降级(bytes=0 + warning)。
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

/** Oracle 内置/维护账户(旧版无 oracle_maintained 列时兜底过滤)。 */
const ORA_SYS = new Set([
  'SYS',
  'SYSTEM',
  'SYSAUX',
  'OUTLN',
  'XDB',
  'XS$NULL',
  'CTXSYS',
  'MDSYS',
  'OLAPSYS',
  'ORDSYS',
  'ORDDATA',
  'ORDPLUGINS',
  'SI_INFORMTN_SCHEMA',
  'DBSNMP',
  'APPQOSSYS',
  'GSMADMIN_INTERNAL',
  'WMSYS',
  'LBACSYS',
  'DVSYS',
  'DVF',
  'AUDSYS',
  'REMOTE_SCHEDULER_AGENT',
  'DGPDB_INT',
  'SYSBACKUP',
  'SYSDG',
  'SYSKM',
  'SYSRAC',
  'OJVMSYS',
  'ANONYMOUS',
  'GGSYS',
  'DIP',
  'FLOWS_FILES',
  'MDDATA',
  'ORACLE_OCM',
  'SPATIAL_CSW_ADMIN_USR',
  'SPATIAL_WFS_ADMIN_USR',
  'APEX_PUBLIC_USER',
])

/** all_objects.object_type → 盘点类目。 */
const OBJ_MAP: Record<string, keyof ObjectInventory> = {
  TABLE: 'tables',
  VIEW: 'views',
  'MATERIALIZED VIEW': 'materializedViews',
  INDEX: 'indexes',
  SEQUENCE: 'sequences',
  PROCEDURE: 'procedures',
  FUNCTION: 'functions',
  PACKAGE: 'packages',
  TRIGGER: 'triggers',
  TYPE: 'types',
  SYNONYM: 'synonyms',
  'DATABASE LINK': 'dbLinks',
}

async function listDatabases(exec: ProfileExec): Promise<DatabaseInfo[]> {
  try {
    const rows = await exec(`SELECT name FROM v$pdbs ORDER BY name`)
    if (rows.length) {
      return rows.map((r) => {
        const name = String(r.NAME ?? r.name ?? '')
        return { name, system: name.toUpperCase() === 'PDB$SEED' }
      })
    }
  } catch {
    /* 非 CDB / 无权限 */
  }
  try {
    const rows = await exec(`SELECT ora_database_name AS name FROM dual`)
    return [{ name: String(rows[0]?.NAME ?? rows[0]?.name ?? 'ORACLE'), system: false }]
  } catch {
    return [{ name: 'ORACLE', system: false }]
  }
}

async function listSchemas(
  exec: ProfileExec,
  _database: string | undefined,
  showSystem = false,
): Promise<SchemaInfo[]> {
  let rows: Array<Record<string, unknown>>
  let hasOm = true
  try {
    rows = await exec(
      `SELECT username AS name, oracle_maintained AS om FROM all_users ORDER BY username`,
    )
  } catch {
    hasOm = false
    rows = await exec(`SELECT username AS name FROM all_users ORDER BY username`)
  }
  const out: SchemaInfo[] = rows.map((r) => {
    const name = String(r.NAME ?? r.name ?? '')
    const om = String(r.OM ?? r.om ?? '')
    const system = hasOm ? om.toUpperCase() === 'Y' : ORA_SYS.has(name.toUpperCase())
    return { name, system }
  })
  return showSystem ? out : out.filter((s) => !s.system)
}

/** 标量聚合;失败返回 null。 */
async function scalar(exec: ProfileExec, sql: string): Promise<number | null> {
  try {
    const rows = await exec(sql)
    if (!rows.length) return 0
    const row = rows[0]
    return num(row.CNT ?? row.cnt)
  } catch {
    return null
  }
}

async function profileSchema(
  exec: ProfileExec,
  database: string | undefined,
  schema: string,
): Promise<SchemaProfile> {
  const owner = lit(schema)
  const warnings: string[] = []
  const inv: ObjectInventory = {}

  // 1) all_objects 一把梭
  try {
    const rows = await exec(
      `SELECT object_type AS type, COUNT(*) AS cnt FROM all_objects WHERE owner = ${owner} GROUP BY object_type`,
    )
    for (const r of rows) {
      const t = String(r.TYPE ?? r.type ?? '').toUpperCase()
      const key = OBJ_MAP[t]
      if (key) inv[key] = (inv[key] ?? 0) + num(r.CNT ?? r.cnt)
    }
  } catch (e) {
    warnings.push(`对象盘点失败:${e instanceof Error ? e.message : String(e)}`)
  }

  // 2) 约束:主键/外键/唯一/检查(C 含系统 NOT NULL,略偏高)
  try {
    const rows = await exec(
      `SELECT constraint_type AS t, COUNT(*) AS cnt FROM all_constraints WHERE owner = ${owner} GROUP BY constraint_type`,
    )
    const by: Record<string, number> = {}
    for (const r of rows) by[String(r.T ?? r.t ?? '').toUpperCase()] = num(r.CNT ?? r.cnt)
    inv.primaryKeys = by.P ?? 0
    inv.foreignKeys = by.R ?? 0
    inv.uniqueConstraints = by.U ?? 0
    inv.checkConstraints = by.C ?? 0
  } catch {
    /* 约束盘点可选 */
  }

  // 3) 分区表
  const partitioned = await scalar(
    exec,
    `SELECT COUNT(*) AS cnt FROM all_tables WHERE owner = ${owner} AND partitioned = 'YES'`,
  )
  if (partitioned != null) inv.partitionedTables = partitioned

  // 4) 表大小(dba_segments;无权限降级)
  const sizeByTable = new Map<string, number>()
  try {
    const rows = await exec(
      `SELECT segment_name AS name, SUM(bytes) AS bytes FROM dba_segments
       WHERE owner = ${owner} AND segment_type IN ('TABLE','TABLE PARTITION') GROUP BY segment_name`,
    )
    for (const r of rows) sizeByTable.set(String(r.NAME ?? r.name ?? ''), num(r.BYTES ?? r.bytes))
  } catch {
    warnings.push('无法读取 dba_segments(可能缺少 DBA 权限),表空间大小按 0 计;建议用 DBA 账户复评')
  }

  // 5) 表行数(num_rows 估算)
  let rowBuckets = bucketize([])
  let largestTables: TableSize[] = []
  let sizeBytes = 0
  let totalRows = 0
  try {
    const rows = await exec(
      `SELECT table_name AS name, num_rows AS rows FROM all_tables WHERE owner = ${owner}`,
    )
    const tables: TableSize[] = rows.map((r) => {
      const name = String(r.NAME ?? r.name ?? '')
      return {
        schema,
        name,
        rows: Math.max(0, num(r.ROWS ?? r.rows)),
        bytes: sizeByTable.get(name) ?? 0,
      }
    })
    rowBuckets = bucketize(tables.map((t) => t.rows))
    sizeBytes = tables.reduce((a, t) => a + t.bytes, 0)
    totalRows = tables.reduce((a, t) => a + t.rows, 0)
    largestTables = [...tables].sort((a, b) => b.rows - a.rows).slice(0, 10)
    if (tables.some((t) => t.rows === 0)) {
      warnings.push('部分表 num_rows 为空/0,可能未收集统计信息;必要时先 GATHER_SCHEMA_STATS 再复评')
    }
  } catch (e) {
    warnings.push(`表统计失败:${e instanceof Error ? e.message : String(e)}`)
  }

  // 6) 风险指标
  const tablesWithPk = await scalar(
    exec,
    `SELECT COUNT(DISTINCT table_name) AS cnt FROM all_constraints WHERE owner = ${owner} AND constraint_type = 'P'`,
  )
  const lobColumns = await scalar(
    exec,
    `SELECT COUNT(*) AS cnt FROM all_tab_columns WHERE owner = ${owner}
       AND data_type IN ('CLOB','NCLOB','BLOB','BFILE','LONG','LONG RAW')`,
  )
  const tablesWithTriggers = await scalar(
    exec,
    `SELECT COUNT(DISTINCT table_name) AS cnt FROM all_triggers WHERE table_owner = ${owner} AND base_object_type = 'TABLE'`,
  )
  const tablesWithComment = await scalar(
    exec,
    `SELECT COUNT(*) AS cnt FROM all_tab_comments WHERE owner = ${owner} AND comments IS NOT NULL`,
  )

  const tableCount = inv.tables ?? rowBuckets.total
  const tablesWithoutPk =
    inv.tables != null && tablesWithPk != null ? Math.max(0, inv.tables - tablesWithPk) : null
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

export const oracleProfiler: SourceProfiler = {
  dialect: DbDialect.Oracle,
  listDatabases,
  listSchemas,
  profileSchema,
}
