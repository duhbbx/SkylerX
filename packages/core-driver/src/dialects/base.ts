import { DbDialect } from '@db-tool/shared-types'
import type { ConnectionConfig, TestResult } from '@db-tool/shared-types'
import type { DatabaseDriver, DriverConnection, SqlDialectHelpers } from '../driver.js'

/** MySQL / MariaDB / OceanBase 系：反引号转义 + LIMIT offset,count。 */
export const mysqlFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => '`' + name.replace(/`/g, '``') + '`',
  paginate: (sql, limit, offset) => `${stripTrailingSemicolon(sql)} LIMIT ${offset}, ${limit}`,
}

/** PostgreSQL / KingbaseES 系：双引号转义 + LIMIT count OFFSET offset。 */
export const pgFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => '"' + name.replace(/"/g, '""') + '"',
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} LIMIT ${limit} OFFSET ${offset}`,
}

/** SQL Server：方括号转义 + OFFSET ... FETCH NEXT。 */
export const sqlServerHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => '[' + name.replace(/]/g, ']]') + ']',
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
}

/** Oracle / 达梦：双引号转义 + OFFSET ... FETCH NEXT（12c+ / DM8 支持）。 */
export const oracleFamilyHelpers: SqlDialectHelpers = {
  quoteIdentifier: (name) => '"' + name.replace(/"/g, '""') + '"',
  paginate: (sql, limit, offset) =>
    `${stripTrailingSemicolon(sql)} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
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
}
