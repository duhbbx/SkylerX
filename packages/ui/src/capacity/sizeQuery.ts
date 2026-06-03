/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 存储容量趋势 —— 取「当前库总大小」的方言 SQL。
 * 拿到的是单个数(字节),用于按时间打快照、画增长曲线、做预测。
 */
import { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'

const NOSQL = new Set<DbDialect>([DbDialect.MongoDB, DbDialect.Redis, DbDialect.Elasticsearch])

/** 当前连接库的总大小查询(返回一行,列名 bytes)。 */
export function dbSizeQuery(dialect: DbDialect): string {
  switch (familyOf(dialect)) {
    case 'pg':
      return 'SELECT pg_database_size(current_database())::bigint AS bytes'
    case 'mysql':
      return `SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS bytes
              FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
    case 'oracle':
      // user_segments 不需 DBA 权限,统计当前用户自己的段
      return 'SELECT COALESCE(SUM(bytes), 0) AS bytes FROM user_segments'
    case 'sqlserver':
      return 'SELECT COALESCE(SUM(CAST(size AS bigint)), 0) * 8 * 1024 AS bytes FROM sys.database_files'
    default:
      return 'SELECT 0 AS bytes'
  }
}

/** 解析容量查询结果为字节数。 */
export function parseSize(row: Record<string, unknown> | undefined): number {
  if (!row) return 0
  const v = row.bytes ?? row.BYTES ?? Object.values(row)[0]
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 该方言是否能取容量(SQL 库;NoSQL 排除)。 */
export function canMeasureSize(dialect: DbDialect): boolean {
  return !NOSQL.has(dialect) && ['pg', 'mysql', 'oracle', 'sqlserver'].includes(familyOf(dialect))
}
