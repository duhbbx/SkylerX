/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 简单 SQL / 视图的确定性翻译。
 *
 * 视图的 SELECT 体若只用标准 SQL + 几个可机器替换的函数,就不必动用 AI:
 * 这里做轻量正则改写(SYSDATE→CURRENT_TIMESTAMP、NVL→COALESCE、MINUS→EXCEPT…),
 * 并检测「确定性搞不定」的 Oracle 专有构造(DECODE / CONNECT BY / (+) / MERGE / ROWNUM …)。
 * 命中专有构造 → needsAi=true,交给 AI;否则给出确定性结果,省 AI 额度也更快。
 *
 * 范围:目前只对 **Oracle/DM 源** 做确定性翻译(去O 主场);其它源保守标 needsAi,交 AI。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { familyOf } from '../ddl'
import { type ConvertNote, note } from './ir'

export interface SqlTranslation {
  sql: string
  /** 含确定性搞不定的构造 → 应交 AI。 */
  needsAi: boolean
  notes: ConvertNote[]
}

/** 确定性搞不定的 Oracle 专有构造,命中即转 AI。 */
const HARD: Array<{ re: RegExp; msg: string }> = [
  { re: /\bDECODE\s*\(/i, msg: 'DECODE(...) 需改写为 CASE WHEN' },
  { re: /\bNVL2\s*\(/i, msg: 'NVL2(...) 需改写为 CASE WHEN' },
  { re: /\bCONNECT\s+BY\b/i, msg: 'CONNECT BY 层次查询需改写为 WITH RECURSIVE' },
  { re: /\bSTART\s+WITH\b/i, msg: 'START WITH 层次起点需随 CONNECT BY 改写' },
  { re: /\bMERGE\s+INTO\b/i, msg: 'MERGE INTO 需改写为 ON CONFLICT 或目标库 MERGE' },
  { re: /\(\s*\+\s*\)/, msg: 'Oracle (+) 外连接需改写为 ANSI OUTER JOIN' },
  { re: /\bROWNUM\b/i, msg: 'ROWNUM 需改用 LIMIT 或 row_number()' },
  { re: /\bPIVOT\s*\(|\bUNPIVOT\s*\(/i, msg: 'PIVOT/UNPIVOT 需改写' },
  { re: /\bLISTAGG\s*\(/i, msg: 'LISTAGG 需改写为 string_agg / group_concat' },
  { re: /\bDBMS_\w+|\bUTL_\w+/i, msg: 'DBMS_*/UTL_* 系统包调用,需重写' },
  { re: /\bMODEL\b\s/i, msg: 'MODEL 子句无对应,需重写' },
]

/** 函数 / 关键字替换(按目标家族;函数名后保留左括号)。 */
function fnMaps(target: DbDialect): Array<{ re: RegExp; to: string; note: string }> {
  const fam = familyOf(target)
  const maps: Array<{ re: RegExp; to: string; note: string }> = [
    { re: /\bSYSDATE\b/gi, to: 'CURRENT_TIMESTAMP', note: 'SYSDATE → CURRENT_TIMESTAMP' },
    { re: /\bSYSTIMESTAMP\b/gi, to: 'CURRENT_TIMESTAMP', note: 'SYSTIMESTAMP → CURRENT_TIMESTAMP' },
  ]
  if (fam === 'pg') {
    // PG 标准写法(A 兼容关了也能跑)
    maps.push({ re: /\bNVL\s*\(/gi, to: 'COALESCE(', note: 'NVL → COALESCE' })
    maps.push({ re: /\bMINUS\b/gi, to: 'EXCEPT', note: 'MINUS → EXCEPT' })
    maps.push({ re: /\bFROM\s+DUAL\b/gi, to: '', note: 'FROM DUAL 去掉(PG 无 DUAL)' })
  } else if (fam === 'mysql') {
    maps.push({ re: /\bNVL\s*\(/gi, to: 'IFNULL(', note: 'NVL → IFNULL' })
    maps.push({ re: /\bMINUS\b/gi, to: 'EXCEPT', note: 'MINUS → EXCEPT(MySQL 8.0.31+)' })
  }
  // oracle/dm 目标:SYSDATE/NVL/MINUS/DUAL 原生支持,不改(只保留 SYSDATE 映射上面那两条其实也可不改,但统一更稳)
  return maps
}

/**
 * 确定性翻译一段 SQL(视图 SELECT / 简单语句)。
 * 仅对 Oracle/DM 源处理;其它源直接 needsAi=true。
 */
export function translateSql(sql: string, source: DbDialect, target: DbDialect): SqlTranslation {
  const raw = sql ?? ''
  if (familyOf(source) !== 'oracle') {
    return { sql: raw, needsAi: true, notes: [note('review', '该源方言的视图/SQL 交 AI 翻译')] }
  }
  const notes: ConvertNote[] = []
  // 1) 命中专有构造 → 交 AI
  for (const { re, msg } of HARD) {
    if (re.test(raw)) {
      notes.push(note('review', msg))
      return { sql: raw, needsAi: true, notes }
    }
  }
  // 2) 函数/关键字替换
  let out = raw
  for (const { re, to, note: n } of fnMaps(target)) {
    if (re.test(out)) {
      re.lastIndex = 0
      out = out.replace(re, to)
      notes.push(note('info', n))
    }
  }
  return { sql: out.replace(/[ \t]+\n/g, '\n').trim(), needsAi: false, notes }
}
