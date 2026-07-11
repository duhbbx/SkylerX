/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { locale } from './i18n'
import { type AiProvider, isLocalAiProvider, settings } from './settings'
import { extractJson, sanitizeParsedConnection } from './connParse'
import { dialectOptions } from './dialects'

/**
 * Oracle/DM 列类型带上长度/精度渲染：VARCHAR2(50) / NUMBER(10,2)。
 * all_tab_columns 的裸 data_type（VARCHAR2 / NUMBER）信息量太低，AI 写 SQL 时需要长度与精度。
 */
export function fmtOracleType(ty: unknown, len: unknown, prec: unknown, scale: unknown): string {
  const t = String(ty ?? '')
  const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))
  if (/CHAR|RAW/i.test(t)) {
    const l = num(len)
    return l ? `${t}(${l})` : t
  }
  if (t.toUpperCase() === 'NUMBER') {
    const p = num(prec)
    if (p == null) return 'NUMBER'
    const s = num(scale)
    return s ? `NUMBER(${p},${s})` : `NUMBER(${p})`
  }
  return t
}

/** 根据当前 UI 语言生成「请用对应语言回答」的提示，让 AI 回复跟着我们的 i18n 走。 */
function langPrompt(): string {
  return locale.value === 'zh'
    ? 'Always respond in 简体中文. Code blocks (SQL/code) stay in their natural language.'
    : 'Always respond in English. Code blocks (SQL/code) stay in their natural language.'
}

/**
 * 经主进程 IPC 做 fetch（绕过浏览器 CORS）。桌面端 preload 暴露 window.api.ai.fetch；
 * Web 端没有，fallback 到原生 fetch（Web 部署一般在自家域名下，由后端代理就够了）。
 */
interface AiBridge {
  fetch(req: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
    reqId?: string
  }): Promise<{ ok: boolean; status: number; body: string; error?: string }>
  cancel?(reqId: string): Promise<boolean>
  stream?(
    req: {
      url: string
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
      reqId: string
    },
    onChunk: (payload: { chunk: string }) => void,
  ): Promise<{ ok: boolean; status: number; error?: string }>
}
function aiBridge(): AiBridge | null {
  const w = globalThis as { api?: { ai?: AiBridge } }
  return w.api?.ai ?? null
}

interface BridgeResponse {
  ok: boolean
  status: number
  body: string
}

