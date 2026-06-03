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

/** 占位符:PG `$n`、Oracle/DM `:n`(1 起)、MySQL `?`。i 为语句内 0 起序号。 */
export function placeholder(fam: ReturnType<typeof familyOf>, i: number): string {
  if (fam === 'pg') return `$${i + 1}`
  if (fam === 'oracle') return `:${i + 1}`
  return '?' // mysql
}

/**
 * 参数化批量 INSERT。值走绑定参数(驱动负责类型/转义,二进制/大文本/特殊字符都安全),
 * 不拼字面量。返回 { sql, params },上层 execute(connId, sql, params)。
 */
export function buildInsertParams(
  target: DbDialect,
  schema: string,
  table: string,
  cols: string[],
  rows: Array<Record<string, unknown>>,
  opts: { onConflict?: string[] } = {},
): { sql: string; params: unknown[] } {
  const fam = familyOf(target)
  const r = ref(schema, table, fam)
  const colList = cols.map((c) => qid(c, fam)).join(', ')
  const params: unknown[] = []
  const tuples = rows.map(
    (row) =>
      `(${cols
        .map((c) => {
          params.push(row[c] ?? null)
          return placeholder(fam, params.length - 1)
        })
        .join(', ')})`,
  )
  // 增量/可重复跑:主键冲突跳过(PG ON CONFLICT / MySQL INSERT IGNORE);Oracle/DM 无直接对应,退化为普通 INSERT
  const oc = opts.onConflict
  if (oc?.length && fam === 'mysql') {
    return { sql: `INSERT IGNORE INTO ${r} (${colList}) VALUES ${tuples.join(', ')}`, params }
  }
  let tail = ''
  if (oc?.length && fam === 'pg') {
    tail = ` ON CONFLICT (${oc.map((c) => qid(c, fam)).join(', ')}) DO NOTHING`
  }
  return { sql: `INSERT INTO ${r} (${colList}) VALUES ${tuples.join(', ')}${tail}`, params }
}

/** 该目标方言是否支持「冲突跳过」式增量(PG ON CONFLICT / MySQL INSERT IGNORE)。 */
export function supportsConflictSkip(target: DbDialect): boolean {
  const fam = familyOf(target)
  return fam === 'pg' || fam === 'mysql'
}

/**
 * 限并发跑一批任务(并行搬表用)。worker 抛错不中断整体(吞掉,由 worker 自己记状态)。
 * signal 中断后不再领新任务。
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0
  const n = Math.max(1, Math.min(concurrency, items.length))
  const runners = Array.from({ length: n }, async () => {
    for (;;) {
      if (signal?.aborted) return
      const i = next++
      if (i >= items.length) return
      try {
        await worker(items[i], i)
      } catch {
        /* worker 自行记错;不让单表失败拖垮整池 */
      }
    }
  })
  await Promise.all(runners)
}

/** 一条 INSERT 最多放几行:PG 受 65535 参数上限约束,其余保守限包大小。 */
export function maxRowsPerInsert(target: DbDialect, colCount: number): number {
  const cols = Math.max(1, colCount)
  const cap = familyOf(target) === 'pg' ? 65000 : 1000 // pg 硬上限 65535;其余按包/解析保守
  return Math.max(1, Math.floor(cap / cols))
}

/** 把一批行切成多个子批(每批 ≤ n 行),避免超参数上限 / 包大小。 */
export function chunkRows<T>(rows: T[], n: number): T[][] {
  if (rows.length <= n) return rows.length ? [rows] : []
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n))
  return out
}

/** 批量 INSERT(多值字面量)。cols 决定列序;rows 缺列按 NULL。仅用于预览/导出;搬运走参数化。 */
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

// ── 列级对账(行数之上:每列 非空数 / 最小 / 最大) ─────────────────

/** min/max 转文本(跨库可比、避开驱动类型差异);各方言转换函数不同。 */
function castText(expr: string, fam: ReturnType<typeof familyOf>): string {
  if (fam === 'oracle') return `TO_CHAR(${expr})`
  if (fam === 'mysql') return `CAST(${expr} AS CHAR)`
  return `(${expr})::text` // pg
}

export interface ColumnStat {
  column: string
  nonNull: number
  min: string | null
  max: string | null
}

/**
 * 一条查询拿一张表所选列的统计:每列 非空数 / 最小 / 最大(转文本)。
 * 调用方应只传可比较的列(跳过 BLOB/CLOB/JSON)。
 */
export function buildColumnStats(
  dialect: DbDialect,
  schema: string,
  table: string,
  columns: string[],
): string {
  const fam = familyOf(dialect)
  const sel = columns.flatMap((c) => {
    const q = qid(c, fam)
    return [
      `COUNT(${q}) AS ${qid(`${c}__nn`, fam)}`,
      `${castText(`MIN(${q})`, fam)} AS ${qid(`${c}__mn`, fam)}`,
      `${castText(`MAX(${q})`, fam)} AS ${qid(`${c}__mx`, fam)}`,
    ]
  })
  return `SELECT ${sel.join(', ')} FROM ${ref(schema, table, fam)}`
}

/** 解析 buildColumnStats 的单行结果为每列统计。 */
export function parseColumnStats(row: Record<string, unknown>, columns: string[]): ColumnStat[] {
  const get = (k: string): unknown => row[k] ?? row[k.toUpperCase()]
  return columns.map((c) => ({
    column: c,
    nonNull: Number(get(`${c}__nn`) ?? 0),
    min: get(`${c}__mn`) == null ? null : String(get(`${c}__mn`)),
    max: get(`${c}__mx`) == null ? null : String(get(`${c}__mx`)),
  }))
}

export interface StatDiff {
  column: string
  ok: boolean
  detail?: string
}

/** 比对源/目标的列统计,逐列给一致性结论。 */
export function compareColumnStats(
  src: ColumnStat[],
  tgt: ColumnStat[],
): {
  ok: boolean
  diffs: StatDiff[]
} {
  const tgtByCol = new Map(tgt.map((s) => [s.column, s]))
  const diffs: StatDiff[] = src.map((s) => {
    const t = tgtByCol.get(s.column)
    if (!t) return { column: s.column, ok: false, detail: '目标缺该列' }
    const probs: string[] = []
    if (s.nonNull !== t.nonNull) probs.push(`非空数 ${s.nonNull}→${t.nonNull}`)
    if (s.min !== t.min) probs.push(`min ${s.min}→${t.min}`)
    if (s.max !== t.max) probs.push(`max ${s.max}→${t.max}`)
    return { column: s.column, ok: probs.length === 0, detail: probs.join('; ') || undefined }
  })
  return { ok: diffs.every((d) => d.ok), diffs }
}

/** 便于上层判断:这对方言是否有现成的数据搬运 SQL 构造(目前都覆盖)。 */
export function canMigrateData(source: DbDialect, target: DbDialect): boolean {
  return [source, target].every(
    (d) =>
      [D.Oracle, D.DM, D.PostgreSQL, D.Vastbase, D.OpenGauss, D.MySQL].includes(d) ||
      ['pg', 'oracle', 'mysql'].includes(familyOf(d)),
  )
}
