/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

/**
 * 结构对比引擎（纯函数，可测）。
 *
 * 输入两侧的「表快照」（表名 + 列定义），算出差异，并生成把目标改成与源一致的迁移 SQL。
 * 仅比较结构（表/列），不涉及数据。UI 层负责从 DataClient 元数据映射成快照。
 */
export interface ColumnSnapshot {
  name: string
  dataType: string
  nullable: boolean
  primaryKey?: boolean
  defaultValue?: string | null
}

export interface TableSnapshot {
  name: string
  /** 可直接用于 SQL 的限定名（缺省用 name 转义） */
  sqlName?: string
  columns: ColumnSnapshot[]
}

export type ColumnChangeKind = 'add' | 'drop' | 'modify'

export interface ColumnChange {
  kind: ColumnChangeKind
  column: string
  /** 目标当前列（drop/modify 时有） */
  from?: ColumnSnapshot
  /** 源期望列（add/modify 时有） */
  to?: ColumnSnapshot
}

export type TableDiffStatus = 'added' | 'removed' | 'changed'

export interface TableDiff {
  table: string
  sqlName?: string
  /** added=仅源有(需建表)；removed=仅目标有；changed=两侧都有但列有差异 */
  status: TableDiffStatus
  columnChanges?: ColumnChange[]
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function columnsDiffer(a: ColumnSnapshot, b: ColumnSnapshot): boolean {
  return (
    norm(a.dataType) !== norm(b.dataType) ||
    !!a.nullable !== !!b.nullable ||
    !!a.primaryKey !== !!b.primaryKey ||
    norm(a.defaultValue) !== norm(b.defaultValue)
  )
}

/** 计算把 target 改成与 source 一致所需的差异。 */
export function diffSchemas(source: TableSnapshot[], target: TableSnapshot[]): TableDiff[] {
  const srcMap = new Map(source.map((t) => [t.name, t]))
  const tgtMap = new Map(target.map((t) => [t.name, t]))
  const diffs: TableDiff[] = []

  for (const s of source) {
    const t = tgtMap.get(s.name)
    if (!t) {
      diffs.push({ table: s.name, sqlName: s.sqlName, status: 'added' })
      continue
    }
    const changes: ColumnChange[] = []
    const tCols = new Map(t.columns.map((c) => [c.name, c]))
    const sCols = new Map(s.columns.map((c) => [c.name, c]))
    for (const sc of s.columns) {
      const tc = tCols.get(sc.name)
      if (!tc) changes.push({ kind: 'add', column: sc.name, to: sc })
      else if (columnsDiffer(sc, tc))
        changes.push({ kind: 'modify', column: sc.name, from: tc, to: sc })
    }
    for (const tc of t.columns) {
      if (!sCols.has(tc.name)) changes.push({ kind: 'drop', column: tc.name, from: tc })
    }
    if (changes.length) {
      diffs.push({ table: s.name, sqlName: s.sqlName, status: 'changed', columnChanges: changes })
    }
  }

  for (const t of target) {
    if (!srcMap.has(t.name)) diffs.push({ table: t.name, sqlName: t.sqlName, status: 'removed' })
  }

  return diffs
}

type Family = 'mysql' | 'pg' | 'other'
function familyOf(d: DbDialect): Family {
  if ([DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.CockroachDB,
      DbDialect.Greenplum,
      DbDialect.OpenGauss,
      DbDialect.H2,
    ].includes(d)
  )
    return 'pg'
  return 'other'
}

function columnDef(dialect: DbDialect, c: ColumnSnapshot): string {
  const q = (s: string) => quoteId(dialect, s)
  let def = `${q(c.name)} ${c.dataType}`
  if (!c.nullable) def += ' NOT NULL'
  if (c.defaultValue != null && c.defaultValue !== '') def += ` DEFAULT ${c.defaultValue}`
  return def
}

/** 生成「把目标改成与源一致」的迁移 SQL；DROP 类操作以注释给出，避免误删。 */
export function generateMigration(
  diffs: TableDiff[],
  dialect: DbDialect,
  source: TableSnapshot[],
): string {
  const q = (s: string) => quoteId(dialect, s)
  const fam = familyOf(dialect)
  const srcMap = new Map(source.map((t) => [t.name, t]))
  const ref = (d: TableDiff) => d.sqlName ?? q(d.table)
  const out: string[] = []

  for (const d of diffs) {
    if (d.status === 'added') {
      const s = srcMap.get(d.table)
      if (!s) continue
      const lines = s.columns.map((c) => `  ${columnDef(dialect, c)}`)
      const pks = s.columns.filter((c) => c.primaryKey).map((c) => q(c.name))
      if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)
      out.push(`-- [新增表] ${d.table}\nCREATE TABLE ${ref(d)} (\n${lines.join(',\n')}\n);`)
    } else if (d.status === 'removed') {
      out.push(`-- [仅目标有] ${d.table}（未自动删除，确认后手动执行）\n-- DROP TABLE ${ref(d)};`)
    } else {
      const stmts: string[] = []
      for (const ch of d.columnChanges ?? []) {
        if (ch.kind === 'add' && ch.to) {
          stmts.push(`ALTER TABLE ${ref(d)} ADD COLUMN ${columnDef(dialect, ch.to)};`)
        } else if (ch.kind === 'drop') {
          stmts.push(`-- 删列需谨慎：ALTER TABLE ${ref(d)} DROP COLUMN ${q(ch.column)};`)
        } else if (ch.kind === 'modify' && ch.to) {
          if (fam === 'mysql') {
            stmts.push(`ALTER TABLE ${ref(d)} MODIFY COLUMN ${columnDef(dialect, ch.to)};`)
          } else if (fam === 'pg') {
            stmts.push(`ALTER TABLE ${ref(d)} ALTER COLUMN ${q(ch.column)} TYPE ${ch.to.dataType};`)
            stmts.push(
              `ALTER TABLE ${ref(d)} ALTER COLUMN ${q(ch.column)} ${ch.to.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
            )
          } else {
            stmts.push(`-- 请手动调整列 ${ch.column} 为：${columnDef(dialect, ch.to)}`)
          }
        }
      }
      if (stmts.length) out.push(`-- [改表] ${d.table}\n${stmts.join('\n')}`)
    }
  }

  return out.join('\n\n')
}
