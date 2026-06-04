/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 把多语句 SQL 拆成单条。按分号拆,但跳过:字符串/反引号/双引号、行注释/块注释、
 * PG dollar 引用($$ … $$ / $tag$ … $tag$),以及 **PL/SQL 块**——
 * CREATE TRIGGER/FUNCTION/PROCEDURE/PACKAGE/TYPE 以及 DECLARE/匿名 BEGIN 块里的分号
 * 不能当语句分隔(否则 `BEGIN NULL; END;` 会被从中间切开,达梦/Oracle 报语法错)。
 * 这类块由 SQL*Plus 风格的「单独一行 `/`」或输入结束来终止。
 *
 * 够用的 MVP 拆分器(非完整 SQL 词法分析)。
 */

/** 这条语句是否是 PL/SQL 块(块内分号不拆;由 `/` 或 EOF 终止)。 */
function isPlsqlStart(s: string): boolean {
  if (
    /^CREATE(\s+OR\s+REPLACE)?(\s+(EDITIONABLE|NONEDITIONABLE|FORCE))?\s+(TRIGGER|FUNCTION|PROCEDURE|PACKAGE|TYPE)\b/i.test(
      s,
    )
  )
    return true
  if (/^DECLARE\b/i.test(s)) return true
  // 匿名块 BEGIN …;但排除事务控制 BEGIN; / BEGIN WORK / BEGIN TRANSACTION
  if (/^BEGIN\b/i.test(s) && !/^BEGIN\s*;/i.test(s) && !/^BEGIN\s+(WORK|TRANSACTION)\b/i.test(s))
    return true
  return false
}

/** 在 `$` 处尝试匹配 dollar 引用标签(`$$` 或 `$tag$`),返回完整标签或 null。 */
function readDollarTag(sql: string, i: number): string | null {
  const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i))
  return m ? m[0] : null
}

/** 位置 i 的 `/` 是否是「单独一行的 /」终止符(本行 / 前后都只有空白)。 */
function isSlashTerminator(sql: string, i: number): boolean {
  let a = i - 1
  while (a >= 0 && sql[a] !== '\n') {
    if (sql[a] !== ' ' && sql[a] !== '\t' && sql[a] !== '\r') return false
    a--
  }
  let b = i + 1
  while (b < sql.length && sql[b] !== '\n') {
    if (sql[b] !== ' ' && sql[b] !== '\t' && sql[b] !== '\r') return false
    b++
  }
  return true
}

export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let dollar: string | null = null // dollar 引用内的标签(去掉两端 $ 后的内容);null=不在引用里
  let plsql = false // 当前语句是 PL/SQL 块
  let decided = false // 是否已判定过当前语句的 plsql 标志

  const flush = (): void => {
    const t = cur.trim()
    if (t) out.push(t)
    cur = ''
    plsql = false
    decided = false
  }

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      cur += c
      if (c === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      cur += c
      if (c === '*' && next === '/') {
        cur += next
        i++
        inBlockComment = false
      }
      continue
    }
    if (inSingle) {
      cur += c
      if (c === '\\' && next !== undefined) {
        cur += next
        i++
      } else if (c === "'") {
        inSingle = false
      }
      continue
    }
    if (inDouble) {
      cur += c
      if (c === '\\' && next !== undefined) {
        cur += next
        i++
      } else if (c === '"') {
        inDouble = false
      }
      continue
    }
    if (inBacktick) {
      cur += c
      if (c === '`') inBacktick = false
      continue
    }
    if (dollar !== null) {
      if (c === '$') {
        const tag = readDollarTag(sql, i)
        if (tag !== null && tag.slice(1, -1) === dollar) {
          cur += tag
          i += tag.length - 1
          dollar = null
          continue
        }
      }
      cur += c
      continue
    }

    // 在语句的第一个有效字符处判定 PL/SQL(跳过前导空白/注释后)
    if (!decided && /\S/.test(c) && !(c === '-' && next === '-') && !(c === '/' && next === '*')) {
      plsql = isPlsqlStart(sql.slice(i, i + 96))
      decided = true
    }

    if (c === '-' && next === '-') {
      inLineComment = true
      cur += c
      continue
    }
    if (c === '/' && next === '*') {
      inBlockComment = true
      cur += c + next
      i++
      continue
    }
    if (c === "'") {
      inSingle = true
      cur += c
      continue
    }
    if (c === '"') {
      inDouble = true
      cur += c
      continue
    }
    if (c === '`') {
      inBacktick = true
      cur += c
      continue
    }
    if (c === '$') {
      const tag = readDollarTag(sql, i)
      if (tag !== null) {
        cur += tag
        i += tag.length - 1
        dollar = tag.slice(1, -1)
        // dollar 引用 = PG 风格(函数体用 $$ 包,语句仍由 ; 终止);
        // 退出 PL/SQL 的「分号不拆」模式,让函数末尾的 ; 正常终止。
        plsql = false
        continue
      }
    }
    // SQL*Plus「单独一行 /」终止符:结束当前(PL/SQL)语句,吞掉这个 /
    if (c === '/' && isSlashTerminator(sql, i)) {
      flush()
      continue
    }
    if (c === ';') {
      if (plsql) {
        cur += c // PL/SQL 块内分号不拆
        continue
      }
      flush()
      continue
    }
    cur += c
  }

  if (cur.trim()) out.push(cur.trim())
  return out
}
