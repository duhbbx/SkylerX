/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 源库结构读取器(introspection)。
 *
 * 把一个源 schema 的完整结构(表 + 列 + 主键/唯一/检查 + 注释 + 索引 + 外键 + 序列)
 * 读成 {@link SchemaInput},喂给 convert.ts 的 convertSchema 生成整库 DDL,
 * 也供 apply.ts 在目标库执行。每个源方言一个 reader(hub-and-spoke 一致)。
 *
 * reader 吃注入的 ProfileExec(包源连接 execute),纯查询、可 mock。
 */
import { DbDialect as D, type DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'
import type { RawColumn, SchemaInput, SchemaTableInput } from './convert'
import type { LogicalForeignKey, LogicalIndex, LogicalSequence } from './ir'
import { type ProfileExec, lit } from './profile'

export interface SchemaReader {
  dialect: DbDialect
  readSchema(exec: ProfileExec, schema: string): Promise<SchemaInput>
}

const str = (v: unknown): string => (v == null ? '' : String(v))
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** confdeltype(PG)→ ON DELETE 子句。 */
function pgDeleteRule(t: string): string | undefined {
  switch (t) {
    case 'c':
      return 'CASCADE'
    case 'n':
      return 'SET NULL'
    case 'd':
      return 'SET DEFAULT'
    case 'r':
      return 'RESTRICT'
    default:
      return undefined // 'a' = NO ACTION(缺省)
  }
}

/** 从 `CHECK ((expr))` 抽出 expr。 */
function checkExpr(def: string): string {
  const m = /^CHECK\s*\((.*)\)\s*$/is.exec(def.trim())
  return (m ? m[1] : def).trim()
}

/**
 * 从 pg_get_indexdef 抽列清单。openGauss 输出形如
 * `CREATE INDEX i ON s.t USING btree (dept_id) TABLESPACE pg_default`,
 * 取 `USING <method> (...)` 的括号内容(末尾可能跟 TABLESPACE)。函数索引返回表达式。
 */
function indexColsFromDef(def: string): { columns: string[]; expr?: string } {
  const m = /USING\s+\w+\s*\((.*)\)(?:\s+TABLESPACE\b.*)?$/is.exec(def.trim())
  if (!m) return { columns: [] }
  const inner = m[1].trim()
  // 纯列名列表(逗号分隔、无函数调用)走 columns,否则当表达式
  if (/^[\w",\s]+$/.test(inner)) {
    return {
      columns: inner
        .split(',')
        .map((c) => c.trim().replace(/^"|"$/g, ''))
        .filter(Boolean),
    }
  }
  return { columns: [], expr: inner }
}

// ── PG 系 reader ────────────────────────────────────────────────
async function readPg(exec: ProfileExec, schema: string): Promise<SchemaInput> {
  const s = lit(schema)

  // 1) 列(format_type 给规范类型串,parsePgType 能直接吃)
  const colRows = await exec(
    `SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS typ,
            a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS dflt,
            col_description(c.oid, a.attnum::int) AS cmt
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = ${s} AND c.relkind IN ('r','p')
     ORDER BY c.relname, a.attnum`,
  )
  const tableMap = new Map<string, SchemaTableInput>()
  const tableFor = (name: string): SchemaTableInput => {
    let t = tableMap.get(name)
    if (!t) {
      t = { schema, name, columns: [], primaryKey: [], uniques: [], checks: [] }
      tableMap.set(name, t)
    }
    return t
  }
  for (const r of colRows) {
    const col: RawColumn = {
      name: str(r.col),
      dataType: str(r.typ),
      nullable: !r.notnull,
      default: r.dflt == null ? undefined : str(r.dflt),
      comment: r.cmt == null ? undefined : str(r.cmt),
    }
    tableFor(str(r.tbl)).columns.push(col)
  }

  // 2) 表注释
  const tcom = await exec(
    `SELECT c.relname AS tbl, obj_description(c.oid, 'pg_class') AS cmt
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${s} AND c.relkind IN ('r','p')`,
  )
  for (const r of tcom)
    if (r.cmt != null && tableMap.has(str(r.tbl))) tableFor(str(r.tbl)).comment = str(r.cmt)

  // 3) 约束:主键/唯一/检查/外键(列顺序用 generate_series 保序,openGauss 9.2 安全)
  const foreignKeys: LogicalForeignKey[] = []
  const conRows = await exec(
    `SELECT con.conname AS name, con.contype AS t, c.relname AS tbl,
       (SELECT string_agg(att.attname, ',' ORDER BY x.i)
        FROM generate_series(1, COALESCE(array_length(con.conkey,1),0)) x(i)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[x.i]) AS cols,
       con.confrelid::regclass::text AS reftbl,
       (SELECT string_agg(att.attname, ',' ORDER BY x.i)
        FROM generate_series(1, COALESCE(array_length(con.confkey,1),0)) x(i)
        JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = con.confkey[x.i]) AS refcols,
       con.confdeltype AS deltype, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = con.connamespace
     WHERE n.nspname = ${s} AND con.contype IN ('p','u','c','f')`,
  )
  for (const r of conRows) {
    const tbl = str(r.tbl)
    const cols = str(r.cols).split(',').filter(Boolean)
    const t = str(r.t)
    if (t === 'p') tableFor(tbl).primaryKey = cols
    else if (t === 'u') tableFor(tbl).uniques?.push({ name: str(r.name), columns: cols })
    else if (t === 'c')
      tableFor(tbl).checks?.push({ name: str(r.name), expr: checkExpr(str(r.def)) })
    else if (t === 'f') {
      const reftbl = str(r.reftbl)
        .replace(/^[^.]*\./, '')
        .replace(/"/g, '') // strip schema qualifier
      foreignKeys.push({
        name: str(r.name),
        table: tbl,
        schema,
        columns: cols,
        refTable: reftbl,
        refSchema: schema,
        refColumns: str(r.refcols).split(',').filter(Boolean),
        onDelete: pgDeleteRule(str(r.deltype)),
      })
    }
  }

  // 4) 索引(排除约束背后的索引,避免和 PK/UNIQUE 重复)
  const indexes: LogicalIndex[] = []
  const ixRows = await exec(
    `SELECT c.relname AS tbl, ic.relname AS idx, i.indisunique AS uniq, pg_get_indexdef(i.indexrelid) AS def
     FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${s} AND NOT i.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)`,
  )
  for (const r of ixRows) {
    const { columns, expr } = indexColsFromDef(str(r.def))
    indexes.push({ name: str(r.idx), table: str(r.tbl), schema, columns, expr, unique: !!r.uniq })
  }

  // 5) 序列(openGauss 9.2 拿不全参数,先列名;START/INCREMENT 缺省)
  const sequences: LogicalSequence[] = []
  const seqRows = await exec(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${s} AND c.relkind = 'S'`,
  )
  for (const r of seqRows) sequences.push({ kind: 'sequence', schema, name: str(r.name) })

  return { tables: [...tableMap.values()], sequences, indexes, foreignKeys }
}

export const postgresReader: SchemaReader = { dialect: D.PostgreSQL, readSchema: readPg }

// ── Oracle / DM 系 reader ───────────────────────────────────────
/** 由 all_tab_columns 行重建 Oracle 类型串(parseType 能直接吃)。 */
export function oracleColType(r: Record<string, unknown>): string {
  const dt = str(r.data_type ?? r.DATA_TYPE).toUpperCase()
  const len = num(r.char_length ?? r.CHAR_LENGTH) || num(r.data_length ?? r.DATA_LENGTH)
  const p = r.data_precision ?? r.DATA_PRECISION
  const s = r.data_scale ?? r.DATA_SCALE
  if (['VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR', 'RAW'].includes(dt)) return `${dt}(${len})`
  if (dt === 'NUMBER') {
    if (p == null) return 'NUMBER'
    return num(s) ? `NUMBER(${num(p)},${num(s)})` : `NUMBER(${num(p)})`
  }
  if (dt === 'FLOAT') return p != null ? `FLOAT(${num(p)})` : 'FLOAT'
  return dt // DATE / CLOB / BLOB / 'TIMESTAMP(6)'(data_type 已含精度)等
}

/** 系统自动生成的 NOT NULL 检查约束(随列 nullable 已表达),不当作 CHECK。 */
function isNotNullCheck(cond: string): boolean {
  return /^\s*"?\w+"?\s+IS\s+NOT\s+NULL\s*$/i.test(cond)
}

async function readOracle(exec: ProfileExec, schema: string): Promise<SchemaInput> {
  const owner = lit(schema)
  const g = (r: Record<string, unknown>, k: string): unknown => r[k] ?? r[k.toUpperCase()]

  // 1) 列
  const colRows = await exec(
    `SELECT table_name AS tbl, column_name AS col, data_type, data_length, data_precision,
            data_scale, char_length, nullable, data_default
     FROM all_tab_columns WHERE owner = ${owner} ORDER BY table_name, column_id`,
  )
  const tableMap = new Map<string, SchemaTableInput>()
  const tableFor = (name: string): SchemaTableInput => {
    let t = tableMap.get(name)
    if (!t) {
      t = { schema, name, columns: [], primaryKey: [], uniques: [], checks: [] }
      tableMap.set(name, t)
    }
    return t
  }
  for (const r of colRows) {
    const def = g(r, 'data_default')
    tableFor(str(g(r, 'tbl'))).columns.push({
      name: str(g(r, 'col')),
      dataType: oracleColType(r),
      nullable: str(g(r, 'nullable')).toUpperCase() !== 'N',
      default: def == null ? undefined : str(def).trim(),
    })
  }

  // 2) 注释
  const colCom = await exec(
    `SELECT table_name AS tbl, column_name AS col, comments FROM all_col_comments WHERE owner = ${owner} AND comments IS NOT NULL`,
  )
  for (const r of colCom) {
    const t = tableMap.get(str(g(r, 'tbl')))
    const col = t?.columns.find((c) => c.name === str(g(r, 'col')))
    if (col) col.comment = str(g(r, 'comments'))
  }
  const tabCom = await exec(
    `SELECT table_name AS tbl, comments FROM all_tab_comments WHERE owner = ${owner} AND comments IS NOT NULL`,
  )
  for (const r of tabCom) {
    if (tableMap.has(str(g(r, 'tbl')))) tableFor(str(g(r, 'tbl'))).comment = str(g(r, 'comments'))
  }

  // 3) 约束列(按 position 保序)
  const ccRows = await exec(
    `SELECT constraint_name AS cn, column_name AS col, position FROM all_cons_columns WHERE owner = ${owner} ORDER BY constraint_name, position`,
  )
  const ccMap = new Map<string, string[]>()
  for (const r of ccRows) {
    const cn = str(g(r, 'cn'))
    if (!ccMap.has(cn)) ccMap.set(cn, [])
    ccMap.get(cn)?.push(str(g(r, 'col')))
  }

  // 4) 约束(主键/唯一/检查/外键;FK 引用表用自连接拿)
  const foreignKeys: LogicalForeignKey[] = []
  const conRows = await exec(
    `SELECT c.constraint_name AS cn, c.constraint_type AS ct, c.table_name AS tbl,
            c.search_condition AS sc, c.r_constraint_name AS rcn, c.delete_rule AS dr,
            rc.table_name AS rtbl
     FROM all_constraints c
     LEFT JOIN all_constraints rc ON rc.owner = c.r_owner AND rc.constraint_name = c.r_constraint_name
     WHERE c.owner = ${owner} AND c.constraint_type IN ('P','U','C','R')`,
  )
  for (const r of conRows) {
    const cn = str(g(r, 'cn'))
    const ct = str(g(r, 'ct')).toUpperCase()
    const tbl = str(g(r, 'tbl'))
    const cols = ccMap.get(cn) ?? []
    if (ct === 'P') tableFor(tbl).primaryKey = cols
    else if (ct === 'U') tableFor(tbl).uniques?.push({ name: cn, columns: cols })
    else if (ct === 'C') {
      const cond = str(g(r, 'sc'))
      if (cond && !isNotNullCheck(cond)) tableFor(tbl).checks?.push({ name: cn, expr: cond })
    } else if (ct === 'R') {
      foreignKeys.push({
        name: cn,
        table: tbl,
        schema,
        columns: cols,
        refTable: str(g(r, 'rtbl')),
        refSchema: schema,
        refColumns: ccMap.get(str(g(r, 'rcn'))) ?? [],
        onDelete: str(g(r, 'dr')).toUpperCase() === 'CASCADE' ? 'CASCADE' : undefined,
      })
    }
  }

  // 5) 索引(排除约束背后的索引)
  const conNames = new Set(conRows.map((r) => str(g(r, 'cn'))))
  const indexes: LogicalIndex[] = []
  const idxCols = await exec(
    `SELECT index_name AS idx, column_name AS col, column_position AS pos FROM all_ind_columns WHERE index_owner = ${owner} ORDER BY index_name, column_position`,
  )
  const idxColMap = new Map<string, string[]>()
  for (const r of idxCols) {
    const idx = str(g(r, 'idx'))
    if (!idxColMap.has(idx)) idxColMap.set(idx, [])
    idxColMap.get(idx)?.push(str(g(r, 'col')))
  }
  const idxRows = await exec(
    `SELECT index_name AS idx, table_name AS tbl, uniqueness AS uniq FROM all_indexes WHERE owner = ${owner}`,
  )
  for (const r of idxRows) {
    const idx = str(g(r, 'idx'))
    if (conNames.has(idx)) continue // 约束背后的索引,跳过
    indexes.push({
      name: idx,
      table: str(g(r, 'tbl')),
      schema,
      columns: idxColMap.get(idx) ?? [],
      unique: str(g(r, 'uniq')).toUpperCase() === 'UNIQUE',
    })
  }

  // 6) 序列
  const sequences: LogicalSequence[] = []
  const seqRows = await exec(
    `SELECT sequence_name AS name, min_value, increment_by, cache_size, cycle_flag, last_number
     FROM all_sequences WHERE sequence_owner = ${owner}`,
  ).catch(() => [])
  for (const r of seqRows) {
    sequences.push({
      kind: 'sequence',
      schema,
      name: str(g(r, 'name')),
      start: num(g(r, 'last_number')) || undefined,
      increment: num(g(r, 'increment_by')) || undefined,
      cache: num(g(r, 'cache_size')) || undefined,
      cycle: str(g(r, 'cycle_flag')).toUpperCase() === 'Y',
    })
  }

  return { tables: [...tableMap.values()], sequences, indexes, foreignKeys }
}

export const oracleReader: SchemaReader = { dialect: D.Oracle, readSchema: readOracle }

// ── 注册表 + 入口 ───────────────────────────────────────────────
const READERS: Partial<Record<ReturnType<typeof familyOf>, SchemaReader>> = {
  pg: postgresReader,
  oracle: oracleReader, // Oracle / DM 共用(数据字典视图一致)
}

export function readerFor(dialect: DbDialect): SchemaReader | null {
  return READERS[familyOf(dialect)] ?? null
}

export function canIntrospect(dialect: DbDialect): boolean {
  return !!readerFor(dialect)
}

/** 读取一个源 schema 的完整结构(无 reader 返回空)。 */
export async function readSchema(
  exec: ProfileExec,
  dialect: DbDialect,
  schema: string,
): Promise<SchemaInput> {
  const reader = readerFor(dialect)
  if (!reader) return { tables: [], sequences: [], indexes: [], foreignKeys: [] }
  return reader.readSchema(exec, schema)
}
