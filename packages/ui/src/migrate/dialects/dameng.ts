/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 达梦(DM)emitter:Logical IR → DM DDL。
 * DM 是 Oracle 兼容库,类型基本回落到 Oracle 风格写法。
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConvertNote, DialectEmitter, LogicalType } from '../ir'
import { note } from '../ir'

export function emitType(t: LogicalType): { sql: string; notes: ConvertNote[] } {
  const notes: ConvertNote[] = []
  switch (t.kind) {
    case 'string': {
      if (!t.length) return { sql: 'TEXT', notes }
      return { sql: `${t.fixed ? 'CHAR' : 'VARCHAR2'}(${t.length})`, notes }
    }
    case 'text':
      return { sql: 'TEXT', notes }
    case 'integer': {
      const b = t.bytes ?? 4
      return { sql: b <= 2 ? 'SMALLINT' : b >= 8 ? 'BIGINT' : 'INTEGER', notes }
    }
    case 'decimal':
      return {
        sql: t.precision ? `NUMBER(${t.precision}${t.scale ? `,${t.scale}` : ''})` : 'NUMBER',
        notes,
      }
    case 'float':
      return { sql: t.bytes === 4 ? 'REAL' : 'DOUBLE', notes }
    case 'boolean':
      return { sql: 'BIT', notes }
    case 'date':
      return { sql: 'DATE', notes }
    case 'time':
      return { sql: 'TIME', notes }
    case 'datetime': {
      const p = t.precision != null ? `(${t.precision})` : ''
      return { sql: `TIMESTAMP${p}${t.withTimezone ? ' WITH TIME ZONE' : ''}`, notes }
    }
    case 'interval':
      return { sql: t.raw ?? 'INTERVAL DAY TO SECOND', notes }
    case 'binary':
      return { sql: 'BLOB', notes }
    case 'json':
      notes.push(note('info', 'DM 无原生 JSON,映射为 TEXT;JSON 函数需用 DM 的 JSON_* 适配'))
      return { sql: 'TEXT', notes }
    case 'xml':
      return { sql: 'XMLTYPE', notes }
    case 'uuid':
      return { sql: 'VARCHAR(36)', notes }
    case 'rowid':
      notes.push(note('review', 'ROWID 降级为 VARCHAR(18)'))
      return { sql: 'VARCHAR(18)', notes }
    default:
      notes.push(note('review', `无法映射类型 "${t.raw ?? t.kind}" 到 DM,原样保留待人工处理`))
      return { sql: t.raw ?? 'TEXT', notes }
  }
}

/** DM(Oracle 系)保留字 —— 作为列/表名必须加引号。 */
const DM_RESERVED = new Set([
  'ACCESS',
  'ADD',
  'ALL',
  'ALTER',
  'AND',
  'ANY',
  'AS',
  'ASC',
  'AUDIT',
  'BETWEEN',
  'BODY',
  'BY',
  'CHAR',
  'CHECK',
  'CLUSTER',
  'COLUMN',
  'COMMENT',
  'COMPRESS',
  'CONNECT',
  'CREATE',
  'CURRENT',
  'DATE',
  'DECIMAL',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DISTINCT',
  'DROP',
  'ELSE',
  'EXCLUSIVE',
  'EXISTS',
  'FILE',
  'FLOAT',
  'FOR',
  'FROM',
  'GRANT',
  'GROUP',
  'HAVING',
  'IDENTIFIED',
  'IN',
  'INDEX',
  'INSERT',
  'INTEGER',
  'INTERSECT',
  'INTO',
  'IS',
  'LEVEL',
  'LIKE',
  'LOCK',
  'LONG',
  'MINUS',
  'MODE',
  'NOT',
  'NULL',
  'NUMBER',
  'OF',
  'ON',
  'OPTION',
  'OR',
  'ORDER',
  'PRIOR',
  'PRIVILEGES',
  'PUBLIC',
  'RAW',
  'RENAME',
  'RESOURCE',
  'REVOKE',
  'ROW',
  'ROWID',
  'ROWNUM',
  'ROWS',
  'SELECT',
  'SESSION',
  'SET',
  'SIZE',
  'SMALLINT',
  'START',
  'SYNONYM',
  'SYSDATE',
  'TABLE',
  'THEN',
  'TO',
  'TRIGGER',
  'TYPE',
  'UID',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'USER',
  'VALIDATE',
  'VALUES',
  'VARCHAR',
  'VARCHAR2',
  'VIEW',
  'WHERE',
  'WITH',
])

/** DM 默认折叠大写;含小写/特殊字符 或 命中保留字 才加双引号。 */
export function quoteId(id: string): string {
  const safe = /^[A-Z_][A-Z0-9_]*$/.test(id) && !DM_RESERVED.has(id.toUpperCase())
  return safe ? id : `"${id}"`
}

/** DM 兼容 Oracle 默认值写法,常见表达式直接保留。 */
export function emitDefault(expr: string): { sql: string; notes: ConvertNote[] } | null {
  const e = expr.trim()
  if (
    /^SYSDATE$/i.test(e) ||
    /^SYSTIMESTAMP$/i.test(e) ||
    /^USER$/i.test(e) ||
    /^NULL$/i.test(e) ||
    /\.\s*NEXTVAL\b/i.test(e) ||
    /^-?\d+(\.\d+)?$/.test(e) ||
    /^'([^']|'')*'$/.test(e)
  ) {
    return { sql: e, notes: [] }
  }
  return null
}

export const damengEmitter: DialectEmitter = {
  dialect: DbDialect.DM,
  emitType,
  quoteId,
  emitDefault,
}
