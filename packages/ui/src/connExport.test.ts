/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { connJdbcUrl, formatConnection } from './connExport'

const base = (over: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  id: 'c1',
  name: 'prod',
  dialect: DbDialect.MySQL,
  host: '10.0.0.5',
  port: 3306,
  user: 'root',
  password: 'secret123',
  database: 'app',
  ...over,
})

describe('connJdbcUrl', () => {
  it('builds per-dialect JDBC URLs', () => {
    expect(connJdbcUrl(base())).toBe('jdbc:mysql://10.0.0.5:3306/app')
    expect(connJdbcUrl(base({ dialect: DbDialect.PostgreSQL, port: 5432 }))).toBe(
      'jdbc:postgresql://10.0.0.5:5432/app',
    )
    expect(connJdbcUrl(base({ dialect: DbDialect.SqlServer, port: 1433 }))).toBe(
      'jdbc:sqlserver://10.0.0.5:1433;databaseName=app',
    )
    expect(connJdbcUrl(base({ dialect: DbDialect.DM, port: 5236 }))).toBe('jdbc:dm://10.0.0.5:5236')
    expect(
      connJdbcUrl(
        base({
          dialect: DbDialect.Oracle,
          port: 1521,
          database: '',
          extra: { serviceName: 'FREEPDB1' },
        }),
      ),
    ).toBe('jdbc:oracle:thin:@10.0.0.5:1521/FREEPDB1')
  })
})

describe('formatConnection — never includes the password', () => {
  it('jdbc / json / multiline / singleline all omit the password', () => {
    const c = base({ password: 'secret123' })
    for (const f of ['jdbc', 'json', 'multiline', 'singleline'] as const) {
      expect(formatConnection(c, f)).not.toContain('secret123')
    }
  })
  it('json keeps other fields, drops password', () => {
    const j = JSON.parse(formatConnection(base(), 'json'))
    expect(j.password).toBeUndefined()
    expect(j).toMatchObject({ name: 'prod', host: '10.0.0.5', user: 'root', database: 'app' })
  })
  it('multiline is key: value per line, password absent', () => {
    const txt = formatConnection(base(), 'multiline')
    expect(txt).toContain('host: 10.0.0.5')
    expect(txt).toContain('user: root')
    expect(txt).not.toMatch(/password/i)
  })
  it('singleline is key=value; semicolon-separated', () => {
    const txt = formatConnection(base(), 'singleline')
    expect(txt).toBe('name=prod; dialect=mysql; host=10.0.0.5; port=3306; user=root; database=app')
  })
  it('omits empty optional fields (no database/group)', () => {
    const txt = formatConnection(base({ database: undefined, group: undefined }), 'singleline')
    expect(txt).not.toContain('database=')
    expect(txt).not.toContain('group=')
  })
})
