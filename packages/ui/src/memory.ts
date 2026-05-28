/**
 * AI 助手三档记忆与上下文。
 *
 * - A 档：settings.aiCustomInstructions（自由文本「我的画像 / 写作偏好」），总是注入。
 * - B 档：settings.aiFacts（结构化事实清单），总是全量注入；用户手动 add/remove，
 *   也可开启 aiAutoExtractFacts 让模型在每轮对话末尾抽取 1-3 条事实自动入库。
 * - C 档：settings.aiVectorMemories（每轮对话的文本 + embedding 向量本地存储），
 *   查询前按余弦相似度取 top-K 注入；超过 1000 条 LRU 截断。
 *
 * 拼到 system prompt 时的顺序：A → B → C 相关记忆。
 */
import { settings } from './settings'

// ── 共享的 HTTP 桥（与 ai.ts 同源；走主进程 IPC 绕开 CORS）────────────────────
interface AiBridge {
  fetch(req: {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  }): Promise<{
    ok: boolean
    status: number
    body: string
    error?: string
  }>
}
function aiBridge(): AiBridge | null {
  const w = globalThis as { api?: { ai?: AiBridge } }
  return w.api?.ai ?? null
}
async function bridgePost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const bridge = aiBridge()
  if (bridge) {
    // embedding 类短请求超时给短一点（15s），避免拖垮聊天主流程
    const r = await bridge.fetch({ url, method: 'POST', headers, body, timeoutMs: 15_000 })
    if (r.error) throw new Error(r.error)
    return { ok: r.ok, status: r.status, body: r.body }
  }
  const res = await fetch(url, { method: 'POST', headers, body })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

// ── B 档：事实 CRUD ───────────────────────────────────────────────
export function addFact(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  settings.aiFacts.unshift({
    id: `f${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: trimmed,
    createdAt: Date.now(),
  })
}
export function removeFact(id: string): void {
  const i = settings.aiFacts.findIndex((f) => f.id === id)
  if (i >= 0) settings.aiFacts.splice(i, 1)
}
export function clearFacts(): void {
  settings.aiFacts.splice(0, settings.aiFacts.length)
}

// ── C 档：embedding 调用 + 本地向量库 ──────────────────────────────
/** POST {base}/v1/embeddings（OpenAI 兼容；DeepSeek、Grok 也兼容这个端点）。 */
export async function embed(text: string): Promise<number[]> {
  const key = settings.aiEmbeddingApiKey.trim()
  const base = settings.aiEmbeddingBaseUrl.trim().replace(/\/$/, '')
  const model = settings.aiEmbeddingModel.trim() || 'text-embedding-3-small'
  if (!key || !base) throw new Error('EMBEDDING_NOT_CONFIGURED')
  const r = await bridgePost(
    `${base}/v1/embeddings`,
    { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    JSON.stringify({ model, input: text }),
  )
  if (!r.ok) {
    let detail = ''
    try {
      detail = (JSON.parse(r.body) as { error?: { message?: string } }).error?.message ?? ''
    } catch {
      /* ignore */
    }
    throw new Error(`EMBEDDING_HTTP_${r.status}${detail ? `: ${detail}` : ''}`)
  }
  const data = JSON.parse(r.body) as { data?: { embedding?: number[] }[] }
  const vec = data.data?.[0]?.embedding
  if (!vec) throw new Error('EMBEDDING_EMPTY_RESPONSE')
  return vec
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** 把文本向量化后存进 settings.aiVectorMemories；超过 1000 条 LRU 截掉最老的 */
export async function rememberVector(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed || !settings.aiVectorMemory) return
  let vec: number[]
  try {
    vec = await embed(trimmed)
  } catch {
    // embedding 不可用就跳过，不让记忆失败影响主对话
    return
  }
  settings.aiVectorMemories.unshift({
    id: `v${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: trimmed,
    vec,
    createdAt: Date.now(),
  })
  if (settings.aiVectorMemories.length > 1000) {
    settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
  }
}

/** 给 query 嵌入后，从本地向量库取 top-K 相似项（按相似度降序）。 */
export async function recallRelevant(
  query: string,
  k = settings.aiVectorTopK,
): Promise<{ text: string; score: number }[]> {
  if (!settings.aiVectorMemory || !settings.aiVectorMemories.length) return []
  let qv: number[]
  try {
    qv = await embed(query)
  } catch {
    return []
  }
  const scored = settings.aiVectorMemories.map((m) => ({
    text: m.text,
    score: cosineSim(qv, m.vec),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).filter((x) => x.score > 0.3) // 阈值过低就当不相关，避免污染
}

export function clearVectorMemory(): void {
  settings.aiVectorMemories.splice(0, settings.aiVectorMemories.length)
}

// ── 拼接 system prompt 用的记忆段 ─────────────────────────────────
/**
 * 构造「记忆与画像」段，准备拼到 system prompt 前置位。
 * `query` 用于 C 档相关性检索；可传当前用户输入或最近一条 user message。
 */
export async function buildMemorySection(query: string): Promise<string> {
  const parts: string[] = []

  // A: 自定义画像（自由文本）
  const a = settings.aiCustomInstructions.trim()
  if (a) parts.push(`## User profile & preferences\n${a}`)

  // B: 事实清单（全量）
  const facts = settings.aiFacts
  if (facts.length) {
    parts.push(`## Known facts\n${facts.map((f) => `- ${f.text}`).join('\n')}`)
  }

  // C: 相关记忆（top-K）
  if (settings.aiVectorMemory && query.trim() && settings.aiEmbeddingApiKey.trim()) {
    const hits = await recallRelevant(query)
    if (hits.length) {
      parts.push(`## Relevant past notes\n${hits.map((h) => `- ${h.text}`).join('\n')}`)
    }
  }

  return parts.join('\n\n')
}

// ── B 档：可选的「每轮抽取事实」──────────────────────────────────
import { askAiChat } from './ai'

/**
 * 在 turn 结束后，让 LLM 看一下 user/assistant 对话，抽 1-3 条「值得长期记住」的事实。
 * 失败/无事实时静默跳过。
 */
export async function autoExtractFacts(turn: { user: string; assistant: string }): Promise<void> {
  if (!settings.aiAutoExtractFacts) return
  try {
    const reply = await askAiChat({
      messages: [
        {
          role: 'user',
          content: `Below is one exchange between user and assistant. Extract at most 3 *durable* facts about the user or their project that are worth remembering across future sessions (e.g. "uses MySQL 8", "works on 'orders' schema", "prefers snake_case"). Skip ephemeral content. Reply ONLY as a bullet list ("- fact"), or the literal string "none".\n\n[User]\n${turn.user}\n\n[Assistant]\n${turn.assistant}`,
        },
      ],
      extraSystem: 'You are a memory curator. Output bullet list of durable facts only.',
    })
    if (/^\s*none\b/i.test(reply)) return
    const lines = reply
      .split('\n')
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 0 && l.length < 200)
    for (const l of lines.slice(0, 3)) addFact(l)
  } catch {
    /* 抽取失败不影响主对话 */
  }
}
