/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { buildGrant, buildRevoke, formatGrantee, listUsersQuery } from './privileges'

describe('formatGrantee', () => {
  it('MySQL uses user@host, PG uses quoted role', () => {
    expect(formatGrantee(DbDialect.MySQL, 'app', '10.0.0.%')).toBe("'app'@'10.0.0.%'")
    expect(formatGrantee(DbDialect.MySQL, 'app', '')).toBe("'app'@'%'")
    expect(formatGrantee(DbDialect.PostgreSQL, 'app', '')).toBe('"app"')
  })
})

describe('buildGrant / buildRevoke', () => {
  it('assembles GRANT with privileges, target, grantee', () => {
    expect(buildGrant(['SELECT', 'INSERT'], '`db`.*', "'app'@'%'")).toBe(
      "GRANT SELECT, INSERT ON `db`.* TO 'app'@'%';",
    )
  })
  it('appends WITH GRANT OPTION', () => {
    expect(buildGrant(['ALL PRIVILEGES'], '*.*', "'a'@'%'", true)).toBe(
      "GRANT ALL PRIVILEGES ON *.* TO 'a'@'%' WITH GRANT OPTION;",
    )
  })
  it('defaults empty privileges sensibly', () => {
    expect(buildGrant([], 't', 'g')).toContain('GRANT SELECT ON t')
    expect(buildRevoke([], 't', 'g')).toContain('REVOKE ALL PRIVILEGES ON t')
  })
})

describe('listUsersQuery', () => {
  it('targets mysql.user / pg_roles, null for others', () => {
    expect(listUsersQuery(DbDialect.MySQL)).toContain('mysql.user')
    expect(listUsersQuery(DbDialect.PostgreSQL)).toContain('pg_roles')
    expect(listUsersQuery(DbDialect.Oracle)).toBeNull()
  })
})
