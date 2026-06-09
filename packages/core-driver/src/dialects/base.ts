/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConnectionConfig, TestResult } from '@db-tool/shared-types'
import type { DatabaseDriver, DriverConnection, SqlDialectHelpers } from '../driver.js'

/** MySQL / MariaDB / OceanBase 系：反引号转义 + LIMIT offset,count。 */
export const mysqlFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `\`${name.replace(/`/g, '``')}\``,
  paginate: (sql, limit, offset) => `${stripTrailingSemicolon(sql)} LIMIT ${offset}, ${limit}`,
}

/** PostgreSQL / KingbaseES 系：双引号转义 + LIMIT count OFFSET offset。 */
export const pgFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} LIMIT ${limit} OFFSET ${offset}`,
}

/** SQL Server：方括号转义 + OFFSET ... FETCH NEXT。 */
export const sqlServerHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `[${name.replace(/]/g, ']]')}]`,
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
}

/** Oracle / 达梦：双引号转义 + OFFSET ... FETCH NEXT（12c+ / DM8 支持）。 */
export const oracleFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => `"${name.replace(/"/g, '""')}"`,
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}

// ── 64 位整数精度保护（各驱动通用）──────────────────────────────────────────
// JS Number 只有 53bit 安全整数,18 位雪花 ID / 大 BIGINT 直接读成 number 会被截尾
// (如 1994357773448507394 → …400)。各驱动把可能超界的值改成字符串返回,并给列标
// lossy='bigint';UI 据此提示并按字符串显示/排序。

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

/** bigint 值归一:安全范围内仍给 number(行为不变),超界才转字符串保精度。其它原样返回。 */
export function normalizeBigInt(v: unknown): unknown {
  if (typeof v === 'bigint') return v <= MAX_SAFE && v >= MIN_SAFE ? Number(v) : v.toString()
  return v
}

/**
 * 由列元数据(dbTypeName + precision + scale)判断该数值列是否可能超出 JS 安全整数:
 *  - BIGINT / INT8:恒判为是(64 位整数)。
 *  - NUMBER / DECIMAL / NUMERIC:整数(scale<=0)且精度未指定(=最大)或 >15 位。
 * Oracle / 达梦 等把这类列改成字符串 fetch,并据此标 lossy。
 */
export function numberMetaIsLossy(dbTypeName: unknown, precision?: unknown, scale?: unknown): boolean {
  const t = String(dbTypeName ?? '').toUpperCase()
  if (t.includes('BIGINT') || t.includes('INT8')) return true
  if (t.includes('NUMBER') || t.includes('DECIMAL') || t.includes('NUMERIC')) {
    const s = Number(scale ?? 0)
    const p = Number(precision ?? 0)
    return s <= 0 && (p === 0 || p > 15)
  }
  return false
}

/**
 * 占位驱动：注册但未实现底层连接。
 *
 * 一期先用它让注册中心/通道链路跑通；真正接入某方言时，
 * 用基于 mysql2 / pg / oracledb 等的实现替换之即可（接口不变）。
 */
export function defineStubDriver(
  dialect: DbDialect,
  helpers: SqlDialectHelpers,
  driverPackage: string,
): DatabaseDriver {
  const notImplemented = (): never => {
    throw new Error(
      `方言 "${dialect}" 的驱动尚未实现。请安装 ${driverPackage} 并在 dialects/${dialect}.ts 中实现 DatabaseDriver。`,
    )
  }
  return {
    dialect,
    sql: helpers,
    async connect(_config: ConnectionConfig): Promise<DriverConnection> {
      return notImplemented()
    },
    async test(_config: ConnectionConfig): Promise<TestResult> {
      return {
        ok: false,
        message: `方言 "${dialect}" 驱动未实现（需 ${driverPackage}）。`,
      }
    },
  }
}

/** 方言 → 推荐 npm 驱动包，供占位与文档使用。 */
export const DRIVER_PACKAGES: Record<DbDialect, string> = {
  [DbDialect.MySQL]: 'mysql2',
  [DbDialect.MariaDB]: 'mysql2',
  [DbDialect.OceanBase]: 'mysql2',
  [DbDialect.PostgreSQL]: 'pg',
  [DbDialect.KingbaseES]: 'pg',
  [DbDialect.Oracle]: 'oracledb',
  [DbDialect.DM]: 'dmdb',
  [DbDialect.SqlServer]: 'mssql',
  [DbDialect.TiDB]: 'mysql2',
  [DbDialect.CockroachDB]: 'pg',
  [DbDialect.Greenplum]: 'pg',
  [DbDialect.OpenGauss]: 'pg',
  [DbDialect.Vastbase]: 'pg',
  [DbDialect.MogDB]: 'pg',
  [DbDialect.Panweidb]: 'pg',
  [DbDialect.HighGo]: 'pg',
  [DbDialect.GBase8a]: 'mysql2',
  [DbDialect.SQLite]: 'better-sqlite3',
  [DbDialect.DuckDB]: '@duckdb/node-api',
  [DbDialect.ClickHouse]: '@clickhouse/client',
  [DbDialect.Snowflake]: 'snowflake-sdk',
  [DbDialect.H2]: 'pg',
  [DbDialect.Doris]: 'mysql2',
  [DbDialect.StarRocks]: 'mysql2',
  [DbDialect.Redshift]: 'pg',
  [DbDialect.TDengine]: '@tdengine/websocket',
  [DbDialect.MongoDB]: 'mongodb',
  [DbDialect.Redis]: 'ioredis',
  [DbDialect.Elasticsearch]: '@elastic/elasticsearch',
  // Wire-compat aliases — same driver package as their base family.
  [DbDialect.PolarDBPG]: 'pg',
  [DbDialect.PolarDBX]: 'mysql2',
  [DbDialect.GaussDB]: 'pg',
  [DbDialect.TimescaleDB]: 'pg',
  [DbDialect.QuestDB]: 'pg',
  [DbDialect.Materialize]: 'pg',
  [DbDialect.RisingWave]: 'pg',
  [DbDialect.Hologres]: 'pg',
  [DbDialect.GreatSQL]: 'mysql2',
  [DbDialect.TDSQLC]: 'mysql2',
}
