/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 把多语句 SQL 按分号拆分，跳过字符串/反引号/行注释/块注释中的分号。
 * 够用的 MVP 拆分器（非完整 SQL 词法分析）。
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

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
    if (c === ';') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }

  if (cur.trim()) out.push(cur.trim())
  return out
}
