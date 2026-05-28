import type { DbDialect } from '@db-tool/shared-types'
import { settings } from './settings'

export type AiMode = 'nl2sql' | 'explain' | 'optimize' | 'diagnose'

/** 各模式的系统提示词（约束输出格式：SQL 类只回 SQL + 简注，解释/优化用简明中文）。 */
const SYSTEM: Record<AiMode, string> = {
  nl2sql:
    'You are an expert SQL assistant. Translate the user request into a single correct SQL statement for the given dialect. ' +
    'Use only tables/columns present in the provided schema when available. ' +
    'Reply with the SQL in a ```sql code block, then one short line explaining it. Do not invent columns.',
  explain:
    'You are an expert SQL reviewer. Explain what the given SQL does, step by step, concisely. ' +
    'Point out joins, filters, and any potential correctness pitfalls.',
  optimize:
    'You are a database performance expert. Suggest concrete optimizations for the given SQL (indexes, rewrites, avoiding full scans). ' +
    'If you propose a rewrite, give it in a ```sql code block.',
  diagnose:
    'You are a database troubleshooting expert. Given a SQL statement and its error message, explain the likely cause and how to fix it. ' +
    'If a corrected statement is appropriate, provide it in a ```sql code block.',
}

export interface AskOptions {
  mode: AiMode
  dialect?: DbDialect
  /** 用户输入（自然语言 或 SQL） */
  input: string
  /** 可选：错误信息（diagnose 模式） */
  error?: string
  /** 可选：库结构上下文（schema.table(col type, ...)） */
  schema?: string
  signal?: AbortSignal
}

function buildUserMessage(o: AskOptions): string {
  const parts: string[] = []
  if (o.dialect) parts.push(`SQL dialect: ${o.dialect}`)
  if (o.schema) parts.push(`Database schema:\n${o.schema}`)
  if (o.mode === 'nl2sql') {
    parts.push(`Request: ${o.input}`)
  } else if (o.mode === 'diagnose') {
    parts.push(`SQL:\n${o.input}`)
    if (o.error) parts.push(`Error message:\n${o.error}`)
  } else {
    parts.push(`SQL:\n${o.input}`)
  }
  return parts.join('\n\n')
}

/** 调用 Anthropic Messages API（浏览器/Electron 渲染层直连，需 dangerous-direct-browser-access）。 */
export async function askClaude(o: AskOptions): Promise<string> {
  const key = settings.aiApiKey.trim()
  if (!key) throw new Error('NO_API_KEY')
  const base = (settings.aiBaseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.aiModel || 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: SYSTEM[o.mode],
      messages: [{ role: 'user', content: buildUserMessage(o) }],
    }),
    signal: o.signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      detail = j.error?.message ?? ''
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
}

/** 从模型回复中提取首个 ```sql 代码块（无则返回整段去除围栏）。 */
export function extractSql(text: string): string {
  const m = text.match(/```sql\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/)
  return (m ? m[1] : text).trim()
}
