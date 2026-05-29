/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { registerDriver } from '../registry.js'
import { createClickhouseDriver } from './clickhouse.js'
import { createDmDriver } from './dm.js'
import { createDuckdbDriver } from './duckdb.js'
import { createElasticsearchDriver } from './elasticsearch.js'
import { createMongoDriver } from './mongo.js'
import { createMysqlFamilyDriver } from './mysql.js'
import { createOracleDriver } from './oracle.js'
import { createPostgresDriver } from './postgres.js'
import { createRedisDriver } from './redis.js'
import { createSnowflakeDriver } from './snowflake.js'
import { createSqliteDriver } from './sqlite.js'
import { createSqlServerDriver } from './sqlserver.js'
import { createTDengineDriver } from './tdengine.js'

/**
 * 注册所有方言驱动。
 *
 * 纯 JS 驱动（mysql2 / pg / mssql）静态加载；原生模块（oracledb / dmdb）在各自驱动里
 * 惰性 import，未安装时仅在连接时报错，不影响 core-driver 加载与其它方言。
 *
 * NoSQL 驱动(mongodb / ioredis)也走惰性 import,不实现 execute(sql),
 * 而是实现 executeCommand(payload),由上层按 dialect 分流。
 */
export function registerBuiltinDrivers(): void {
  // MySQL 系（mysql2）— 含协议兼容的 MariaDB / OceanBase / TiDB / Doris / StarRocks
  registerDriver(createMysqlFamilyDriver(DbDialect.MySQL))
  registerDriver(createMysqlFamilyDriver(DbDialect.MariaDB))
  registerDriver(createMysqlFamilyDriver(DbDialect.OceanBase))
  registerDriver(createMysqlFamilyDriver(DbDialect.TiDB))
  registerDriver(createMysqlFamilyDriver(DbDialect.Doris))
  registerDriver(createMysqlFamilyDriver(DbDialect.StarRocks))

  // PostgreSQL 系（pg）— 含金仓 / CockroachDB / Greenplum / openGauss / H2(PG 兼容) / Redshift
  registerDriver(createPostgresDriver(DbDialect.PostgreSQL))
  registerDriver(createPostgresDriver(DbDialect.KingbaseES))
  registerDriver(createPostgresDriver(DbDialect.CockroachDB))
  registerDriver(createPostgresDriver(DbDialect.Greenplum))
  registerDriver(createPostgresDriver(DbDialect.OpenGauss))
  registerDriver(createPostgresDriver(DbDialect.H2))
  registerDriver(createPostgresDriver(DbDialect.Redshift))

  // SQL Server（mssql，纯 JS）
  registerDriver(createSqlServerDriver(DbDialect.SqlServer))

  // Oracle（oracledb，惰性，thin 模式）
  registerDriver(createOracleDriver(DbDialect.Oracle))

  // 达梦（dmdb，惰性，官方分发）
  registerDriver(createDmDriver(DbDialect.DM))

  // NoSQL：MongoDB（mongodb 包，惰性）
  registerDriver(createMongoDriver(DbDialect.MongoDB))

  // NoSQL：Redis（ioredis 包，惰性）
  registerDriver(createRedisDriver(DbDialect.Redis))

  // NoSQL：Elasticsearch（@elastic/elasticsearch 包，惰性，REST/HTTP）
  registerDriver(createElasticsearchDriver(DbDialect.Elasticsearch))

  // 本地文件型 SQL（占位 → 子代理填充）
  registerDriver(createSqliteDriver(DbDialect.SQLite))
  registerDriver(createDuckdbDriver(DbDialect.DuckDB))

  // 云/列存 SQL（占位 → 子代理填充）
  registerDriver(createClickhouseDriver(DbDialect.ClickHouse))
  registerDriver(createSnowflakeDriver(DbDialect.Snowflake))

  // 信创时序:TDengine(@tdengine/websocket,SQL,占位 → 子代理填充)
  registerDriver(createTDengineDriver(DbDialect.TDengine))
}
