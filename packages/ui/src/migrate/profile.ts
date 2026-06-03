/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 源库画像(profiling)抽象层。
 *
 * hub-and-spoke:定义 {@link SourceProfiler} 接口,每个源库家族各自实现 catalog 查询。
 * 画像内容:database / schema 清单(过滤系统)、**全量对象盘点**(表/视图/物化视图/索引/
 * 主键/外键/唯一约束/检查约束/序列/函数/存储过程/包/触发器/类型/同义词/分区表/DBLink…
 * 库不支持的留空=null)、行数分桶(≥100万/1000万/1亿)、表空间大小,以及迁移风险指标
 * (无主键表数、LOB 列数、带触发器表数、注释覆盖)。给源库做精准评估、可导出文档。
 *
 * profiler 不直连库,吃注入的 {@link ProfileExec}(包 client.connections.execute),
 * 既复用现有查询管线,又能 mock 单测。库不支持/无权限的项 → 留 undefined,UI 显示为 0/—。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'

/** 执行一条只读 SQL,返回行数组。包 client.connections.execute(connId, sql).then(r=>r.rows)。 */
export type ProfileExec = (sql: string) => Promise<Array<Record<string, unknown>>>

// ── 对象盘点:固定类目(顺序即展示顺序),库不支持的留 undefined=null ──
export const OBJECT_CATEGORIES = [
  'tables',
  'views',
  'materializedViews',
  'partitionedTables',
  'indexes',
  'primaryKeys',
  'foreignKeys',
  'uniqueConstraints',
  'checkConstraints',
  'sequences',
  'functions',
  'procedures',
  'packages',
  'triggers',
  'types',
  'synonyms',
  'dbLinks',
] as const
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number]

/** 类目的中英文标签(给 UI / 导出文档)。 */
export const CATEGORY_LABEL: Record<ObjectCategory, [zh: string, en: string]> = {
  tables: ['表', 'Tables'],
  views: ['视图', 'Views'],
  materializedViews: ['物化视图', 'Materialized views'],
  partitionedTables: ['分区表', 'Partitioned tables'],
  indexes: ['索引', 'Indexes'],
  primaryKeys: ['主键', 'Primary keys'],
  foreignKeys: ['外键', 'Foreign keys'],
  uniqueConstraints: ['唯一约束', 'Unique constraints'],
  checkConstraints: ['检查约束', 'Check constraints'],
  sequences: ['序列', 'Sequences'],
  functions: ['函数', 'Functions'],
  procedures: ['存储过程', 'Procedures'],
  packages: ['包', 'Packages'],
  triggers: ['触发器', 'Triggers'],
  types: ['自定义类型', 'Types'],
  synonyms: ['同义词', 'Synonyms'],
  dbLinks: ['数据库链接', 'DB links'],
}

/** 对象盘点:类目 → 数量;缺失键表示该库不支持/未取到(渲染为 null/—)。 */
export type ObjectInventory = Partial<Record<ObjectCategory, number>>

/** 迁移风险 / 质量指标(库不支持的留 null)。 */
export interface SchemaMetrics {
  /** schema 内表估算总行数。 */
  totalRows: number
  /** 无主键的表数(迁移 / 同步高风险)。 */
  tablesWithoutPk?: number | null
  /** LOB 大对象列数(CLOB/BLOB/text/bytea —— 迁移耗时大头)。 */
  lobColumns?: number | null
  /** 带触发器的表数。 */
  tablesWithTriggers?: number | null
  /** 有注释的表数(文档质量)。 */
  tablesWithComment?: number | null
}

export interface DatabaseInfo {
  name: string
  system: boolean
  sizeBytes?: number
}

export interface SchemaInfo {
  database?: string
  name: string
  system: boolean
}

/** 按行数分桶的表数量(估算值,基于 catalog 统计,非精确 COUNT(*))。 */
export interface RowBuckets {
  total: number
  over1M: number
  over10M: number
  over100M: number
}

export interface TableSize {
  schema: string
  name: string
  rows: number
  bytes: number
}

/** 单个 schema 的画像。 */
export interface SchemaProfile {
  database?: string
  schema: string
  inventory: ObjectInventory
  metrics: SchemaMetrics
  tableCount: number
  rowBuckets: RowBuckets
  sizeBytes: number
  largestTables: TableSize[]
  warnings: string[]
}

/** 整库画像汇总。 */
export interface SourceProfile {
  dialect: DbDialect
  databases: DatabaseInfo[]
  schemas: SchemaInfo[]
  schemaProfiles: SchemaProfile[]
  totals: {
    schemas: number
    tables: number
    objects: number
    sizeBytes: number
    rowBuckets: RowBuckets
    inventory: ObjectInventory
    metrics: SchemaMetrics
  }
}

/** 源库 profiler 接口:每个源方言家族实现一份。 */
export interface SourceProfiler {
  dialect: DbDialect
  listDatabases(exec: ProfileExec, showSystem?: boolean): Promise<DatabaseInfo[]>
  listSchemas(
    exec: ProfileExec,
    database: string | undefined,
    showSystem?: boolean,
  ): Promise<SchemaInfo[]>
  profileSchema(
    exec: ProfileExec,
    database: string | undefined,
    schema: string,
  ): Promise<SchemaProfile>
}

