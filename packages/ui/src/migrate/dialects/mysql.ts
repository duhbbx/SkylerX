/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MySQL 系 emitter:Logical IR → MySQL DDL。
 * 覆盖信创里 MySQL 协议兼容的国产库目标:OceanBase / GBase 8a / TiDB / Doris / StarRocks 等。
 *
 * 与 PG/Oracle 的差异:反引号标识符、注释内联(COMMENT 写在列/表里,没有 COMMENT ON)、
 * 无独立序列(用 AUTO_INCREMENT)、布尔用 TINYINT(1)。这些通过 emitter 的
 * commentStyle/tableSuffix/emitSequence 钩子表达,CREATE TABLE 主体仍走 convert.ts 通用渲染。
 */
import { DbDialect } from '@db-tool/shared-types'
import type { ConvertNote, DialectEmitter, LogicalSequence, LogicalType } from '../ir'
import { note } from '../ir'

export function emitType(t: LogicalType): { sql: string; notes: ConvertNote[] } {
  const notes: ConvertNote[] = []
  switch (t.kind) {
    case 'string': {
      if (!t.length) return { sql: 'TEXT', notes }
      return { sql: `${t.fixed ? 'CHAR' : 'VARCHAR'}(${t.length})`, notes }
    }
    case 'text':
      return { sql: 'TEXT', notes }
    case 'integer': {
      const b = t.bytes ?? 4
      return { sql: b <= 2 ? 'SMALLINT' : b >= 8 ? 'BIGINT' : 'INT', notes }
    }
    case 'decimal':
      return {
        sql: t.precision
          ? `DECIMAL(${t.precision}${t.scale ? `,${t.scale}` : ''})`
          : 'DECIMAL(38,10)',
        notes,
      }
    case 'float':
      return { sql: t.bytes === 4 ? 'FLOAT' : 'DOUBLE', notes }
    case 'boolean':
      return { sql: 'TINYINT(1)', notes }
    case 'date':
      return { sql: 'DATE', notes }
    case 'time':
      return { sql: 'TIME', notes }
    case 'datetime': {
      const p = t.precision != null ? `(${t.precision})` : ''
      if (t.withTimezone) {
        notes.push(
          note('info', 'MySQL 无带时区时间类型,映射为 TIMESTAMP(按会话时区存储),语义需复核'),
        )
        return { sql: `TIMESTAMP${p}`, notes }
      }
      return { sql: `DATETIME${p}`, notes }
    }
    case 'interval':
      notes.push(note('review', 'MySQL 无 INTERVAL 类型,降级为 VARCHAR(64),相关运算需改写'))
      return { sql: 'VARCHAR(64)', notes }
    case 'binary':
      return { sql: 'BLOB', notes }
    case 'json':
      return { sql: 'JSON', notes }
    case 'xml':
      notes.push(note('review', 'MySQL 无 XML 类型,降级为 TEXT;XPath/XQuery 需改写'))
      return { sql: 'TEXT', notes }
    case 'uuid':
      notes.push(note('info', 'MySQL 无原生 UUID,映射为 CHAR(36)'))
      return { sql: 'CHAR(36)', notes }
    case 'rowid':
      notes.push(note('review', 'ROWID 降级为 VARCHAR(18),无物理行号语义'))
      return { sql: 'VARCHAR(18)', notes }
    default:
      notes.push(note('review', `无法映射类型 "${t.raw ?? t.kind}" 到 MySQL,原样保留待人工处理`))
      return { sql: t.raw ?? 'TEXT', notes }
  }
}

