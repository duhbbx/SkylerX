/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 确定性转换编排(hub-and-spoke 的中枢)。
 *
 *   convert = emit(parse(源, IR), 目标)
 *
 * 按 familyOf 选 parser / emitter,加新库只需在注册表里挂一个插件。
 * 结构对象(表/类型)走这里;过程体由上层判定 needsAi 交 AI。
 */
import { type DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'
import { damengEmitter } from './dialects/dameng'
import { mysqlEmitter, mysqlParser } from './dialects/mysql'
import { oracleParser } from './dialects/oracle'
import { postgresEmitter, postgresParser } from './dialects/postgres'
import { sqlServerParser } from './dialects/sqlserver'
import {
  type ConvertNote,
  type DialectEmitter,
  type DialectParser,
  type LogicalCheck,
  type LogicalForeignKey,
  type LogicalIndex,
  type LogicalSequence,
  type LogicalTable,
  type LogicalUnique,
} from './ir'

// ── 方言插件注册表(按 family,一套插件服务整个协议家族) ────────────
const PARSERS: Partial<Record<ReturnType<typeof familyOf>, DialectParser>> = {
  oracle: oracleParser, // Oracle / DM 作源库共用(类型体系一致)
  pg: postgresParser, // PG / openGauss / Vastbase … 作源库(去 PG 或国产库间互迁)
  mysql: mysqlParser, // MySQL / OceanBase / TiDB … 作源库(去 MySQL)
  sqlserver: sqlServerParser, // SQL Server 作源库(去 SQL Server)
}

const EMITTERS: Partial<Record<ReturnType<typeof familyOf>, DialectEmitter>> = {
  pg: postgresEmitter, // openGauss / Vastbase / MogDB / Panweidb / PostgreSQL …
  oracle: damengEmitter, // DM / Oracle
  mysql: mysqlEmitter, // OceanBase / GBase8a / TiDB / Doris / StarRocks …
}

export function parserFor(source: DbDialect): DialectParser | null {
  return PARSERS[familyOf(source)] ?? null
}

export function emitterFor(target: DbDialect): DialectEmitter | null {
  return EMITTERS[familyOf(target)] ?? null
}

/** 这对 源→目标 是否有确定性结构转换通道(没有则只能整体交 AI)。 */
export function hasStructuralPath(source: DbDialect, target: DbDialect): boolean {
  return !!parserFor(source) && !!emitterFor(target)
}

/** 转换单个本地类型:parse 到 IR 再 emit 到目标。 */
export function convertType(
  native: string,
  source: DbDialect,
  target: DbDialect,
): { sql: string; notes: ConvertNote[] } {
  const parser = parserFor(source)
  const emitter = emitterFor(target)
  if (!parser || !emitter) return { sql: native, notes: [] }
  const parsed = parser.parseType(native)
  const emitted = emitter.emitType(parsed.type)
  return { sql: emitted.sql, notes: [...parsed.notes, ...emitted.notes] }
}

// ── 表结构(由列元数据构建 IR,再 emit CREATE TABLE) ──────────────

/** 源库列元数据(来自 catalog 查询,而非正则解析 DDL,更稳)。 */
export interface RawColumn {
  name: string
  /** 本地类型原文,如 `VARCHAR2(50)` / `NUMBER(10,2)`。 */
  dataType: string
  nullable?: boolean
  default?: string
  comment?: string
}

/** 由列元数据构建逻辑表。 */
export function buildTable(
  schema: string,
  name: string,
  cols: RawColumn[],
  source: DbDialect,
  opts: {
    primaryKey?: string[]
    comment?: string
    uniques?: LogicalUnique[]
    checks?: LogicalCheck[]
  } = {},
): { table: LogicalTable; notes: ConvertNote[] } {
  const parser = parserFor(source)
  const notes: ConvertNote[] = []
  const columns = cols.map((c) => {
    const parsed = parser?.parseType(c.dataType) ?? {
      type: { kind: 'unknown' as const, raw: c.dataType },
      notes: [],
    }
    for (const n of parsed.notes) notes.push(prefix(c.name, n))
    return {
      name: c.name,
      type: parsed.type,
      nullable: c.nullable ?? true,
      default: c.default,
      comment: c.comment,
      notes: parsed.notes,
    }
  })
  return {
    table: {
      kind: 'table',
      schema,
      name,
      columns,
      primaryKey: opts.primaryKey,
      uniques: opts.uniques,
      checks: opts.checks,
      comment: opts.comment,
    },
    notes,
  }
}

/** 把逻辑表 emit 成目标库 CREATE TABLE。 */
export function emitTable(
  table: LogicalTable,
  target: DbDialect,
): { sql: string; notes: ConvertNote[] } {
  const emitter = emitterFor(target)
  if (!emitter)
    return { sql: '', notes: [{ level: 'review', msg: `无 ${target} emitter,无法生成 DDL` }] }
  const q = emitter.quoteId.bind(emitter)
  const notes: ConvertNote[] = []
  const lines: string[] = []

  for (const col of table.columns) {
    const ty = emitter.emitType(col.type)
    for (const n of ty.notes) notes.push(prefix(col.name, n))
    let line = `  ${q(col.name)} ${ty.sql}`
    if (col.default != null && col.default !== '') {
      const d = emitter.emitDefault?.(col.default)
      if (d) {
        line += ` DEFAULT ${d.sql}`
        for (const n of d.notes) notes.push(prefix(col.name, n))
      } else {
        notes.push(
          prefix(col.name, {
            level: 'review',
            msg: `默认值 "${col.default}" 需人工确认目标库写法`,
          }),
        )
      }
    }
    if (!col.nullable) line += ' NOT NULL'
    if (emitter.commentStyle === 'inline' && col.comment) line += ` COMMENT ${sqlStr(col.comment)}`
    lines.push(line)
  }

  if (table.primaryKey?.length) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`)
  }
  for (const u of table.uniques ?? []) {
    const nm = u.name ? `CONSTRAINT ${q(u.name)} ` : ''
    lines.push(`  ${nm}UNIQUE (${u.columns.map(q).join(', ')})`)
  }
  for (const c of table.checks ?? []) {
    const nm = c.name ? `CONSTRAINT ${q(c.name)} ` : ''
    lines.push(`  ${nm}CHECK (${c.expr})`)
    notes.push({
      level: 'review',
      msg: `检查约束 ${c.name ?? ''} 的表达式 "${c.expr}" 需核对目标库函数兼容性`,
    })
  }

  const ref = `${q(table.schema)}.${q(table.name)}`
  const inlineTblComment =
    emitter.commentStyle === 'inline' && table.comment ? ` COMMENT=${sqlStr(table.comment)}` : ''
  const suffix = `${emitter.tableSuffix ?? ''}${inlineTblComment}`
  const sql = `CREATE TABLE ${ref} (\n${lines.join(',\n')}\n)${suffix};`
  return { sql, notes }
}

/** COMMENT ON 语句(PG / Oracle / DM);MySQL 等 inline 风格在 emitTable 内联,这里返回空。 */
export function emitTableComments(table: LogicalTable, target: DbDialect): string[] {
  const emitter = emitterFor(target)
  if (!emitter || emitter.commentStyle === 'inline') return []
  const q = emitter.quoteId.bind(emitter)
  const ref = `${q(table.schema)}.${q(table.name)}`
  const out: string[] = []
  if (table.comment) out.push(`COMMENT ON TABLE ${ref} IS ${sqlStr(table.comment)};`)
  for (const c of table.columns) {
    if (c.comment) out.push(`COMMENT ON COLUMN ${ref}.${q(c.name)} IS ${sqlStr(c.comment)};`)
  }
  return out
}

/** CREATE [UNIQUE] INDEX。 */
export function emitIndex(
  ix: LogicalIndex,
  target: DbDialect,
): { sql: string; notes: ConvertNote[] } {
  const emitter = emitterFor(target)
  if (!emitter) return { sql: '', notes: [] }
  const q = emitter.quoteId.bind(emitter)
  const uniq = ix.unique ? 'UNIQUE ' : ''
  const ref = ix.schema ? `${q(ix.schema)}.${q(ix.table)}` : q(ix.table)
  if (ix.expr) {
    return {
      sql: `CREATE ${uniq}INDEX ${q(ix.name)} ON ${ref} (${ix.expr});`,
      notes: [
        { level: 'review', msg: `函数索引 ${ix.name} 表达式 "${ix.expr}" 需核对目标库函数兼容性` },
      ],
    }
  }
  return {
    sql: `CREATE ${uniq}INDEX ${q(ix.name)} ON ${ref} (${ix.columns.map(q).join(', ')});`,
    notes: [],
  }
}

/** ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY(放到所有建表之后,避免表序依赖)。 */
export function emitForeignKey(fk: LogicalForeignKey, target: DbDialect): string {
  const emitter = emitterFor(target)
  if (!emitter) return ''
  const q = emitter.quoteId.bind(emitter)
  const nm = fk.name ? `CONSTRAINT ${q(fk.name)} ` : ''
  const onDel = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''
  const tbl = fk.schema ? `${q(fk.schema)}.${q(fk.table)}` : q(fk.table)
  const refSchema = fk.refSchema ?? fk.schema
  const refTbl = refSchema ? `${q(refSchema)}.${q(fk.refTable)}` : q(fk.refTable)
  return (
    `ALTER TABLE ${tbl} ADD ${nm}FOREIGN KEY (${fk.columns.map(q).join(', ')}) ` +
    `REFERENCES ${refTbl} (${fk.refColumns.map(q).join(', ')})${onDel};`
  )
}

/**
 * CREATE SEQUENCE。PG 与 Oracle/DM 的 START WITH / INCREMENT BY / MINVALUE /
 * MAXVALUE / CACHE / CYCLE 关键字一致,这里统一拼;个别方言要改写可实现 emitter.emitSequence。
 */
export function emitSequenceDdl(seq: LogicalSequence, target: DbDialect): string {
  const emitter = emitterFor(target)
  if (!emitter) return ''
  if (emitter.emitSequence) return emitter.emitSequence(seq)
  const q = emitter.quoteId.bind(emitter)
  const parts = [`CREATE SEQUENCE ${q(seq.schema)}.${q(seq.name)}`]
  if (seq.increment != null) parts.push(`INCREMENT BY ${seq.increment}`)
  if (seq.minValue != null) parts.push(`MINVALUE ${seq.minValue}`)
  if (seq.maxValue != null) parts.push(`MAXVALUE ${seq.maxValue}`)
  if (seq.start != null) parts.push(`START WITH ${seq.start}`)
  if (seq.cache != null) parts.push(`CACHE ${seq.cache}`)
  if (seq.cycle) parts.push('CYCLE')
  return `${parts.join(' ')};`
}

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** 表的一站式转换:列元数据 → 目标库 CREATE TABLE + COMMENT + 全部告警。 */
export function convertTable(
  schema: string,
  name: string,
  cols: RawColumn[],
  source: DbDialect,
  target: DbDialect,
  opts: {
    primaryKey?: string[]
    comment?: string
    uniques?: LogicalUnique[]
    checks?: LogicalCheck[]
  } = {},
): { sql: string; notes: ConvertNote[] } {
  const built = buildTable(schema, name, cols, source, opts)
  const emitted = emitTable(built.table, target)
  const comments = emitTableComments(built.table, target)
  const sql = comments.length ? `${emitted.sql}\n${comments.join('\n')}` : emitted.sql
  // buildTable 的 notes 已是 parse 期 per-column;emitTable 的是 emit 期。合并去重。
  return { sql, notes: dedupeNotes([...built.notes, ...emitted.notes]) }
}

// ── 整库脚本(依赖排序:序列 → 表 → 注释 → 索引 → 外键) ───────────

/** 一个待转换表的结构化输入。 */
export interface SchemaTableInput {
  schema: string
  name: string
  columns: RawColumn[]
  primaryKey?: string[]
  uniques?: LogicalUnique[]
  checks?: LogicalCheck[]
  comment?: string
}

export interface SchemaInput {
  tables: SchemaTableInput[]
  sequences?: LogicalSequence[]
  indexes?: LogicalIndex[]
  foreignKeys?: LogicalForeignKey[]
}

/**
 * 生成依赖正确的整库 DDL 脚本。
 * 顺序:CREATE SEQUENCE → CREATE TABLE(含内联 PK/UNIQUE/CHECK)→ COMMENT → CREATE INDEX
 * → ALTER TABLE ADD FOREIGN KEY。外键统一放最后,免去建表先后顺序的拓扑排序。
 */
export function convertSchema(
  input: SchemaInput,
  source: DbDialect,
  target: DbDialect,
): { sql: string; notes: ConvertNote[] } {
  const notes: ConvertNote[] = []
  const sections: string[] = []
  const push = (title: string, stmts: string[]): void => {
    if (stmts.length) sections.push(`-- ── ${title} ──\n${stmts.join('\n')}`)
  }

  push(
    '序列 Sequences',
    (input.sequences ?? []).map((s) => emitSequenceDdl(s, target)).filter(Boolean),
  )

  const tableStmts: string[] = []
  const commentStmts: string[] = []
  for (const t of input.tables) {
    const built = buildTable(t.schema, t.name, t.columns, source, {
      primaryKey: t.primaryKey,
      uniques: t.uniques,
      checks: t.checks,
      comment: t.comment,
    })
    const emitted = emitTable(built.table, target)
    notes.push(...built.notes, ...emitted.notes)
    tableStmts.push(emitted.sql)
    commentStmts.push(...emitTableComments(built.table, target))
  }
  push('表 Tables', tableStmts)
  push('注释 Comments', commentStmts)

  // 表名 → schema,给索引/外键自动补限定名(避免 search_path 依赖)。
  const schemaOf = new Map(input.tables.map((t) => [t.name, t.schema]))

  const ixStmts: string[] = []
  for (const ix of input.indexes ?? []) {
    const e = emitIndex({ ...ix, schema: ix.schema ?? schemaOf.get(ix.table) }, target)
    if (e.sql) ixStmts.push(e.sql)
    notes.push(...e.notes)
  }
  push('索引 Indexes', ixStmts)

  push(
    '外键 Foreign keys',
    (input.foreignKeys ?? [])
      .map((fk) =>
        emitForeignKey(
          {
            ...fk,
            schema: fk.schema ?? schemaOf.get(fk.table),
            refSchema: fk.refSchema ?? schemaOf.get(fk.refTable),
          },
          target,
        ),
      )
      .filter(Boolean),
  )

  return { sql: sections.join('\n\n'), notes: dedupeNotes(notes) }
}

function prefix(col: string, n: ConvertNote): ConvertNote {
  return { level: n.level, msg: `列 ${col}:${n.msg}` }
}

function dedupeNotes(notes: ConvertNote[]): ConvertNote[] {
  const seen = new Set<string>()
  const out: ConvertNote[] = []
  for (const n of notes) {
    const k = `${n.level}|${n.msg}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(n)
    }
  }
  return out
}
