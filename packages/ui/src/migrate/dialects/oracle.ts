/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Oracle 方言 parser:Oracle 本地类型 → Logical IR。
 * 只解析类型;过程体/视图体由上层原样挂到 LogicalProcedural 交 AI。
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConvertNote, DialectParser, LogicalType } from '../ir'
import { note } from '../ir'

/** 拆 `BASE(arg1[,arg2])` → { base(大写,单空格), args[] }。 */
function split(native: string): { base: string; args: number[]; rawArgs?: string } {
  const m = /^\s*([A-Za-z0-9_ ]+?)\s*(\(([^)]*)\))?\s*$/.exec(native ?? '')
  if (!m) return { base: (native ?? '').trim().toUpperCase(), args: [] }
  const base = m[1].trim().toUpperCase().replace(/\s+/g, ' ')
  const rawArgs = m[3]
  const args = rawArgs
    ? rawArgs
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
    : []
  return { base, args, rawArgs }
}

/** Oracle NUMBER(p,s) → 整数宽度或定点。 */
function fromNumber(args: number[]): LogicalType {
  const [p, s] = args
  if (p === undefined) return { kind: 'decimal', raw: 'NUMBER' } // 无界精度
  if (!s) {
    // 整数:按精度选宽度(保守,溢出宁可用更宽)
    if (p <= 4) return { kind: 'integer', bytes: 2 }
    if (p <= 9) return { kind: 'integer', bytes: 4 }
    if (p <= 18) return { kind: 'integer', bytes: 8 }
    return { kind: 'decimal', precision: p, scale: 0 }
  }
  return { kind: 'decimal', precision: p, scale: s }
}

export function parseType(native: string): { type: LogicalType; notes: ConvertNote[] } {
  const { base, args } = split(native)
  const notes: ConvertNote[] = []
  const a0 = args[0]

  switch (base) {
    case 'VARCHAR2':
    case 'VARCHAR':
      return { type: { kind: 'string', length: a0, fixed: false }, notes }
    case 'NVARCHAR2':
      return { type: { kind: 'string', length: a0, fixed: false, unicode: true }, notes }
    case 'CHAR':
      return { type: { kind: 'string', length: a0 ?? 1, fixed: true }, notes }
    case 'NCHAR':
      return { type: { kind: 'string', length: a0 ?? 1, fixed: true, unicode: true }, notes }

    case 'NUMBER':
      return { type: fromNumber(args), notes }
    case 'INTEGER':
    case 'INT':
    case 'SMALLINT':
      return { type: { kind: 'integer', bytes: base === 'SMALLINT' ? 2 : 4 }, notes }
    case 'FLOAT':
      return { type: { kind: 'float', precision: a0 }, notes }
    case 'BINARY_FLOAT':
      return { type: { kind: 'float', bytes: 4 }, notes }
    case 'BINARY_DOUBLE':
      return { type: { kind: 'float', bytes: 8 }, notes }

    case 'DATE':
      notes.push(
        note('info', 'Oracle DATE 含时分秒,映射为带时间的 datetime;若仅需日期可手工降为 date'),
      )
      return { type: { kind: 'datetime' }, notes }
    case 'TIMESTAMP':
      return { type: { kind: 'datetime', precision: a0 }, notes }
    case 'TIMESTAMP WITH TIME ZONE':
    case 'TIMESTAMP WITH LOCAL TIME ZONE':
      return { type: { kind: 'datetime', precision: a0, withTimezone: true }, notes }
    case 'INTERVAL YEAR TO MONTH':
    case 'INTERVAL DAY TO SECOND':
      return { type: { kind: 'interval', raw: base }, notes }

    case 'CLOB':
    case 'NCLOB':
      return { type: { kind: 'text' }, notes }
    case 'LONG':
      notes.push(note('info', 'Oracle LONG 已废弃,映射为 text'))
      return { type: { kind: 'text', raw: 'LONG' }, notes }
    case 'BLOB':
      return { type: { kind: 'binary' }, notes }
    case 'RAW':
      return { type: { kind: 'binary', length: a0 }, notes }
    case 'LONG RAW':
      notes.push(note('info', 'Oracle LONG RAW 已废弃,映射为二进制'))
      return { type: { kind: 'binary', raw: 'LONG RAW' }, notes }

    case 'ROWID':
    case 'UROWID':
      notes.push(note('review', 'ROWID/UROWID 无通用等价,降级为字符串;依赖物理行号的逻辑会失效'))
      return { type: { kind: 'rowid', raw: base }, notes }
    case 'XMLTYPE':
      notes.push(note('info', 'XMLTYPE → xml;XPath/XQuery 表达式可能需重写'))
      return { type: { kind: 'xml' }, notes }

    default:
      notes.push(
        note('review', `未识别的 Oracle 类型 "${base}"(可能是用户自定义类型),原样保留待复核`),
      )
      return { type: { kind: 'unknown', raw: native.trim() }, notes }
  }
}

export const oracleParser: DialectParser = { dialect: DbDialect.Oracle, parseType }
