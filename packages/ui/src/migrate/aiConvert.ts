/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移评估 —— AI 转换层。
 *
 * 确定性正则翻不动的对象(PL/SQL 过程/函数/包/触发器体、CONNECT BY、DECODE、
 * MERGE 等)交给 AI 做语义级翻译。这是「多用 AI」的核心:确定性引擎负责能机器
 * 翻的部分并标出难点,AI 负责把难点真正改写成目标方言能跑的等价写法。
 *
 * 复用现有 ai.ts 的 askAiChat(走用户配置的 provider / IPC 代理),不新开后端。
 * 产出**只读、供复核**:返回目标方言 SQL + 迁移说明,绝不自动在目标库执行。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { askAiChat, extractAllSql } from '../ai'
import { familyOf } from '../ddl'
import { translateSql } from './sqlTranslate'
import type { AssessItem, ConvertResult } from './types'
import { type StmtRunner, supportsTxnValidation, validateDdl } from './validate'

/** 目标方言的人类可读名 + 内核家族描述,拼进提示词让 AI 用对兼容口径。 */
function targetProfile(target: DbDialect): { name: string; kernel: string } {
  if (familyOf(target) === 'pg') {
    return {
      name: target,
      kernel:
        'an openGauss/PostgreSQL-kernel domestic database (e.g. Vastbase/openGauss/MogDB) ' +
        'with Oracle "A" compatibility mode. Prefer standard PG/PL-pgSQL that also runs when ' +
        'A-compat is off; only rely on A-compat features when there is no standard equivalent.',
    }
  }
  return {
    name: target,
    kernel:
      'a Dameng (DM)-style Oracle-compatible domestic database. Keep Oracle-compatible ' +
      'PL/SQL where DM supports it; rewrite only what DM rejects.',
  }
}

/** 转换用的 system 提示词(作为 askAiChat 的 extraSystem 追加)。 */
export function buildConvertSystem(source: DbDialect, target: DbDialect): string {
  const t = targetProfile(target)
  return [
    `You are a senior database migration engineer specializing in "去O" (de-Oracle) projects.`,
    `Convert the given ${source} object DDL / PL/SQL into ${t.name}, which is ${t.kernel}`,
    'Rules:',
    '1. Output ONE ```sql code block containing the complete, runnable target DDL — translate ' +
      'PL/SQL bodies to the target procedural language, rewrite Oracle-only constructs ' +
      '(CONNECT BY → WITH RECURSIVE, DECODE → CASE, (+) joins → ANSI JOIN, MERGE, ROWNUM, etc.).',
    '2. Preserve object/column names, comments, and intent exactly. Do not invent columns or logic.',
    '3. After the code block, add a short "迁移说明" section (in the user UI language) listing every ' +
      'semantic difference or risk a reviewer must check (type precision, date semantics, ' +
      'transaction/isolation, sequences, error handling). Be specific, not generic.',
    '4. If something genuinely cannot be migrated, still emit the closest target DDL and call it out ' +
      'explicitly in 迁移说明 — never silently drop logic.',
    'This output is REVIEW-ONLY; a human will inspect it before any execution. Accuracy over optimism.',
  ].join('\n')
}

/** 把确定性引擎已发现的告警喂给 AI,省得它重新发现、也聚焦人工关注点。 */
function hintBlock(item: AssessItem): string {
  if (!item.notes.length) return ''
  const lines = item.notes.map((n) => `- [${n.level}] ${n.msg}`)
  return `\n\nDeterministic pre-analysis already flagged these — address each:\n${lines.join('\n')}`
}

/**
 * AI 转换单个对象。失败(无 key / 网络)不抛,落到 ConvertResult.error,
 * 让上层批量转换能继续跑别的对象。
 */
export async function convertObject(
  item: AssessItem,
  source: DbDialect,
  target: DbDialect,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const base: Pick<ConvertResult, 'schema' | 'name' | 'kind'> = {
    schema: item.schema,
    name: item.name,
    kind: item.kind,
  }
  const fence = '```'
  const userMsg = `Convert this ${source} ${item.kind} to ${target}:\n\n${fence}sql\n${(item.ddl ?? '').trim()}\n${fence}${hintBlock(item)}`

  try {
    const reply = await askAiChat({
      messages: [{ role: 'user', content: userMsg }],
      dialect: target,
      extraSystem: buildConvertSystem(source, target),
      signal,
    })
    const sqls = extractAllSql(reply)
    const sql = sqls.join('\n\n').trim()
    // code fence 之外的文本就是迁移说明。
    const notes = stripSqlFences(reply).trim()
    return { ...base, sql, notes }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...base, sql: '', notes: '', error: msg === 'NO_API_KEY' ? 'AI 未配置 API Key' : msg }
  }
}

