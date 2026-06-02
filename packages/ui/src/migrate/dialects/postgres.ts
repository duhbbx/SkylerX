/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * PG 系 emitter:Logical IR → openGauss / Vastbase / PostgreSQL DDL。
 * 这些库 PG 9.2 内核 + Oracle "A" 兼容;这里生成标准 PG 写法(A 兼容关了也能跑)。
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConvertNote, DialectEmitter, LogicalType } from '../ir'
import { note } from '../ir'

export function emitType(t: LogicalType): { sql: string; notes: ConvertNote[] } {
  const notes: ConvertNote[] = []
  switch (t.kind) {
    case 'string': {
      if (!t.length) return { sql: 'text', notes } // 无长度变长 → text
      return { sql: `${t.fixed ? 'char' : 'varchar'}(${t.length})`, notes }
    }
    case 'text':
      return { sql: 'text', notes }
    case 'integer': {
      const b = t.bytes ?? 4
      return { sql: b <= 2 ? 'smallint' : b >= 8 ? 'bigint' : 'integer', notes }
    }
    case 'decimal':
      return {
        sql: t.precision ? `numeric(${t.precision}${t.scale ? `,${t.scale}` : ''})` : 'numeric',
        notes,
      }
    case 'float': {
      if (t.bytes === 4) return { sql: 'real', notes }
      if (t.bytes === 8) return { sql: 'double precision', notes }
      // Oracle FLOAT(b):二进制精度,<=24 位约等于 real
      return { sql: (t.precision ?? 53) <= 24 ? 'real' : 'double precision', notes }
    }
    case 'boolean':
      return { sql: 'boolean', notes }
    case 'date':
      return { sql: 'date', notes }
    case 'time':
      return { sql: 'time', notes }
    case 'datetime': {
      const p = t.precision != null ? `(${t.precision})` : ''
      return { sql: `timestamp${p}${t.withTimezone ? ' with time zone' : ''}`, notes }
    }
    case 'interval':
      return { sql: 'interval', notes }
    case 'binary': {
      if (t.length) notes.push(note('info', 'PG bytea 不带长度,已丢弃 RAW 长度限制'))
      return { sql: 'bytea', notes }
    }
    case 'json':
      return { sql: 'jsonb', notes }
    case 'xml':
      return { sql: 'xml', notes }
    case 'uuid':
      return { sql: 'uuid', notes }
    case 'rowid':
      notes.push(note('review', 'ROWID 降级为 varchar(18),无物理行号语义'))
      return { sql: 'varchar(18)', notes }
    default:
      notes.push(note('review', `无法映射类型 "${t.raw ?? t.kind}" 到 PG,原样保留待人工处理`))
      return { sql: t.raw ?? 'text', notes }
  }
}

/**
 * PG/openGauss 保留字 —— 即使是合法小写标识符,作为列/表名也必须加引号。
 * openGauss A 兼容在标准 PG 之上还多保留了 body/rownum/sysdate/minus 等(实测踩坑:
 * 列名 body 不加引号会报 syntax error)。这里收常见会被当列名的保留字。
 */
const PG_RESERVED = new Set([
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'authorization',
  'between',
  'binary',
  'body',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'comment',
  'concurrently',
  'connect',
  'constraint',
  'create',
  'cross',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'freeze',
  'from',
  'full',
  'grant',
  'group',
  'having',
  'ilike',
  'in',
  'initially',
  'inner',
  'intersect',
  'into',
  'is',
  'isnull',
  'join',
  'lateral',
  'leading',
  'left',
  'level',
  'like',
  'limit',
  'localtime',
  'localtimestamp',
  'minus',
  'natural',
  'not',
  'notnull',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'outer',
  'overlaps',
  'placing',
  'primary',
  'references',
  'returning',
  'right',
  'rownum',
  'select',
  'session_user',
  'similar',
  'some',
  'start',
  'symmetric',
  'sysdate',
  'table',
  'tablesample',
  'then',
  'to',
  'trailing',
  'true',
  'type',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'verbose',
  'when',
  'where',
  'window',
  'with',
])

/** PG 习惯:标识符默认折叠小写;含大写/特殊字符 或 命中保留字 才加双引号。 */
export function quoteId(id: string): string {
  const safe = /^[a-z_][a-z0-9_]*$/.test(id) && !PG_RESERVED.has(id.toLowerCase())
  return safe ? id : `"${id}"`
}

/** 列默认值表达式改写(只处理常见可机器翻的;复杂的返回 null 让上层标 review)。 */
export function emitDefault(expr: string): { sql: string; notes: ConvertNote[] } | null {
  const e = expr.trim()
  const notes: ConvertNote[] = []
  if (/^SYSDATE$/i.test(e) || /^SYSTIMESTAMP$/i.test(e)) {
    return { sql: 'CURRENT_TIMESTAMP', notes }
  }
  if (/^USER$/i.test(e)) return { sql: 'CURRENT_USER', notes }
  if (/^NULL$/i.test(e)) return { sql: 'NULL', notes }
  // 纯字面量(数字 / 'string')原样可用
  if (/^-?\d+(\.\d+)?$/.test(e) || /^'([^']|'')*'$/.test(e)) return { sql: e, notes }
  // 含序列 .NEXTVAL、函数调用等 → 交人工
  if (/\.\s*NEXTVAL\b/i.test(e)) {
    notes.push(
      note('review', `默认值 "${e}" 用了 sequence.NEXTVAL,PG 需改为 nextval('seq') 或 GENERATED`),
    )
    return { sql: e, notes }
  }
  return null
}

export const postgresEmitter: DialectEmitter = {
  dialect: DbDialect.PostgreSQL,
  emitType,
  quoteId,
  emitDefault,
}
