/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创「去O」迁移评估 —— 评估层共享类型。
 *
 * 评估把每个源库对象映射成 {@link AssessItem},按可迁移难度打 {@link CompatGrade},
 * 汇总成 {@link AssessSummary}。结构对象走确定性 IR 转换(convert.ts),
 * 过程体标 needsAi 交 AI(aiConvert.ts)。
 */
import type { DbDialect } from '@db-tool/shared-types'
import type { RawColumn } from './convert'
import type { ConvertNote } from './ir'

/** 迁移对象的大类(决定走确定性 IR 还是 AI)。 */
export type MigrateObjectKind =
  | 'table'
  | 'view'
  | 'index'
  | 'sequence'
  | 'synonym'
  | 'function'
  | 'procedure'
  | 'package'
  | 'trigger'
  | 'type'
  | 'other'

/** 含 PL/SQL 过程化代码、确定性 IR 覆盖不到、需要 AI 的对象类型。 */
export const PLSQL_KINDS: ReadonlySet<MigrateObjectKind> = new Set([
  'view',
  'function',
  'procedure',
  'package',
  'trigger',
  'type',
])

/** 可迁移难度等级。 */
export type CompatGrade = 'A' | 'B' | 'C' | 'D'

export const GRADE_LABEL: Record<CompatGrade, [zh: string, en: string]> = {
  A: ['自动', 'Auto'],
  B: ['辅助', 'Assisted'],
  C: ['人工', 'Manual'],
  D: ['阻断', 'Blocked'],
}

/**
 * 评估输入:一个待迁移对象。
 *  - 表:优先给 columns(catalog 元数据,确定性 IR 走结构化路径)
 *  - 其余(视图/过程/包/触发器/类型):给 ddl 原文,交 AI
 */
export interface AssessInput {
  kind: MigrateObjectKind
  schema: string
  name: string
  /** 结构化列元数据(表对象用)。 */
  columns?: RawColumn[]
  primaryKey?: string[]
  /** 源 DDL 原文(过程体用;表也可带着供展示)。 */
  ddl?: string
}

/** 单个对象的评估结果。 */
export interface AssessItem extends AssessInput {
  grade: CompatGrade
  /** 确定性转换产出(表 → 目标 CREATE TABLE);需 AI 的对象此处为空。 */
  converted: string
  /** 语义差 / 复核提示(带分级)。 */
  notes: ConvertNote[]
  /** 命中的阻断级能力描述;非空即判 D。 */
  blockers: string[]
  /** 是否建议交给 AI 翻译。 */
  needsAi: boolean
}

/** 整库评估汇总。 */
export interface AssessSummary {
  source: DbDialect
  target: DbDialect
  items: AssessItem[]
  byGrade: Record<CompatGrade, number>
  /** 0–100 就绪度(A=100,B=80,C=40,D=0 加权均值)。 */
  readiness: number
  aiCandidates: number
}

/** AI 转换单个对象的结果(只读 / 供复核)。 */
export interface ConvertResult {
  schema: string
  name: string
  kind: MigrateObjectKind
  sql: string
  notes: string
  error?: string
  /** 是否在目标库事务内校验通过(undefined=未校验:目标库不支持或未启用)。 */
  validated?: boolean
  /** 校验未通过时的目标库报错。 */
  validationError?: string
  /** AI 尝试次数(首次 + 自修复重试)。 */
  attempts?: number
}