/** 统一发请求：优先走 IPC（避 CORS）；否则原生 fetch。返回统一形如 Response 的对象（带 text() / json()）。 */
async function aiHttp(
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
    timeoutMs?: number
  },
): Promise<BridgeResponse & { text(): Promise<string>; json(): Promise<unknown> }> {
  const bridge = aiBridge()
  if (bridge) {
    // 生成请求 id，并把渲染层的 AbortSignal 链到主进程的 ai:cancel
    const reqId = `r${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const onAbort = (): void => {
      void bridge.cancel?.(reqId)
    }
    if (init.signal) {
      if (init.signal.aborted) onAbort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const r = await bridge.fetch({
        url,
        method: init.method as 'POST',
        headers: init.headers,
        body: init.body,
        timeoutMs: init.timeoutMs,
        reqId,
      })
      if (r.error) {
        // 用户主动 abort vs 主进程超时分流：保留原始 error.name 语义
        const err = new Error(r.error) as Error & { aiAborted?: boolean }
        if (/abort/i.test(r.error)) err.aiAborted = true
        throw err
      }
      return {
        ok: r.ok,
        status: r.status,
        body: r.body,
        text: async () => r.body,
        json: async () => JSON.parse(r.body),
      }
    } finally {
      init.signal?.removeEventListener('abort', onAbort)
    }
  }
  const res = await fetch(url, init as RequestInit)
  const body = await res.text()
  return {
    ok: res.ok,
    status: res.status,
    body,
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

/**
 * 流式请求：逐帧把 SSE 的 `data:` JSON 交给 onData（provider 差异由调用方解析）。
 * 优先走 IPC bridge.stream（主进程推 raw chunk）；无 bridge 时退到原生 fetch + reader。
 * 内置一个跨 chunk 的 SSE 帧累积器：按空行(\n\n)切帧，取 data 行，遇 [DONE] 停。
 */
async function aiHttpStream(
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
    timeoutMs?: number
  },
  onData: (json: unknown) => void,
): Promise<void> {
  let buf = ''
  let stopped = false
  const feed = (text: string): void => {
    if (stopped) return
    buf += text
    let idx: number
    // SSE 帧之间用空行分隔；兼容 \r\n
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + (buf[idx] === '\r' ? 4 : 2))
      for (const rawLine of frame.split(/\r?\n/)) {
        const m = rawLine.match(/^data:\s?(.*)$/)
        if (!m) continue
        const payload = m[1]
        if (payload === '[DONE]') {
          stopped = true
          return
        }
        try {
          onData(JSON.parse(payload))
        } catch {
          /* 跳过非 JSON（注释行 / keep-alive） */
        }
      }
    }
  }

  const bridge = aiBridge()
  if (bridge?.stream) {
    const reqId = `s${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const onAbort = (): void => {
      void bridge.cancel?.(reqId)
    }
    if (init.signal) {
      if (init.signal.aborted) onAbort()
      else init.signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const r = await bridge.stream(
        {
          url,
          method: init.method as 'POST',
          headers: init.headers,
          body: init.body,
          timeoutMs: init.timeoutMs,
          reqId,
        },
        (p) => feed(p.chunk),
      )
      if (r.error) {
        const err = new Error(r.error) as Error & { aiAborted?: boolean }
        if (/abort/i.test(r.error)) err.aiAborted = true
        throw err
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
    } finally {
      init.signal?.removeEventListener('abort', onAbort)
    }
    return
  }

  // Web 兜底：原生 fetch 流式读取
  const res = await fetch(url, init as RequestInit)
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ''}`)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    feed(dec.decode(value, { stream: true }))
    if (stopped) break
  }
}

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
  /** 可选:代码库相关片段(实体/SQL/迁移/文档),作为参考上下文 */
  codeContext?: string
  signal?: AbortSignal
}

function buildUserMessage(o: AskOptions): string {
  const parts: string[] = []
  if (o.dialect) parts.push(`SQL dialect: ${o.dialect}`)
  if (o.schema) parts.push(`Database schema:\n${o.schema}`)
  if (o.codeContext)
    parts.push(
      `Reference snippets from the project's code repository (entities/SQL/migrations/docs). ` +
        `Prefer the live database schema above for structure; use these for naming, semantics, and query patterns:\n${o.codeContext}`,
    )
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

/** Anthropic Messages API（claude-*）。 */
async function callAnthropic(
  o: AskOptions,
  key: string,
  base: string,
  model: string,
): Promise<string> {
  const res = await aiHttp(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: `${SYSTEM[o.mode]}\n${langPrompt()}`,
      messages: [{ role: 'user', content: buildUserMessage(o) }],
    }),
    signal: o.signal,
  })
  await throwIfNotOk(res)
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
}

/** OpenAI 兼容的 chat/completions（OpenAI / DeepSeek / Codex / Grok / 其他兼容代理）。 */
async function callOpenAiCompat(
  o: AskOptions,
  key: string,
  base: string,
  model: string,
): Promise<string> {
  const res = await aiHttp(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: `${SYSTEM[o.mode]}\n${langPrompt()}` },
        { role: 'user', content: buildUserMessage(o) },
      ],
    }),
    signal: o.signal,
  })
  await throwIfNotOk(res)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

async function throwIfNotOk(res: BridgeResponse & { json(): Promise<unknown> }): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; message?: string }
    detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')
  } catch {
    /* ignore */
  }
  throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
}

/**
 * 询问 AI 助手（根据 settings.aiProvider 分发到对应后端）。
 * 兼容旧名 `askClaude`（重导出别名）。
 */
export async function askAi(o: AskOptions): Promise<string> {
  const provider = settings.aiProvider
  const cfg = settings.aiProviders[provider]
  const key = resolveKey(provider, cfg?.apiKey)
  const base = (cfg?.baseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('NO_BASE_URL')
  const model = cfg.model || 'default'
  if (provider === 'anthropic') return callAnthropic(o, key, base, model)
  return callOpenAiCompat(o, key, base, model)
}

/**
 * 取请求用的 Bearer/key：本地 provider（Ollama）不强制 API Key，
 * 留空就用占位串（Ollama 的 OpenAI 兼容端点忽略它）；其余 provider 必须有 key。
 */
function resolveKey(provider: AiProvider, apiKey: string | undefined): string {
  const k = apiKey?.trim() || ''
  if (k) return k
  if (isLocalAiProvider(provider)) return 'local'
  throw new Error('NO_API_KEY')
}

/** 旧导出名兼容（早期组件 import askClaude）。 */
export const askClaude = askAi

// ── 多轮对话（chat panel 用）────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  /** 数据库方言（拼进 system prompt） */
  dialect?: DbDialect
  /** 库结构上下文（用户可开关） */
  schema?: string
  /** 可选:代码库相关片段(实体/SQL/迁移/文档),作为参考上下文 */
  codeContext?: string
  /** 用户额外的系统提示词（追加在内置系统提示词之后） */
  extraSystem?: string
  /** A/B/C 三档记忆汇总段（由 memory.ts/buildMemorySection 生成）；优先注入到 system 前面 */
  memorySection?: string
  /** 可选：限制非流式响应长度（默认保持现有 chat 预算）。 */
  maxTokens?: number
  signal?: AbortSignal
}

