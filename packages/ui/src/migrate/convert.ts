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
import { oracleParser } from './dialects/oracle'
import { postgresEmitter } from './dialects/postgres'
import { type ConvertNote, type DialectEmitter, type DialectParser, type LogicalTable } from './ir'

// ── 方言插件注册表(按 family,一套插件服务整个协议家族) ────────────
const PARSERS: Partial<Record<ReturnType<typeof familyOf>, DialectParser>> = {
  oracle: oracleParser, // Oracle / DM 作源库共用(类型体系一致)
}

const EMITTERS: Partial<Record<ReturnType<typeof familyOf>, DialectEmitter>> = {
  pg: postgresEmitter, // openGauss / Vastbase / MogDB / Panweidb / PostgreSQL …
  oracle: damengEmitter, // DM / Oracle
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
  opts: { primaryKey?: string[]; comment?: string } = {},
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
    lines.push(line)
  }

  if (table.primaryKey?.length) {
    lines.push(`  PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`)
  }

  const ref = `${q(table.schema)}.${q(table.name)}`
  const sql = `CREATE TABLE ${ref} (\n${lines.join(',\n')}\n);`
  return { sql, notes }
}

/** 表的一站式转换:列元数据 → 目标库 CREATE TABLE + 全部告警。 */
export function convertTable(
  schema: string,
  name: string,
  cols: RawColumn[],
  source: DbDialect,
  target: DbDialect,
  opts: { primaryKey?: string[]; comment?: string } = {},
): { sql: string; notes: ConvertNote[] } {
  const built = buildTable(schema, name, cols, source, opts)
  const emitted = emitTable(built.table, target)
  // buildTable 的 notes 已是 parse 期 per-column;emitTable 的是 emit 期。合并去重。
  return { sql: emitted.sql, notes: dedupeNotes([...built.notes, ...emitted.notes]) }
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
