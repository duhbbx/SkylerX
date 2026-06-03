/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL Linter —— 用户自定义规则。
 *
 * 在内置 sqlLint 规则之外,让用户自己加正则规则(禁用模式 / 命名风格 / 危险操作拦截),
 * 存 localStorage,运行时和内置规则一起跑。lintCustom 纯函数可单测;非法正则跳过不崩。
 */
import type { LintFinding, LintSeverity } from './sqlLint'

export interface CustomLintRule {
  id: string
  enabled: boolean
  severity: LintSeverity
  /** 正则源 */
  pattern: string
  /** 正则 flags(如 'i' 'gi');非法时该规则被跳过。 */
  flags: string
  /** 命中时的提示文案。 */
  message: string
  /** 是否先去掉注释再匹配。 */
  stripComments?: boolean
}

const KEY = 'skylerx.lintRules'

type Storage = Pick<typeof globalThis.localStorage, 'getItem' | 'setItem'>
function store(s?: Storage): Storage | null {
  return s ?? (typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null)
}

export function loadCustomRules(s?: Storage): CustomLintRule[] {
  const st = store(s)
  if (!st) return []
  try {
    const arr = JSON.parse(st.getItem(KEY) ?? '[]') as CustomLintRule[]
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.pattern === 'string') : []
  } catch {
    return []
  }
}

export function saveCustomRules(rules: CustomLintRule[], s?: Storage): void {
  try {
    store(s)?.setItem(KEY, JSON.stringify(rules))
  } catch {
    /* quota 满:静默 */
  }
}

/** 校验一条规则的正则是否合法;合法返回 null,否则返回错误信息。 */
export function ruleError(r: Pick<CustomLintRule, 'pattern' | 'flags'>): string | null {
  if (!r.pattern.trim()) return '正则为空'
  try {
    new RegExp(r.pattern, r.flags || '')
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function strip(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** 跑所有启用的自定义规则,产出 finding(id 前缀 custom:)。非法正则跳过。 */
export function lintCustom(sql: string, rules: CustomLintRule[]): LintFinding[] {
  const out: LintFinding[] = []
  for (const r of rules) {
    if (!r.enabled) continue
    let re: RegExp
    try {
      re = new RegExp(r.pattern, (r.flags || '').replace(/g/g, '')) // 去掉 g,避免 test 的 lastIndex 副作用
    } catch {
      continue
    }
    const target = r.stripComments ? strip(sql) : sql
    if (re.test(target)) {
      out.push({
        id: `custom:${r.id}`,
        severity: r.severity,
        message: r.message || `命中规则 ${r.id}`,
      })
    }
  }
  return out
}

/** 生成规则 id(调用方在浏览器,Date.now/random 可用)。 */
export function newRuleId(now: number, rand: number): string {
  return `r${now.toString(36)}${Math.floor(rand * 1e4).toString(36)}`
}
