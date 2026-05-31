/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'

/**
 * DB 用户 / 权限（GRANT）辅助。查询用户、查看授权，以及生成 GRANT/REVOKE 语句。
 * 仅 MySQL / PostgreSQL 系；权限变更语句一律交用户在查询页复核后执行，不自动跑。
 */
export const COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']

function fam(d: DbDialect): 'mysql' | 'pg' | 'oracle' | 'mssql' | 'other' {
  if (
    [
      DbDialect.MySQL,
      DbDialect.MariaDB,
      DbDialect.OceanBase,
      DbDialect.TiDB,
      DbDialect.Doris,
      DbDialect.StarRocks,
      DbDialect.PolarDBX,
      DbDialect.GreatSQL,
      DbDialect.TDSQLC,
    ].includes(d)
  )
    return 'mysql'
  if (
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.CockroachDB,
      DbDialect.Greenplum,
      DbDialect.OpenGauss,
      DbDialect.Redshift,
      DbDialect.PolarDBPG,
      DbDialect.GaussDB,
      DbDialect.TimescaleDB,
      DbDialect.QuestDB,
      DbDialect.Materialize,
      DbDialect.RisingWave,
      DbDialect.Hologres,
    ].includes(d)
  )
    return 'pg'
  if ([DbDialect.Oracle, DbDialect.DM].includes(d)) return 'oracle'
  if (d === DbDialect.SqlServer) return 'mssql'
  return 'other'
}

/** 列出登录用户 / 角色。MySQL 返回 user+host，PG/Oracle/MSSQL 返回 name(host 为空)。 */
export function listUsersQuery(dialect: DbDialect): string | null {
  switch (fam(dialect)) {
    case 'mysql':
      return 'SELECT User AS usr, Host AS host FROM mysql.user ORDER BY User, Host'
    case 'pg':
      return `SELECT rolname AS usr, '' AS host FROM pg_roles WHERE rolcanlogin ORDER BY rolname`
    case 'oracle':
      // Oracle 12c+: oracle_maintained='N' 过滤内置系统用户(SYS/SYSTEM/MDSYS/...)
      // 仅展示业务用户,符合用户对"用户管理"的预期
      return `SELECT username AS "usr", '' AS "host" FROM all_users
              WHERE oracle_maintained = 'N' ORDER BY username`
    case 'mssql':
      return `SELECT name AS usr, '' AS host FROM sys.database_principals
              WHERE type IN ('S','U','G') AND name NOT LIKE '##%'
              AND name NOT IN ('dbo','guest','INFORMATION_SCHEMA','sys','public')
              ORDER BY name`
    default:
      return null
  }
}

/** 查看某用户已有授权。MySQL 用 SHOW GRANTS，PG/Oracle/MSSQL 查系统视图。 */
export function userGrantsQuery(dialect: DbDialect, user: string, host: string): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (fam(dialect)) {
    case 'mysql':
      return `SHOW GRANTS FOR '${esc(user)}'@'${esc(host || '%')}'`
    case 'pg':
      return `SELECT table_schema || '.' || table_name AS obj, privilege_type AS priv
        FROM information_schema.role_table_grants WHERE grantee = '${esc(user)}'
        ORDER BY table_schema, table_name, privilege_type`
    case 'oracle':
      // 三张视图合并: 系统权限 + 角色 + 对象权限。dba_* 需 DBA,grantee = 用户大写
      // 若当前连接用户没 DBA,会报 ORA-00942,PrivilegesDialog 已捕获显示
      return `SELECT 'SYS' AS "obj", privilege AS "priv"
                FROM dba_sys_privs WHERE grantee = UPPER('${esc(user)}')
              UNION ALL
              SELECT 'ROLE' AS "obj", granted_role AS "priv"
                FROM dba_role_privs WHERE grantee = UPPER('${esc(user)}')
              UNION ALL
              SELECT owner || '.' || table_name AS "obj", privilege AS "priv"
                FROM dba_tab_privs WHERE grantee = UPPER('${esc(user)}')
              ORDER BY "obj", "priv"`
    case 'mssql':
      return `SELECT class_desc AS obj, permission_name AS priv
              FROM sys.database_permissions p
              JOIN sys.database_principals u ON p.grantee_principal_id = u.principal_id
              WHERE u.name = '${esc(user)}' ORDER BY obj, priv`
    default:
      return null
  }
}

/** 组装 GRANT 语句（target / grantee 由调用方按方言拼好）。 */
export function buildGrant(
  privs: string[],
  target: string,
  grantee: string,
  withGrantOption = false,
): string {
  const p = privs.length ? privs.join(', ') : 'SELECT'
  return `GRANT ${p} ON ${target} TO ${grantee}${withGrantOption ? ' WITH GRANT OPTION' : ''};`
}

/** 组装 REVOKE 语句。 */
export function buildRevoke(privs: string[], target: string, grantee: string): string {
  const p = privs.length ? privs.join(', ') : 'ALL PRIVILEGES'
  return `REVOKE ${p} ON ${target} FROM ${grantee};`
}

/** 按方言格式化被授权者：MySQL='user'@'host'，PG=role 名，Oracle=大写用户名,MSSQL=[user] */
export function formatGrantee(dialect: DbDialect, user: string, host: string): string {
  const f = fam(dialect)
  if (f === 'mysql') return `'${user}'@'${host || '%'}'`
  if (f === 'mssql') return `[${user.replace(/]/g, ']]')}]`
  if (f === 'oracle') return `"${user.toUpperCase().replace(/"/g, '""')}"`
  return `"${user.replace(/"/g, '""')}"`
}
