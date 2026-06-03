/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL Server 源 parser:SQL Server 本地类型 → Logical IR。
 * 信创只「去 SQL Server」(SQL Server 作源,目标是国产库),所以这里只做 parser,不做 emitter。
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConvertNote, DialectParser, LogicalType } from '../ir'
import { note } from '../ir'

export function parseSqlServerType(native: string): { type: LogicalType; notes: ConvertNote[] } {
  const notes: ConvertNote[] = []
  const raw = (native ?? '').trim()
  const m = /^\s*([a-z ]+?)\s*(?:\(\s*([^)]*)\))?\s*$/i.exec(raw)
  const base = (m?.[1] ?? raw).trim().toLowerCase()
  const args = (m?.[2] ?? '').split(',').map((x) => x.trim())
  const lenTok = args[0]
  const isMax = /^max$/i.test(lenTok ?? '')
  const a0 = lenTok && !isMax ? Number.parseInt(lenTok, 10) : undefined
  const a1 = args[1] != null ? Number.parseInt(args[1], 10) : undefined
  switch (base) {
    case 'varchar':
    case 'nvarchar':
      return isMax
        ? { type: { kind: 'text' }, notes }
        : { type: { kind: 'string', length: a0 }, notes }
    case 'char':
    case 'nchar':
      return { type: { kind: 'string', length: a0 ?? 1, fixed: true }, notes }
    case 'text':
    case 'ntext':
      return { type: { kind: 'text' }, notes }
    case 'tinyint':
    case 'smallint':
      return { type: { kind: 'integer', bytes: 2 }, notes }
    case 'int':
      return { type: { kind: 'integer', bytes: 4 }, notes }
    case 'bigint':
      return { type: { kind: 'integer', bytes: 8 }, notes }
    case 'decimal':
    case 'numeric':
      return { type: { kind: 'decimal', precision: a0, scale: a1 }, notes }
    case 'money':
    case 'smallmoney':
      return { type: { kind: 'decimal', precision: 19, scale: 4 }, notes }
    case 'float':
      return { type: { kind: 'float', bytes: 8 }, notes }
    case 'real':
      return { type: { kind: 'float', bytes: 4 }, notes }
    case 'bit':
      return { type: { kind: 'boolean' }, notes }
    case 'date':
      return { type: { kind: 'date' }, notes }
    case 'datetime':
    case 'datetime2':
    case 'smalldatetime':
      return { type: { kind: 'datetime', precision: a0 }, notes }
    case 'datetimeoffset':
      return { type: { kind: 'datetime', precision: a0, withTimezone: true }, notes }
    case 'time':
      return { type: { kind: 'time' }, notes }
    case 'binary':
    case 'varbinary':
    case 'image':
      return { type: { kind: 'binary', length: a0 }, notes }
    case 'uniqueidentifier':
      return { type: { kind: 'uuid' }, notes }
    case 'xml':
      return { type: { kind: 'xml' }, notes }
    default:
      notes.push(note('review', `未识别的 SQL Server 类型 "${raw}",原样保留待复核`))
      return { type: { kind: 'unknown', raw }, notes }
  }
}

export const sqlServerParser: DialectParser = {
  dialect: DbDialect.SqlServer,
  parseType: parseSqlServerType,
}
