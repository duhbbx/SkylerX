import type { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

/**
 * 测试数据生成（纯逻辑，可测）。按列类型推断生成器，产出多行 INSERT。
 * 主键的整数列用自增序号避免冲突；值为随机，供开发/压测造数。
 */
export interface MockColumn {
  name: string
  type: string
  pk?: boolean
}

const WORDS = ['alpha', 'bravo', 'delta', 'echo', 'kilo', 'lima', 'nova', 'zulu', 'orion', 'vega']
function randWord(): string {
  return `${WORDS[Math.floor(Math.random() * WORDS.length)]}_${Math.floor(Math.random() * 1000)}`
}
function randDate(): Date {
  return new Date(Date.now() - Math.floor(Math.random() * 3.15e10)) // 近一年内
}
function uuid(): string {
  const c = globalThis.crypto
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 单列单行的 SQL 字面量。i 为行序号（从 0 起，用于主键自增）。 */
export function mockValue(type: string, i: number, pk = false): string {
  const t = (type || '').toLowerCase()
  if (pk && /(^|\b)(int|serial|bigint|smallint|number|numeric)/.test(t)) return String(i + 1)
  if (/serial|int(eger)?|bigint|smallint|tinyint/.test(t)) return String(Math.floor(Math.random() * 100000))
  if (/decimal|numeric|float|double|real|money/.test(t)) return (Math.random() * 1000).toFixed(2)
  if (/bool/.test(t)) return Math.random() < 0.5 ? 'TRUE' : 'FALSE'
  if (/datetime|timestamp/.test(t)) return `'${randDate().toISOString().slice(0, 19).replace('T', ' ')}'`
  if (/date/.test(t)) return `'${randDate().toISOString().slice(0, 10)}'`
  if (/time/.test(t)) return `'${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:00:00'`
  if (/uuid|uniqueidentifier/.test(t)) return `'${uuid()}'`
  if (/json/.test(t)) return `'{"k":"${randWord()}"}'`
  return `'${randWord()}'` // char/varchar/text/其它
}

/** 生成 count 行的多值 INSERT（按 chunk 折行，避免单条过长）。 */
export function buildMockInserts(
  dialect: DbDialect,
  tableRef: string,
  cols: MockColumn[],
  count: number,
  chunk = 100,
): string {
  const usable = cols.filter((c) => c.name)
  if (!usable.length || count < 1) return ''
  const colList = usable.map((c) => quoteId(dialect, c.name)).join(', ')
  const out: string[] = []
  for (let start = 0; start < count; start += chunk) {
    const rows: string[] = []
    for (let i = start; i < Math.min(start + chunk, count); i++) {
      rows.push(`(${usable.map((c) => mockValue(c.type, i, c.pk)).join(', ')})`)
    }
    out.push(`INSERT INTO ${tableRef} (${colList}) VALUES\n  ${rows.join(',\n  ')};`)
  }
  return out.join('\n\n')
}
