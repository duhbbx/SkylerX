import { DbDialect } from '@db-tool/shared-types'

/**
 * DB 用户 / 权限（GRANT）辅助。查询用户、查看授权，以及生成 GRANT/REVOKE 语句。
 * 仅 MySQL / PostgreSQL 系；权限变更语句一律交用户在查询页复核后执行，不自动跑。
 */
export const COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']

function fam(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if ([DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if ([DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}

/** 列出登录用户 / 角色。MySQL 返回 user+host，PG 返回 rolname(host 为空)。 */
export function listUsersQuery(dialect: DbDialect): string | null {
  switch (fam(dialect)) {
    case 'mysql':
      return 'SELECT User AS usr, Host AS host FROM mysql.user ORDER BY User, Host'
    case 'pg':
      return `SELECT rolname AS usr, '' AS host FROM pg_roles WHERE rolcanlogin ORDER BY rolname`
    default:
      return null
  }
}

/** 查看某用户已有授权。MySQL 用 SHOW GRANTS，PG 查 role_table_grants。 */
export function userGrantsQuery(dialect: DbDialect, user: string, host: string): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (fam(dialect)) {
    case 'mysql':
      return `SHOW GRANTS FOR '${esc(user)}'@'${esc(host || '%')}'`
    case 'pg':
      return `SELECT table_schema || '.' || table_name AS obj, privilege_type AS priv
        FROM information_schema.role_table_grants WHERE grantee = '${esc(user)}'
        ORDER BY table_schema, table_name, privilege_type`
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

/** 按方言格式化被授权者：MySQL='user'@'host'，PG=role 名。 */
export function formatGrantee(dialect: DbDialect, user: string, host: string): string {
  return fam(dialect) === 'mysql' ? `'${user}'@'${host || '%'}'` : `"${user.replace(/"/g, '""')}"`
}
