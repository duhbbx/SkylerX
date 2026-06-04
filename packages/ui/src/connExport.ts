/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 复制连接内容:把 ConnectionConfig 格式化成 JDBC URL / JSON / 多行 / 单行(分号分隔)。
 * **一律不含密码**(其它字段都给)。纯函数,可单测。
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { familyOf } from './ddl'

export type ConnCopyFormat = 'jdbc' | 'json' | 'multiline' | 'singleline'

/** 拼 JDBC URL(按方言;不含账号密码,连接信息为主)。 */
export function connJdbcUrl(c: ConnectionConfig): string {
  const { host, port, database } = c
  const db = database ? `/${database}` : ''
  if (c.dialect === DbDialect.Oracle) {
    const svc = (c.extra?.serviceName as string | undefined) || database || ''
    return `jdbc:oracle:thin:@${host}:${port}${svc ? `/${svc}` : ''}`
  }
  if (c.dialect === DbDialect.DM) return `jdbc:dm://${host}:${port}`
  if (c.dialect === DbDialect.SqlServer)
    return `jdbc:sqlserver://${host}:${port}${database ? `;databaseName=${database}` : ''}`
  switch (familyOf(c.dialect)) {
    case 'mysql':
      return `jdbc:mysql://${host}:${port}${db}`
    case 'pg':
      return `jdbc:postgresql://${host}:${port}${db}`
    case 'oracle':
      return `jdbc:oracle:thin:@${host}:${port}${db}`
    default:
      return `jdbc:${c.dialect}://${host}:${port}${db}`
  }
}

/** 要导出的「其它字段」(不含密码),按可读顺序;空值过滤掉。 */
function fields(c: ConnectionConfig): Array<[string, string]> {
  const out: Array<[string, string]> = [
    ['name', c.name],
    ['dialect', String(c.dialect)],
    ['host', c.host],
    ['port', String(c.port)],
    ['user', c.user],
    ['database', c.database ?? ''],
    ['group', c.group ?? ''],
  ]
  const svc = c.extra?.serviceName as string | undefined
  if (svc) out.push(['serviceName', svc])
  if (c.ssh?.host) out.push(['ssh', `${c.ssh.host}:${c.ssh.port ?? 22}`])
  if (c.ssl) out.push(['ssl', 'on'])
  return out.filter(([, v]) => v !== '' && v != null)
}

/** 不含密码的纯净配置(JSON 用):删 password,保留其余。 */
function sanitized(c: ConnectionConfig): Record<string, unknown> {
  const { password: _pw, ...rest } = c
  if (rest.ssh && (rest.ssh as { password?: string }).password) {
    rest.ssh = { ...rest.ssh, password: undefined } as ConnectionConfig['ssh']
  }
  return rest
}

/** 按格式输出连接内容(永不含密码)。 */
export function formatConnection(c: ConnectionConfig, format: ConnCopyFormat): string {
  switch (format) {
    case 'jdbc':
      return connJdbcUrl(c)
    case 'json':
      return JSON.stringify(sanitized(c), null, 2)
    case 'multiline':
      return fields(c)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    case 'singleline':
      return fields(c)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
  }
}