const CHAT_SYSTEM =
  'You are SkylerX, an expert SQL assistant embedded inside a database management tool. ' +
  'You can read provided schema context, write SQL for the given dialect, explain queries, ' +
  'suggest optimizations, and diagnose errors. When you output SQL, wrap it in ```sql code fences ' +
  'so the UI can offer one-click insert/run buttons. Be concise.'

function buildSystem(o: ChatOptions): string {
  const parts = [CHAT_SYSTEM, langPrompt()]
  // 记忆段先放，让 A/B/C 永远在最显眼的位置（模型对前置 context 更敏感）
  if (o.memorySection?.trim()) parts.push(o.memorySection.trim())
  if (o.dialect) parts.push(`SQL dialect: ${o.dialect}`)
  if (o.schema) parts.push(`Database schema (read-only context):\n${o.schema}`)
  if (o.codeContext)
    parts.push(
      `Project code repository snippets (read-only reference; prefer the DB schema for structure, ` +
        `use these for naming/semantics/query patterns):\n${o.codeContext}`,
    )
  if (o.extraSystem) parts.push(o.extraSystem)
  return parts.join('\n\n')
}

export async function askAiChat(o: ChatOptions): Promise<string> {
  const provider = settings.aiProvider
  const cfg = settings.aiProviders[provider]
  const key = resolveKey(provider, cfg?.apiKey)
  const base = (cfg?.baseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('NO_BASE_URL')
  const model = cfg.model || 'default'
  const system = buildSystem(o)
  const maxTokens = o.maxTokens ?? 2000
  if (provider === 'anthropic') {
    const res = await aiHttp(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: o.messages }),
      signal: o.signal,
    })
    await throwIfNotOk(res)
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    return (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
  }
  // OpenAI 兼容
  const res = await aiHttp(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...o.messages],
    }),
    signal: o.signal,
  })
  await throwIfNotOk(res)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

const CODE_SEARCH_EXPANSION_SYSTEM =
  'Expand this code-repository search question into relevant English identifiers and business terms. ' +
  'Return only space-separated terms. Do not include explanations, punctuation, markdown, or translations.'

/** 将自然语言代码问题扩展为更适合英文标识符词法检索的关键词。 */
export async function expandCodeSearchQuery(query: string, signal?: AbortSignal): Promise<string> {
  const expanded = await askAiChat({
    messages: [{ role: 'user', content: query }],
    extraSystem: CODE_SEARCH_EXPANSION_SYSTEM,
    maxTokens: 96,
    signal,
  })
  return expanded.trim() || query
}

/**
 * 流式版多轮对话：每来一段增量调用 onToken，返回累计的完整文本。
 * 失败（含 NO_BASE_URL / abort / HTTP 错）按非流式同样语义抛错，调用方可回退。
 */
export async function askAiChatStream(
  o: ChatOptions,
  onToken: (delta: string) => void,
): Promise<string> {
  const provider = settings.aiProvider
  const cfg = settings.aiProviders[provider]
  const key = resolveKey(provider, cfg?.apiKey)
  const base = (cfg?.baseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('NO_BASE_URL')
  const model = cfg.model || 'default'
  const system = buildSystem(o)
  let acc = ''
  const emit = (d: string): void => {
    if (d) {
      acc += d
      onToken(d)
    }
  }
  if (provider === 'anthropic') {
    await aiHttpStream(
      `${base}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, max_tokens: 2000, system, messages: o.messages, stream: true }),
        signal: o.signal,
        timeoutMs: 120_000,
      },
      (j) => {
        // Anthropic SSE：content_block_delta 携带 delta.text
        const ev = j as { type?: string; delta?: { text?: string } }
        if (ev.type === 'content_block_delta' && ev.delta?.text) emit(ev.delta.text)
      },
    )
    return acc.trim()
  }
  await aiHttpStream(
    `${base}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        stream: true,
        messages: [{ role: 'system', content: system }, ...o.messages],
      }),
      signal: o.signal,
      timeoutMs: 120_000,
    },
    (j) => {
      // OpenAI 兼容 SSE：choices[0].delta.content
      const ev = j as { choices?: { delta?: { content?: string } }[] }
      const d = ev.choices?.[0]?.delta?.content
      if (d) emit(d)
    },
  )
  return acc.trim()
}