/** 去掉 ```sql ... ``` 代码块,留下散文说明部分。 */
function stripSqlFences(text: string): string {
  return text.replace(/```sql[\s\S]*?```/gi, '').replace(/```[\s\S]*?```/g, '')
}

/**
 * 拿到目标库的报错,让 AI 修复上一版 DDL。返回新 SQL + 说明(沿用同一份转换 system)。
 */
async function repairWithAi(
  prev: ConvertResult,
  source: DbDialect,
  target: DbDialect,
  failedStatement: string,
  error: string,
  signal?: AbortSignal,
): Promise<ConvertResult> {
  const fence = '```'
  const userMsg =
    `The ${target} DDL you produced for ${prev.schema}.${prev.name} failed when executed on the ` +
    `target database. Fix it and return the corrected full DDL.\n\n` +
    `Your previous DDL:\n${fence}sql\n${prev.sql}\n${fence}\n\n` +
    `The statement that failed:\n${fence}sql\n${failedStatement}\n${fence}\n\n` +
    `Target database error:\n${error}\n\n` +
    `Return the complete corrected DDL in one ${fence}sql block, then a short note on what you changed.`
  try {
    const reply = await askAiChat({
      messages: [{ role: 'user', content: userMsg }],
      dialect: target,
      extraSystem: buildConvertSystem(source, target),
      signal,
    })
    const sql = extractAllSql(reply).join('\n\n').trim()
    return {
      schema: prev.schema,
      name: prev.name,
      kind: prev.kind,
      sql,
      notes: stripSqlFences(reply).trim(),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...prev, error: msg === 'NO_API_KEY' ? 'AI 未配置 API Key' : msg }
  }
}

/**
 * AI 转换 + 目标库自修复闭环。
 *  1) convertObject 先翻一版
 *  2) 在目标库(PG 系,事务内 ROLLBACK)校验
 *  3) 不过就把报错回喂 AI 修,重校验,直到通过或到 maxAttempts
 * run 缺省 / 目标库不支持事务校验时,退化为「只转不验」(validated=undefined)。
 */
export async function convertObjectValidated(
  item: AssessItem,
  source: DbDialect,
  target: DbDialect,
  opts: { run?: StmtRunner; maxAttempts?: number; signal?: AbortSignal } = {},
): Promise<ConvertResult> {
  const max = opts.maxAttempts ?? 3

  // 视图先试确定性翻译:简单视图(无 Oracle 专有构造)直接出结果,不调用 AI。
  if (item.kind === 'view' && item.ddl) {
    const det = translateSql(item.ddl, source, target)
    if (!det.needsAi && det.sql.trim()) {
      const extra = det.notes.length ? `\n${det.notes.map((n) => `- ${n.msg}`).join('\n')}` : ''
      return {
        schema: item.schema,
        name: item.name,
        kind: item.kind,
        sql: det.sql,
        notes: `✅ 确定性翻译(未调用 AI)${extra}`,
        attempts: 0,
      }
    }
  }

  let result = await convertObject(item, source, target, opts.signal)
  if (result.error || !result.sql) return { ...result, attempts: 1 }
  if (!opts.run || !supportsTxnValidation(target)) return { ...result, attempts: 1 }

  let attempts = 1
  let v = await validateDdl(opts.run, result.sql, target)
  while (!v.ok && attempts < max) {
    if (opts.signal?.aborted) break
    attempts++
    const fixed = await repairWithAi(
      result,
      source,
      target,
      v.failedStatement ?? '',
      v.error ?? '',
      opts.signal,
    )
    if (fixed.error || !fixed.sql) {
      result = fixed
      break
    }
    result = fixed
    v = await validateDdl(opts.run, result.sql, target)
  }
  return {
    ...result,
    validated: v.ok,
    validationError: v.ok ? undefined : v.error,
    attempts,
  }
}

/**
 * 批量转换需要 AI 的对象(item.needsAi)。串行执行避免打爆 provider 限流;
 * 通过 onProgress 回报进度供向导展示。
 */
export async function convertBatch(
  items: AssessItem[],
  source: DbDialect,
  target: DbDialect,
  opts: {
    signal?: AbortSignal
    onProgress?: (done: number, total: number, last: ConvertResult) => void
  } = {},
): Promise<ConvertResult[]> {
  const queue = items.filter((it) => it.needsAi)
  const out: ConvertResult[] = []
  for (const it of queue) {
    if (opts.signal?.aborted) break
    const r = await convertObject(it, source, target, opts.signal)
    out.push(r)
    opts.onProgress?.(out.length, queue.length, r)
  }
  return out
}
