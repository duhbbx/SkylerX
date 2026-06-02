/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移评估 —— 确定性评级引擎。
 *
 * 表对象走 IR 转换(convert.ts),按产出的 ConvertNote 分级打分;
 * 过程体标 needsAi 交 AI;命中无等价能力的判 D。全程纯函数,便于单测。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { convertTable } from './convert'
import type { ConvertNote } from './ir'
import {
  type AssessInput,
  type AssessItem,
  type AssessSummary,
  type CompatGrade,
  PLSQL_KINDS,
} from './types'

/** 无等价能力 —— 命中即判 D(阻断):需业务重构或换方案,比单纯语法难更严重。 */
const BLOCKERS: Array<{ re: RegExp; cap: string }> = [
  { re: /\bSDO_\w+|\bMDSYS\./i, cap: 'Oracle Spatial(空间数据,需评估 PostGIS / 国产空间扩展)' },
  { re: /\bUTL_(HTTP|SMTP|TCP|FILE|URL)\b/i, cap: 'UTL_* 外部交互包(网络/文件 IO,需外部脚本替代)' },
  { re: /\bDBMS_(SCHEDULER|JOB|AQ|CRYPTO)\b/i, cap: 'DBMS_* 高级系统包(调度/队列/加密,需重写)' },
  { re: /\bORGANIZATION\s+INDEX\b/i, cap: '索引组织表(IOT,PG 无等价物理结构)' },
]

function findBlockers(ddl: string): string[] {
  const hit: string[] = []
  for (const { re, cap } of BLOCKERS) if (re.test(ddl)) hit.push(cap)
  return hit
}

/** 由 ConvertNote 最高级别推导表对象等级。 */
function gradeFromNotes(notes: ConvertNote[]): CompatGrade {
  if (notes.some((n) => n.level === 'blocker')) return 'D'
  if (notes.some((n) => n.level === 'review')) return 'C'
  if (notes.some((n) => n.level === 'info')) return 'B'
  return 'A'
}

/** 评估单个对象。 */
export function assessItem(input: AssessInput, source: DbDialect, target: DbDialect): AssessItem {
  const ddl = input.ddl ?? ''
  const blockers = findBlockers(ddl)
  const isProcedural = PLSQL_KINDS.has(input.kind)

  // 过程体:不做确定性转换,直接交 AI(命中阻断则 D)。
  if (isProcedural) {
    const grade: CompatGrade = blockers.length ? 'D' : 'C'
    return {
      ...input,
      grade,
      converted: '',
      notes: blockers.map((b) => ({ level: 'blocker' as const, msg: b })),
      blockers,
      needsAi: grade === 'C',
    }
  }

  // 表对象:走 IR 确定性转换,按 notes 分级。
  if (input.kind === 'table' && input.columns?.length) {
    const { sql, notes } = convertTable(input.schema, input.name, input.columns, source, target, {
      primaryKey: input.primaryKey,
    })
    const allNotes = blockers.length
      ? [...notes, ...blockers.map((b) => ({ level: 'blocker' as const, msg: b }))]
      : notes
    return {
      ...input,
      grade: gradeFromNotes(allNotes),
      converted: sql,
      notes: allNotes,
      blockers,
      needsAi: false,
    }
  }

  // 其余(sequence/synonym/index 等简单对象,或缺列元数据的表):保守判 B,无需 AI。
  const grade: CompatGrade = blockers.length ? 'D' : 'B'
  return {
    ...input,
    grade,
    converted: '',
    notes: blockers.map((b) => ({ level: 'blocker' as const, msg: b })),
    blockers,
    needsAi: false,
  }
}

const GRADE_SCORE: Record<CompatGrade, number> = { A: 100, B: 80, C: 40, D: 0 }

/** 批量评估并汇总。 */
export function assessBatch(
  inputs: AssessInput[],
  source: DbDialect,
  target: DbDialect,
): AssessSummary {
  const items = inputs.map((i) => assessItem(i, source, target))
  const byGrade: Record<CompatGrade, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const it of items) byGrade[it.grade]++

  const readiness = items.length
    ? Math.round(items.reduce((s, it) => s + GRADE_SCORE[it.grade], 0) / items.length)
    : 100
  const aiCandidates = items.filter((it) => it.needsAi).length

  return { source, target, items, byGrade, readiness, aiCandidates }
}