/** MySQL 保留字(作为列/表名需反引号)。 */
const MY_RESERVED = new Set([
  'ADD',
  'ALL',
  'ALTER',
  'AND',
  'AS',
  'ASC',
  'BETWEEN',
  'BIGINT',
  'BLOB',
  'BOTH',
  'BY',
  'CALL',
  'CASCADE',
  'CASE',
  'CHANGE',
  'CHAR',
  'CHECK',
  'COLLATE',
  'COLUMN',
  'CONDITION',
  'CONSTRAINT',
  'CONVERT',
  'CREATE',
  'CROSS',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_USER',
  'CURSOR',
  'DATABASE',
  'DATABASES',
  'DEC',
  'DECIMAL',
  'DECLARE',
  'DEFAULT',
  'DELETE',
  'DESC',
  'DESCRIBE',
  'DISTINCT',
  'DIV',
  'DOUBLE',
  'DROP',
  'DUAL',
  'EACH',
  'ELSE',
  'ELSEIF',
  'ENCLOSED',
  'EXISTS',
  'EXIT',
  'EXPLAIN',
  'FALSE',
  'FETCH',
  'FLOAT',
  'FOR',
  'FORCE',
  'FOREIGN',
  'FROM',
  'FULLTEXT',
  'GRANT',
  'GROUP',
  'HAVING',
  'IF',
  'IGNORE',
  'IN',
  'INDEX',
  'INNER',
  'INSERT',
  'INT',
  'INTEGER',
  'INTERVAL',
  'INTO',
  'IS',
  'JOIN',
  'KEY',
  'KEYS',
  'KILL',
  'LEADING',
  'LEFT',
  'LIKE',
  'LIMIT',
  'LINES',
  'LOAD',
  'LOCK',
  'LONG',
  'LONGBLOB',
  'LONGTEXT',
  'MATCH',
  'MEDIUMINT',
  'MOD',
  'NATURAL',
  'NOT',
  'NULL',
  'NUMERIC',
  'ON',
  'OPTIMIZE',
  'OPTION',
  'OR',
  'ORDER',
  'OUT',
  'OUTER',
  'PRECISION',
  'PRIMARY',
  'PROCEDURE',
  'RANGE',
  'READ',
  'REAL',
  'REFERENCES',
  'RENAME',
  'REPEAT',
  'REPLACE',
  'REQUIRE',
  'RESTRICT',
  'RETURN',
  'REVOKE',
  'RIGHT',
  'RLIKE',
  'SCHEMA',
  'SELECT',
  'SET',
  'SHOW',
  'SMALLINT',
  'SPATIAL',
  'SQL',
  'SSL',
  'STARTING',
  'TABLE',
  'TERMINATED',
  'THEN',
  'TINYINT',
  'TO',
  'TRAILING',
  'TRIGGER',
  'TRUE',
  'UNION',
  'UNIQUE',
  'UNLOCK',
  'UNSIGNED',
  'UPDATE',
  'USAGE',
  'USE',
  'USING',
  'VALUES',
  'VARBINARY',
  'VARCHAR',
  'WHEN',
  'WHERE',
  'WHILE',
  'WITH',
  'WRITE',
  'XOR',
  'ZEROFILL',
  'RANK',
  'ROW',
  'ROWS',
  'SYSTEM',
])

/** MySQL 用反引号;简单标识符且非保留字才裸写。 */
export function quoteId(id: string): string {
  const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(id) && !MY_RESERVED.has(id.toUpperCase())
  return safe ? id : `\`${id.replace(/`/g, '``')}\``
}

export function emitDefault(expr: string): { sql: string; notes: ConvertNote[] } | null {
  const e = expr.trim()
  const notes: ConvertNote[] = []
  if (/^SYSDATE$/i.test(e) || /^SYSTIMESTAMP$/i.test(e)) return { sql: 'CURRENT_TIMESTAMP', notes }
  if (/^NULL$/i.test(e)) return { sql: 'NULL', notes }
  if (/^-?\d+(\.\d+)?$/.test(e) || /^'([^']|'')*'$/.test(e)) return { sql: e, notes }
  if (/\.\s*NEXTVAL\b/i.test(e)) {
    notes.push(note('review', `默认值 "${e}" 用了 sequence.NEXTVAL,MySQL 需改为 AUTO_INCREMENT`))
    return { sql: e, notes }
  }
  return null
}

/** MySQL 无独立序列;以注释提示改用 AUTO_INCREMENT(目标库若支持 SEQUENCE 可自行替换)。 */
export function emitSequence(seq: LogicalSequence): string {
  return `-- 序列 ${seq.schema}.${seq.name}:MySQL 系无独立 SEQUENCE,请改用 AUTO_INCREMENT 列(TiDB/OceanBase 可用各自的 SEQUENCE 扩展)`
}

export const mysqlEmitter: DialectEmitter = {
  dialect: DbDialect.MySQL,
  emitType,
  quoteId,
  emitDefault,
  emitSequence,
  commentStyle: 'inline',
  tableSuffix: ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
}
