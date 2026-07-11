/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 数据库方言 -> 品牌 PNG 图标。
 *
 * 视图组件: components/DialectIcon.vue 渲染固定尺寸图片，调用方传 dialect + size。
 * 没有单独 PNG 的 wire-compatible 方言复用同一协议家族中最接近的图标。
 */

import { DbDialect } from '@db-tool/shared-types'

export interface DialectIcon {
  /** PNG asset URL. Undefined means render the generic fallback. */
  src?: string
  /** 显示名（界面 fallback / tooltip 用） */
  label: string
  /** Fallback 背景色；有 PNG 时仅用于调试/后续扩展。 */
  color: string
  /** Fallback 中显示的短文本。 */
  initials?: string
}

const png = {
  clickhouse: new URL('./assets/dialects/clickhouse.png', import.meta.url).href,
  cockroach: new URL('./assets/dialects/cockroach.png', import.meta.url).href,
  dameng: new URL('./assets/dialects/dameng.png', import.meta.url).href,
  doris: new URL('./assets/dialects/doris.png', import.meta.url).href,
  duckdb: new URL('./assets/dialects/duckdb.png', import.meta.url).href,
  elastic: new URL('./assets/dialects/elastic.png', import.meta.url).href,
  greenplum: new URL('./assets/dialects/greenplum.png', import.meta.url).href,
  h2: new URL('./assets/dialects/h2.png', import.meta.url).href,
  kingbase: new URL('./assets/dialects/kingbase.png', import.meta.url).href,
  mariadb: new URL('./assets/dialects/mariadb.png', import.meta.url).href,
  mongo: new URL('./assets/dialects/mongo.png', import.meta.url).href,
  mysql: new URL('./assets/dialects/mysql.png', import.meta.url).href,
  oceanbase: new URL('./assets/dialects/oceanbase.png', import.meta.url).href,
  opengauss: new URL('./assets/dialects/opengauss.png', import.meta.url).href,
  oracle: new URL('./assets/dialects/oracle.png', import.meta.url).href,
  postgresql: new URL('./assets/dialects/postgresql.png', import.meta.url).href,
  redis: new URL('./assets/dialects/redis.png', import.meta.url).href,
  sqlite: new URL('./assets/dialects/sqlite.png', import.meta.url).href,
  sqlserver: new URL('./assets/dialects/sqlserver.png', import.meta.url).href,
  starrocks: new URL('./assets/dialects/starrocks.png', import.meta.url).href,
  tdengine: new URL('./assets/dialects/tdengine.png', import.meta.url).href,
  tidb: new URL('./assets/dialects/tidb.png', import.meta.url).href,
} as const

function icon(src: string, label: string, color: string): DialectIcon {
  return { src, label, color }
}

const mysql = icon(png.mysql, 'MySQL', '#4479A1')
const postgresql = icon(png.postgresql, 'PostgreSQL', '#4169E1')
const opengauss = icon(png.opengauss, 'openGauss', '#2F69E0')

/** dialect 字符串 -> 图标定义；未注册的方言用 GENERIC_ICON。 */
const ICONS: Record<string, DialectIcon> = {
  [DbDialect.MySQL]: mysql,
  [DbDialect.MariaDB]: icon(png.mariadb, 'MariaDB', '#003545'),
  [DbDialect.PostgreSQL]: postgresql,
  [DbDialect.Oracle]: icon(png.oracle, 'Oracle', '#C74634'),
  [DbDialect.SqlServer]: icon(png.sqlserver, 'SQL Server', '#CC2927'),
  [DbDialect.DM]: icon(png.dameng, '达梦 DM', '#C71D2A'),
  [DbDialect.KingbaseES]: icon(png.kingbase, '人大金仓', '#C4001A'),
  [DbDialect.OceanBase]: icon(png.oceanbase, 'OceanBase', '#0066CC'),
  [DbDialect.TiDB]: icon(png.tidb, 'TiDB', '#DC150B'),
  [DbDialect.CockroachDB]: icon(png.cockroach, 'CockroachDB', '#6933FF'),
  [DbDialect.Greenplum]: icon(png.greenplum, 'Greenplum', '#75B900'),
  [DbDialect.OpenGauss]: opengauss,
  [DbDialect.Vastbase]: opengauss,
  [DbDialect.MogDB]: opengauss,
  [DbDialect.Panweidb]: opengauss,
  [DbDialect.HighGo]: postgresql,
  [DbDialect.GBase8a]: mysql,
  [DbDialect.SQLite]: icon(png.sqlite, 'SQLite', '#003B57'),
  [DbDialect.DuckDB]: icon(png.duckdb, 'DuckDB', '#FFF000'),
  [DbDialect.ClickHouse]: icon(png.clickhouse, 'ClickHouse', '#FFCC01'),
  [DbDialect.H2]: icon(png.h2, 'H2', '#09476B'),
  [DbDialect.Doris]: icon(png.doris, 'Doris', '#444FD9'),
  [DbDialect.StarRocks]: icon(png.starrocks, 'StarRocks', '#5B40C6'),
  [DbDialect.Redshift]: postgresql,
  [DbDialect.TDengine]: icon(png.tdengine, 'TDengine', '#1E88E5'),
  [DbDialect.MongoDB]: icon(png.mongo, 'MongoDB', '#47A248'),
  [DbDialect.Redis]: icon(png.redis, 'Redis', '#FF4438'),
  [DbDialect.Elasticsearch]: icon(png.elastic, 'Elasticsearch', '#005571'),
  [DbDialect.PolarDBPG]: postgresql,
  [DbDialect.PolarDBX]: mysql,
  [DbDialect.GaussDB]: opengauss,
  [DbDialect.TimescaleDB]: postgresql,
  [DbDialect.QuestDB]: postgresql,
  [DbDialect.Materialize]: postgresql,
  [DbDialect.RisingWave]: postgresql,
  [DbDialect.Hologres]: postgresql,
  [DbDialect.GreatSQL]: mysql,
  [DbDialect.TDSQLC]: mysql,
}

/** 兜底图标（未识别的方言）：灰色方块 + DB。 */
export const GENERIC_ICON: DialectIcon = {
  label: 'Database',
  color: '#666666',
  initials: 'DB',
}

/** 取某方言的图标定义，未知则 fallback 兜底图标。 */
export function getDialectIcon(dialect: DbDialect | string): DialectIcon {
  return ICONS[dialect] ?? GENERIC_ICON
}

/** 所有已注册方言（用于设置中心 / 测试）。 */
export function registeredDialects(): string[] {
  return Object.keys(ICONS)
}
