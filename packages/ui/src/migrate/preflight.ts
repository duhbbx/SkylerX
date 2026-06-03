/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 数据搬运前的预检(pre-flight)。
 *
 * 搬一半失败最难受。开搬前先比对每张表在目标库的状态:目标表存在吗?列齐吗?
 * 有主键吗(对账/增量要用)?目标已有数据吗(全量会重复)?不合格的标 error/warn,
 * 让用户先建库 / 改配置,别浪费一次大搬运。
 *
 * 纯函数 checkTable 接收源表 + 目标表信息,产出问题清单;目标信息由上层查好传入。
 */
export interface PreflightIssue {
  table: string
  level: 'error' | 'warn'
  msg: string
}

/** 目标库里一张表的状态(由 introspect / count 查好)。 */
export interface TargetTableInfo {
  exists: boolean
  /** 目标表列名(用于比对源列是否都在)。 */
  columns: string[]
  /** 目标表当前行数(用于「目标非空」告警)。 */
  rowCount?: number
}

export interface PreflightSourceTable {
  schema: string
  name: string
  columns: string[]
  pk: string[]
}

/** 对单张表做预检。列名大小写各库不同(PG 折小写 / Oracle 折大写),统一小写比较。 */
export function checkTable(src: PreflightSourceTable, tgt: TargetTableInfo): PreflightIssue[] {
  const key = `${src.schema}.${src.name}`
  const issues: PreflightIssue[] = []
  if (!tgt.exists) {
    issues.push({ table: key, level: 'error', msg: '目标表不存在,请先「一键建库」或手工建表' })
    return issues
  }
  const tcols = new Set(tgt.columns.map((c) => c.toLowerCase()))
  const missing = src.columns.filter((c) => !tcols.has(c.toLowerCase()))
  if (missing.length) {
    issues.push({ table: key, level: 'error', msg: `目标表缺列:${missing.join(', ')}` })
  }
  if (!src.pk.length) {
    issues.push({ table: key, level: 'warn', msg: '源表无主键:行/列对账与增量同步受限' })
  }
  if ((tgt.rowCount ?? 0) > 0) {
    issues.push({
      table: key,
      level: 'warn',
      msg: `目标表已有 ${tgt.rowCount} 行:全量搬运可能产生重复(可改用增量模式)`,
    })
  }
  return issues
}

/** 汇总:有无 error(阻断搬运)、warn 数。 */
export function summarize(issues: PreflightIssue[]): {
  errors: number
  warns: number
  ok: boolean
} {
  const errors = issues.filter((i) => i.level === 'error').length
  const warns = issues.filter((i) => i.level === 'warn').length
  return { errors, warns, ok: errors === 0 }
}
