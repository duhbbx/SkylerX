/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 目标库 DDL 校验。
 *
 * 把转换出的 DDL 放到目标库真跑一遍,确认语法 / 方言可用。PG 系支持**事务内 DDL**,
 * 所以用 `BEGIN … ROLLBACK` 校验:既验证了又不留痕(免建临时 schema、免清理)。
 * MySQL / Oracle / DM 的 DDL 自动提交、无法回滚,这里标记 supported=false 跳过(诚实)。
 *
 * runner 注入(包目标连接的 execute),既复用查询管线又能 mock 单测。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'

/** 跑一条语句,出错返回 { error };成功返回 {}。 */
export type StmtRunner = (sql: string) => Promise<{ error?: string }>

export interface ValidationResult {
  /** 是否通过(supported=false 时恒为 true,表示「未校验」)。 */
  ok: boolean
  /** 目标库是否支持事务内校验(PG 系 true)。 */
  supported: boolean
  error?: string
  /** 出错的那条语句。 */
  failedStatement?: string
}

/** 拆 DDL 脚本为语句:去掉 `--` 注释行,按 `;` 切。不解析字符串里的分号(MVP 无 PL/SQL)。 */
export function splitStatements(ddl: string): string[] {
  return (ddl ?? '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 只有 PG 系支持事务内 DDL 回滚校验。 */
export function supportsTxnValidation(target: DbDialect): boolean {
  return familyOf(target) === 'pg'
}

/** 在一个事务里跑完所有语句,然后 ROLLBACK;首条出错即停。 */
export async function validateInTxn(run: StmtRunner, ddl: string): Promise<ValidationResult> {
  const stmts = splitStatements(ddl)
  if (!stmts.length) return { ok: true, supported: true }
  await run('BEGIN')
  try {
    for (const s of stmts) {
      const r = await run(s)
      if (r.error) return { ok: false, supported: true, error: r.error, failedStatement: s }
    }
    return { ok: true, supported: true }
  } finally {
    await run('ROLLBACK').catch(() => {})
  }
}

/** 校验入口:不支持事务校验的方言直接返回「未校验」。 */
export async function validateDdl(
  run: StmtRunner,
  ddl: string,
  target: DbDialect,
): Promise<ValidationResult> {
  if (!supportsTxnValidation(target)) return { ok: true, supported: false }
  return validateInTxn(run, ddl)
}
