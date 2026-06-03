/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 数据搬运引擎(落地半场)。
 *
 * 结构迁完之后,把源库的行数据分块搬到目标库:
 *   分块读(reader)→ 类型转换 → 批量写(writer)→ 进度回报 → 行数对账。
 *
 * reader / writer 注入(包源/目标连接的 execute),核心循环纯函数、可 mock 单测,
 * 也便于将来换不同的读写策略(COPY、批量 prepared 等)。SQL 构造按方言分。
 */
import { DbDialect as D, type DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'

/** 按 offset/limit 取一批行。 */
export type RowReader = (offset: number, limit: number) => Promise<Array<Record<string, unknown>>>
/** 写入一批行。 */
export type RowWriter = (rows: Array<Record<string, unknown>>) => Promise<void>

export interface CopyOptions {
  /** 每批行数,默认 1000。 */
  batchSize?: number
  signal?: AbortSignal
  onProgress?: (p: { copied: number; batches: number }) => void
}

export interface CopyResult {
  copied: number
  batches: number
  /** 是否被 abort 中断。 */
  aborted: boolean
}

/**
 * 分块搬运一张表:reader 翻页读,writer 批量写,直到读空或被中断。
 * 纯循环,不关心 SQL —— 读写策略由注入的 reader/writer 决定。
 */
export async function copyTable(
  reader: RowReader,
  writer: RowWriter,
  opts: CopyOptions = {},
): Promise<CopyResult> {
  const batch = opts.batchSize ?? 1000
  let offset = 0
  let copied = 0
  let batches = 0
  for (;;) {
    if (opts.signal?.aborted) return { copied, batches, aborted: true }
    const rows = await reader(offset, batch)
    if (!rows.length) break
    await writer(rows)
    copied += rows.length
    batches++
    offset += rows.length
    opts.onProgress?.({ copied, batches })
    if (rows.length < batch) break // 最后一批
  }
  return { copied, batches, aborted: false }
}

// ── 值 → SQL 字面量(类型转换) ──────────────────────────────────

/** 把 JS 值转成目标方言的 SQL 字面量。 */
export function valueLiteral(v: unknown, target: DbDialect): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'boolean') {
    // MySQL 系布尔走 TINYINT;PG/Oracle 用 true/false(Oracle 无布尔但 DM/PG 可)。
    if (familyOf(target) === 'mysql') return v ? '1' : '0'
    return v ? 'true' : 'false'
  }
  if (v instanceof Uint8Array || (typeof Buffer !== 'undefined' && v instanceof Buffer)) {
    return binaryLiteral(v as Uint8Array, target)
  }
  if (v instanceof Date) return `'${v.toISOString()}'`
  if (typeof v === 'object') return quote(JSON.stringify(v)) // json/jsonb 列
  return quote(String(v))
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** 二进制字面量:PG 用 `'\xHEX'`,MySQL 用 `0xHEX`,Oracle/DM 用 `'HEX'`(hextoraw 由列类型隐式)。 */
function binaryLiteral(bytes: Uint8Array, target: DbDialect): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  const fam = familyOf(target)
  if (fam === 'pg') return `'\\x${hex}'`
  if (fam === 'mysql') return `0x${hex || '00'}`
  return `'${hex}'` // oracle/dm:RAW/BLOB 列接收 hex 字符串
}

// ── SQL 构造(分页读 / 批量写) ─────────────────────────────────

/** 标识符限定名(读写都用源/目标各自的引用规则;这里给个通用双引号/反引号版)。 */
function qid(id: string, fam: ReturnType<typeof familyOf>): string {
  if (fam === 'mysql') return `\`${id.replace(/`/g, '``')}\``
  return `"${id.replace(/"/g, '""')}"`
}

function ref(schema: string, table: string, fam: ReturnType<typeof familyOf>): string {
  return `${qid(schema, fam)}.${qid(table, fam)}`
}

/** 分页 SELECT。Oracle 12c+ / DM 用 OFFSET..FETCH;其余用 LIMIT/OFFSET。需要稳定排序键。 */
export function buildPagedSelect(
  dialect: DbDialect,
  schema: string,
  table: string,
  orderBy: string[],
  offset: number,
  limit: number,
): string {
  const fam = familyOf(dialect)
  const r = ref(schema, table, fam)
  const order = orderBy.length ? ` ORDER BY ${orderBy.map((c) => qid(c, fam)).join(', ')}` : ''
  if (fam === 'oracle') {
    return `SELECT * FROM ${r}${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  }
  return `SELECT * FROM ${r}${order} LIMIT ${limit} OFFSET ${offset}`
}

/** 批量 INSERT(多值字面量)。cols 决定列序;rows 缺列按 NULL。 */
export function buildInsert(
  target: DbDialect,
  schema: string,
  table: string,
  cols: string[],
  rows: Array<Record<string, unknown>>,
): string {
  const fam = familyOf(target)
  const r = ref(schema, table, fam)
  const colList = cols.map((c) => qid(c, fam)).join(', ')
  const values = rows
    .map((row) => `(${cols.map((c) => valueLiteral(row[c], target)).join(', ')})`)
    .join(', ')
  return `INSERT INTO ${r} (${colList}) VALUES ${values}`
}

/** 行数对账。 */
export interface Reconcile {
  source: number
  target: number
  ok: boolean
  diff: number
}
export function reconcile(source: number, target: number): Reconcile {
  return { source, target, ok: source === target, diff: target - source }
}

/** count(*) 查询(对账用)。 */
export function buildCount(dialect: DbDialect, schema: string, table: string): string {
  const fam = familyOf(dialect)
  return `SELECT COUNT(*) AS n FROM ${ref(schema, table, fam)}`
}

/** 便于上层判断:这对方言是否有现成的数据搬运 SQL 构造(目前都覆盖)。 */
export function canMigrateData(source: DbDialect, target: DbDialect): boolean {
  return [source, target].every(
    (d) =>
      [D.Oracle, D.DM, D.PostgreSQL, D.Vastbase, D.OpenGauss, D.MySQL].includes(d) ||
      ['pg', 'oracle', 'mysql'].includes(familyOf(d)),
  )
}