/** 把 markdown 形式回复里所有 ```sql code block 抽出来。 */
export function extractAllSql(text: string): string[] {
  const out: string[] = []
  const re = /```(?:sql)?\s*([\s\S]*?)```/gi
  for (;;) {
    const m = re.exec(text)
    if (!m) break
    const s = m[1].trim()
    if (s) out.push(s)
  }
  return out
}

/** 从模型回复中提取首个 ```sql 代码块（无则返回整段去除围栏）。 */
export function extractSql(text: string): string {
  const m = text.match(/```sql\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/)
  return (m ? m[1] : text).trim()
}

export function currentProvider(): AiProvider {
  return settings.aiProvider
}

/**
 * 文本向量化(RAG 用)。走 OpenAI 兼容的 /v1/embeddings。
 *
 * 用**专用的嵌入配置**(settings.aiEmbedding*),跟向量记忆共用、跟聊天 provider 解耦——
 * 因为嵌入端点常和聊天不是同一家(典型:Anthropic 聊天 + OpenAI 嵌入)。
 * 没配 key/baseUrl → 抛 NO_EMBEDDINGS,上层退化到词法检索。input 传数组一次嵌多条(OpenAI 支持)。
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (!texts.length) return []
  const base = settings.aiEmbeddingBaseUrl.trim().replace(/\/$/, '')
  const model = settings.aiEmbeddingModel.trim() || 'text-embedding-3-small'
  // 本地端点（Ollama 等）不需要 key；留空给占位 Bearer（被忽略）。
  const key = settings.aiEmbeddingApiKey.trim() || (isLocalEmbeddingBase(base) ? 'local' : '')
  if (!key || !base) throw new Error('NO_EMBEDDINGS')
  const res = await aiHttp(`${base}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts }),
    signal,
  })
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`)
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> }
  return (data.data ?? []).map((d) => d.embedding)
}

/** 嵌入端点是否指向本机（localhost / 127.0.0.1 / ::1）——本地推理无需 API Key。 */
export function isLocalEmbeddingBase(base: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(base.trim())
}

/**
 * 是否配好了嵌入端点(决定 RAG 能否走向量/混合检索)。
 * 需要 baseUrl；普通端点还需 key，本地端点(Ollama)免 key。
 */
export function canEmbed(): boolean {
  const base = settings.aiEmbeddingBaseUrl.trim()
  if (!base) return false
  return !!settings.aiEmbeddingApiKey.trim() || isLocalEmbeddingBase(base)
}

// ── Connection text → structured fields (AI smart-fill) ──────────────
// ConnectionForm 的「✨ AI 填充」: 把用户粘贴的任意文本(JDBC URL / CLI / env / 散文)
// 交给模型抽成 JSON,再经 connParse 规整成 Partial<ConnectionConfig> 回填表单。

function connParseSystem(): string {
  const ids = dialectOptions.map((o) => o.value).join(', ')
  return [
    'You extract database connection parameters from arbitrary text: JDBC URLs, CLI commands (psql/mysql/mongosh), env var blocks, URIs, or prose.',
    'Return ONLY a single JSON object. No markdown, no code fence, no commentary.',
    'Shape (omit any field you cannot determine — never invent values):',
    '{ "dialect": <id>, "name": string, "host": string, "port": number, "user": string, "password": string, "database": string, "group": string,',
    '  "ssl": { "enabled": boolean, "rejectUnauthorized": boolean, "ca": string, "cert": string, "key": string },',
    '  "ssh": { "enabled": boolean, "host": string, "port": number, "user": string, "password": string, "privateKey": string, "passphrase": string },',
    '  "extra": { ...dialect-specific keys... } }',
    `Valid dialect ids (use exactly one of these for "dialect"): ${ids}.`,
    'Put dialect-specific values in "extra": MongoDB full connection string → extra.uri; ClickHouse full URL → extra.url; Snowflake → extra.account / extra.warehouse / extra.role / extra.schema / extra.authenticator.',
    'Infer dialect from scheme/port/keywords (e.g. jdbc:postgresql → postgresql, port 3306 → mysql). If genuinely ambiguous, omit "dialect".',
  ].join('\n')
}

/**
 * 解析一段连接信息文本 → 结构化字段(供表单回填)。
 * 复用当前 provider 的分发逻辑(同 askAi);成功返回经校验的 Partial<ConnectionConfig>。
 * 文本无法解析成 JSON 时由 extractJson 抛错,上层提示用户。
 */
export async function parseConnectionText(
  text: string,
  signal?: AbortSignal,
): Promise<Partial<ConnectionConfig>> {
  const provider = settings.aiProvider
  const cfg = settings.aiProviders[provider]
  const key = resolveKey(provider, cfg?.apiKey)
  const base = (cfg?.baseUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('NO_BASE_URL')
  const model = cfg.model || 'default'
  const system = connParseSystem()
  let rawText: string
  if (provider === 'anthropic') {
    const res = await aiHttp(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        system,
        messages: [{ role: 'user', content: text }],
      }),
      signal,
    })
    await throwIfNotOk(res)
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    rawText = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
  } else {
    const res = await aiHttp(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
      }),
      signal,
    })
    await throwIfNotOk(res)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    rawText = (data.choices?.[0]?.message?.content ?? '').trim()
  }
  return sanitizeParsedConnection(extractJson(rawText))
}

// ── Connectivity test (#28) ──────────────────────────────────────────
// Settings → AI → 「测试连通」按钮触发. 用最轻量的请求确认 API Key 有效 +
// Base URL 可达 + 至少返回 200. 优先打 /v1/models (不烧 token, 只列模型);
// 若 404 / 501 (某些代理不暴露 /v1/models), fallback 到一次最小聊天请求.

export interface AiTestResult {
  ok: boolean
  /** 用户可见的简短消息(成功时含延迟 + 模型数; 失败时含 HTTP 状态/原因) */
  message: string
  latencyMs?: number
  modelCount?: number
}

/** Test a provider config — does NOT touch settings.aiProvider, runs against the supplied cfg. */
export async function testAiProvider(
  provider: AiProvider,
  cfg: { apiKey: string; baseUrl: string; model: string },
): Promise<AiTestResult> {
  // 本地 provider（Ollama）无需 Key，留空用占位串
  const key = cfg.apiKey?.trim() || (isLocalAiProvider(provider) ? 'local' : '')
  if (!key) return { ok: false, message: 'API Key 为空' }
  const base = (cfg.baseUrl || '').trim().replace(/\/$/, '')
  if (!base) return { ok: false, message: 'Base URL 为空' }

  const headers: Record<string, string> =
    provider === 'anthropic'
      ? {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { authorization: `Bearer ${key}` }

  const t0 = Date.now()
  // Step 1: try /v1/models (lightweight, no token cost)
  try {
    const r = await aiHttp(`${base}/v1/models`, {
      method: 'GET',
      headers,
      body: '',
      timeoutMs: 15_000,
    })
    const latencyMs = Date.now() - t0
    if (r.ok) {
      let modelCount: number | undefined
      try {
        const data = JSON.parse(r.body) as { data?: Array<{ id?: string }> }
        modelCount = data.data?.length
      } catch {
        /* malformed JSON — still 200 means the auth worked */
      }
      return {
        ok: true,
        message:
          modelCount !== undefined
            ? `连通正常 (${latencyMs}ms · ${modelCount} 个模型可见)`
            : `连通正常 (${latencyMs}ms)`,
        latencyMs,
        modelCount,
      }
    }
    // 404 / 501 on /v1/models often means a proxy doesn't expose it — fall through to chat
    if (r.status !== 404 && r.status !== 501) {
      return {
        ok: false,
        message: `HTTP ${r.status}: ${(r.body || '').slice(0, 200) || '(empty body)'}`,
        latencyMs,
      }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }

  // Step 2: minimal chat call as fallback (uses ≤ a handful of tokens)
  try {
    const model =
      cfg.model?.trim() || (provider === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4o-mini')
    const url = provider === 'anthropic' ? `${base}/v1/messages` : `${base}/v1/chat/completions`
    const body =
      provider === 'anthropic'
        ? JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          })
        : JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          })
    const r = await aiHttp(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
      timeoutMs: 20_000,
    })
    const latencyMs = Date.now() - t0
    if (r.ok) return { ok: true, message: `连通正常 (${latencyMs}ms · 模型 ${model})`, latencyMs }
    return {
      ok: false,
      message: `HTTP ${r.status}: ${(r.body || '').slice(0, 200) || '(empty body)'}`,
      latencyMs,
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
