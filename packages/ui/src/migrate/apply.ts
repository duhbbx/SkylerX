/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— Schema apply(一键建库)。
 *
 * 把 convertSchema 生成的整库脚本在目标库执行。PG 系支持事务 DDL → 整体原子
 * (BEGIN…COMMIT;任一句失败 ROLLBACK 全回滚);其余方言 DDL 自动提交、无法回滚,
 * 逐句执行、首错即停并如实报告已落地/未落地(部分状态)。
 *
 * 支持 dryRun:PG 系跑完一律 ROLLBACK,只验不留痕。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { type StmtRunner, splitStatements, supportsTxnValidation } from './validate'

export interface ApplyResult {
  /** 全部语句是否成功。 */
  ok: boolean
  /** 是否真正提交了(dryRun 或失败回滚时为 false)。 */
  committed: boolean
  /** 目标库是否支持事务原子(PG 系);false 时是逐句非原子执行。 */
  atomic: boolean
  total: number
  succeeded: number
  error?: string
  failedStatement?: string
}

/**
 * 在目标库执行脚本。
 * @param opts.commit true=成功则提交;false=dry-run(只验不提交,仅 PG 系)。
 */
export async function applyScript(
  run: StmtRunner,
  ddl: string,
  target: DbDialect,
  opts: { commit?: boolean } = {},
): Promise<ApplyResult> {
  const stmts = splitStatements(ddl)
  const atomic = supportsTxnValidation(target)
  const base = { atomic, total: stmts.length, succeeded: 0 }
  if (!stmts.length) return { ok: true, committed: false, ...base }

  if (atomic) {
    await run('BEGIN')
    let succeeded = 0
    for (const s of stmts) {
      const r = await run(s)
      if (r.error) {
        await run('ROLLBACK').catch(() => {})
        return {
          ok: false,
          committed: false,
          ...base,
          succeeded,
          error: r.error,
          failedStatement: s,
        }
      }
      succeeded++
    }
    if (opts.commit) {
      await run('COMMIT')
      return { ok: true, committed: true, ...base, succeeded }
    }
    await run('ROLLBACK').catch(() => {}) // dry-run:验过就回滚
    return { ok: true, committed: false, ...base, succeeded }
  }

  // 非事务方言:逐句执行,首错即停(部分状态,无法回滚)
  if (!opts.commit) {
    return {
      ok: false,
      committed: false,
      ...base,
      error: '目标库不支持事务内 DDL,无法 dry-run;请直接执行',
    }
  }
  let succeeded = 0
  for (const s of stmts) {
    const r = await run(s)
    if (r.error) {
      return { ok: false, committed: true, ...base, succeeded, error: r.error, failedStatement: s }
    }
    succeeded++
  }
  return { ok: true, committed: true, ...base, succeeded }
}