// ── 工具 ────────────────────────────────────────────────────────
export const T_1M = 1_000_000
export const T_10M = 10_000_000
export const T_100M = 100_000_000

export function bucketize(rowsList: number[]): RowBuckets {
  const b: RowBuckets = { total: rowsList.length, over1M: 0, over10M: 0, over100M: 0 }
  for (const r of rowsList) {
    if (r >= T_100M) b.over100M++
    if (r >= T_10M) b.over10M++
    if (r >= T_1M) b.over1M++
  }
  return b
}

/** SQL 单引号字面量转义。 */
export function lit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 盘点总数(忽略 null)。 */
export function inventoryTotal(inv: ObjectInventory): number {
  let s = 0
  for (const k of OBJECT_CATEGORIES) s += inv[k] ?? 0
  return s
}

// ── 注册表(按 family)+ 编排 ──────────────────────────────────────
import { mysqlProfiler } from './profilers/mysql'
import { oracleProfiler } from './profilers/oracle'
import { postgresProfiler } from './profilers/postgres'
import { sqlServerProfiler } from './profilers/sqlserver'

const PROFILERS: Partial<Record<ReturnType<typeof familyOf>, SourceProfiler>> = {
  oracle: oracleProfiler, // Oracle / DM
  pg: postgresProfiler, // openGauss / Vastbase / PostgreSQL …
  mysql: mysqlProfiler, // MySQL / OceanBase / TiDB / GBase …
  sqlserver: sqlServerProfiler, // SQL Server
}

export function profilerFor(dialect: DbDialect): SourceProfiler | null {
  return PROFILERS[familyOf(dialect)] ?? null
}

export function canProfile(dialect: DbDialect): boolean {
  return !!profilerFor(dialect)
}

function mergeBuckets(list: RowBuckets[]): RowBuckets {
  return list.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      over1M: acc.over1M + b.over1M,
      over10M: acc.over10M + b.over10M,
      over100M: acc.over100M + b.over100M,
    }),
    { total: 0, over1M: 0, over10M: 0, over100M: 0 },
  )
}

/** 跨 schema 合并盘点(任一 schema 支持某类目即累加;全 null 则保持 null)。 */
function mergeInventory(list: ObjectInventory[]): ObjectInventory {
  const out: ObjectInventory = {}
  for (const cat of OBJECT_CATEGORIES) {
    let sum: number | undefined
    for (const inv of list) {
      const v = inv[cat]
      if (v != null) sum = (sum ?? 0) + v
    }
    if (sum != null) out[cat] = sum
  }
  return out
}

/** 合并风险指标(null 视为不可用;只要有一个可用就累加)。 */
function mergeMetrics(list: SchemaMetrics[]): SchemaMetrics {
  const add = (k: keyof SchemaMetrics): number | null => {
    let sum: number | null = null
    for (const m of list) {
      const v = m[k]
      if (v != null) sum = (sum ?? 0) + v
    }
    return sum
  }
  return {
    totalRows: list.reduce((a, m) => a + (m.totalRows ?? 0), 0),
    tablesWithoutPk: add('tablesWithoutPk'),
    lobColumns: add('lobColumns'),
    tablesWithTriggers: add('tablesWithTriggers'),
    tablesWithComment: add('tablesWithComment'),
  }
}

/**
 * 画像编排:对所选 schema 逐个 profileSchema,再汇总。
 * sel.schemas 为空则只返回 databases/schemas 清单(不深度画像)。
 */
export async function profileSource(
  exec: ProfileExec,
  dialect: DbDialect,
  sel: { database?: string; schemas: string[] },
): Promise<SourceProfile> {
  const profiler = profilerFor(dialect)
  const emptyTotals = {
    schemas: 0,
    tables: 0,
    objects: 0,
    sizeBytes: 0,
    rowBuckets: bucketize([]),
    inventory: {} as ObjectInventory,
    metrics: { totalRows: 0 } as SchemaMetrics,
  }
  if (!profiler) {
    return { dialect, databases: [], schemas: [], schemaProfiles: [], totals: emptyTotals }
  }
  const databases = await profiler.listDatabases(exec).catch(() => [])
  const schemas = await profiler.listSchemas(exec, sel.database).catch(() => [])

  const schemaProfiles: SchemaProfile[] = []
  for (const s of sel.schemas) {
    schemaProfiles.push(await profiler.profileSchema(exec, sel.database, s))
  }

  const inventory = mergeInventory(schemaProfiles.map((p) => p.inventory))
  const totals = {
    schemas: schemaProfiles.length,
    tables: schemaProfiles.reduce((a, p) => a + p.tableCount, 0),
    objects: inventoryTotal(inventory),
    sizeBytes: schemaProfiles.reduce((a, p) => a + p.sizeBytes, 0),
    rowBuckets: mergeBuckets(schemaProfiles.map((p) => p.rowBuckets)),
    inventory,
    metrics: mergeMetrics(schemaProfiles.map((p) => p.metrics)),
  }

  return { dialect, databases, schemas, schemaProfiles, totals }
}
