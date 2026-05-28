import { DbDialect } from '@db-tool/shared-types'
import { registerDriver } from '../registry.js'
import { createDmDriver } from './dm.js'
import { createElasticsearchDriver } from './elasticsearch.js'
import { createMongoDriver } from './mongo.js'
import { createMysqlFamilyDriver } from './mysql.js'
import { createOracleDriver } from './oracle.js'
import { createPostgresDriver } from './postgres.js'
import { createRedisDriver } from './redis.js'
import { createSqlServerDriver } from './sqlserver.js'

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
  // MySQL 系（mysql2）
  registerDriver(createMysqlFamilyDriver(DbDialect.MySQL))
  registerDriver(createMysqlFamilyDriver(DbDialect.MariaDB))
  registerDriver(createMysqlFamilyDriver(DbDialect.OceanBase))

  // PostgreSQL 系（pg，金仓协议兼容）
  registerDriver(createPostgresDriver(DbDialect.PostgreSQL))
  registerDriver(createPostgresDriver(DbDialect.KingbaseES))

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
}
