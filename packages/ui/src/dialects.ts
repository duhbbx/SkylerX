/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'

export interface DialectOption {
  value: DbDialect
  label: string
}

// 方言列表:统一 "English (中文)" 格式,按英文名字典序 A-Z 排序;国产数据库中文注解放括号里。
// 排序基于 label 的英文部分;手工维护比 .sort() 更稳(避免运行时 locale 差异)。
// 同时被 ConnectionForm 的 <DialectSelect> 和 ai.ts 的连接解析提示词复用(单一事实源)。
export const dialectOptions: DialectOption[] = [
  { value: DbDialect.ClickHouse, label: 'ClickHouse' },
  { value: DbDialect.CockroachDB, label: 'CockroachDB' },
  { value: DbDialect.DM, label: 'DM (达梦)' },
  { value: DbDialect.Doris, label: 'Doris (Apache)' },
  { value: DbDialect.DuckDB, label: 'DuckDB' },
  { value: DbDialect.Elasticsearch, label: 'Elasticsearch' },
  { value: DbDialect.GaussDB, label: 'GaussDB (华为, PG 兼容)' },
  { value: DbDialect.GreatSQL, label: 'GreatSQL (万里, MySQL 兼容)' },
  { value: DbDialect.Greenplum, label: 'Greenplum' },
  { value: DbDialect.H2, label: 'H2 (PG 兼容模式)' },
  { value: DbDialect.Hologres, label: 'Hologres (阿里, PG 兼容)' },
  { value: DbDialect.KingbaseES, label: 'Kingbase (人大金仓)' },
  { value: DbDialect.MariaDB, label: 'MariaDB' },
  { value: DbDialect.Materialize, label: 'Materialize (PG 兼容, 流式)' },
  { value: DbDialect.MongoDB, label: 'MongoDB' },
  { value: DbDialect.MySQL, label: 'MySQL' },
  { value: DbDialect.OceanBase, label: 'OceanBase (蚂蚁)' },
  { value: DbDialect.OpenGauss, label: 'openGauss (华为)' },
  { value: DbDialect.Oracle, label: 'Oracle' },
  { value: DbDialect.PolarDBPG, label: 'PolarDB-PG (阿里, PG 兼容)' },
  { value: DbDialect.PolarDBX, label: 'PolarDB-X (阿里, MySQL 兼容)' },
  { value: DbDialect.PostgreSQL, label: 'PostgreSQL' },
  { value: DbDialect.QuestDB, label: 'QuestDB (PG-wire, 时序)' },
  { value: DbDialect.Redis, label: 'Redis' },
  { value: DbDialect.Redshift, label: 'Redshift (Amazon)' },
  { value: DbDialect.RisingWave, label: 'RisingWave (PG 兼容, 流式)' },
  { value: DbDialect.Snowflake, label: 'Snowflake' },
  { value: DbDialect.SqlServer, label: 'SQL Server' },
  { value: DbDialect.SQLite, label: 'SQLite' },
  { value: DbDialect.StarRocks, label: 'StarRocks' },
  { value: DbDialect.TDengine, label: 'TDengine (涛思)' },
  { value: DbDialect.TDSQLC, label: 'TDSQL-C (腾讯, MySQL 兼容)' },
  { value: DbDialect.TiDB, label: 'TiDB (PingCAP)' },
  { value: DbDialect.TimescaleDB, label: 'TimescaleDB (PG 扩展, 时序)' },
  { value: DbDialect.Vastbase, label: 'Vastbase (海量, openGauss 内核)' },
  { value: DbDialect.MogDB, label: 'MogDB (云和恩墨, openGauss 内核)' },
  { value: DbDialect.Panweidb, label: 'panweidb (磐维, openGauss 内核)' },
  { value: DbDialect.HighGo, label: 'HighGo (瀚高, PG 系)' },
  { value: DbDialect.GBase8a, label: 'GBase 8a (南大通用, MySQL 系)' },
]

/** 合法方言 id 集合(由 dialectOptions 派生)——连接解析时校验 AI 返回的 dialect。 */
export const DIALECT_IDS: Set<string> = new Set(dialectOptions.map((o) => o.value))
