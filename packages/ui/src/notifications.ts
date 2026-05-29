/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * I1 通知 Webhook：钉钉 / 飞书 / Slack / 通用 webhook。
 *
 * 设计原则：
 * - 配置存自家 localStorage key `skylerx.notifications`（数组），独立于 settings；
 * - `notify(event, payload)` 是「fire-and-forget」：内部并发派发到所有订阅了该事件
 *   且 enabled === true 的渠道，单个失败不抛、不互相阻塞——通知不能拖累主流程；
 * - 优先走桌面 IPC 代理 `globalThis.api?.ai?.fetch`（避 CORS / 节点端发请求），
 *   web 端 fallback 到 `fetch`；
 * - 钉钉/飞书的「加签」按各自官方算法本地用 WebCrypto 算 HMAC-SHA256，
 *   钉钉 sign = base64(hmac(ts + "\n" + secret, secret))，URL-encode 后拼到 query；
 *   飞书 sign = base64(hmac("", ts + "\n" + secret))（注意 key/data 顺序相反）；
 * - Slack / 通用 webhook 不带签名，直接 POST JSON。
 */
export type NotifChannel = 'dingtalk' | 'feishu' | 'slack' | 'webhook'

export type NotifEvent = 'query-error' | 'slow-query' | 'manual'

export interface NotifConfig {
  id: string
  name: string
  channel: NotifChannel
  webhookUrl: string
  /** 钉钉/飞书的签名密钥（可选） */
  secret?: string
  enabled: boolean
  /** 触发事件类型订阅，缺省全收 */
  subscribe: NotifEvent[]
}

export interface NotifPayload {
  title: string
  body: string
  level?: 'info' | 'warn' | 'error'
}

const KEY = 'skylerx.notifications'

/** 读全部通知配置；存储坏了返回空数组（绝不抛）。 */
export function listNotifs(): NotifConfig[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    // 轻量校验：把缺字段的项过滤掉，避免后续 .toLowerCase() 之类炸；
    // subscribe 缺省视为全订阅，跟 spec 一致。
    return arr.filter(isValidConfig).map(normalize)
  } catch {
    return []
  }
}

/** 写回全部通知配置；写失败吞掉（无痕降级）。 */
export function saveNotifs(arr: NotifConfig[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(arr))
  } catch {
    /* 配额满 / 隐私模式 / SSR：忽略 */
  }
}

function isValidConfig(x: unknown): x is NotifConfig {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.channel === 'string' &&
    typeof o.webhookUrl === 'string' &&
    typeof o.enabled === 'boolean'
  )
}

function normalize(c: NotifConfig): NotifConfig {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    webhookUrl: c.webhookUrl,
    secret: typeof c.secret === 'string' ? c.secret : undefined,
    enabled: !!c.enabled,
    // 兼容缺省（旧版/手工写的配置）：当成「全订阅」
    subscribe:
      Array.isArray(c.subscribe) && c.subscribe.length > 0
        ? (c.subscribe.filter(
            (e) => e === 'query-error' || e === 'slow-query' || e === 'manual',
          ) as NotifEvent[])
        : ['query-error', 'slow-query', 'manual'],
  }
}

// ─────────────────────────── HTTP 桥 ───────────────────────────

interface BridgeFetchReq {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  reqId?: string
}
interface BridgeFetchRes {
  ok: boolean
  status: number
  body: string
  error?: string
}
interface AiBridge {
  fetch(req: BridgeFetchReq): Promise<BridgeFetchRes>
}

function bridge(): AiBridge | null {
  const w = globalThis as { api?: { ai?: AiBridge } }
  return w.api?.ai ?? null
}

/** 统一 POST JSON：桌面端走 IPC 代理（绕 CORS），web 端走 fetch。 */
async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const json = JSON.stringify(body)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const b = bridge()
  if (b) {
    const r = await b.fetch({ url, method: 'POST', headers, body: json, timeoutMs: 10_000 })
    if (r.error) throw new Error(r.error)
    return { ok: r.ok, status: r.status }
  }
  const res = await fetch(url, { method: 'POST', headers, body: json })
  return { ok: res.ok, status: res.status }
}

// ─────────────────────────── 签名 ───────────────────────────

/** 把 ArrayBuffer 转 base64（浏览器无 Buffer，用 btoa + binary string）。 */
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0)
  // btoa 在浏览器/Node 18+ 都有；SSR/老环境兜底回退
  if (typeof btoa === 'function') return btoa(s)
  // Node 兜底（理论上跑不到，UI 包都在浏览器/Electron 渲染层）
  const g = globalThis as {
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } }
  }
  return g.Buffer ? g.Buffer.from(s, 'binary').toString('base64') : s
}

/**
 * HMAC-SHA256 并返回 base64。WebCrypto subtle 在所有现代浏览器 & Electron 渲染层都可用。
 * key/data 都按 UTF-8 编。
 */
async function hmacSha256Base64(key: string, data: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (!subtle) throw new Error('WebCrypto not available')
  const enc = new TextEncoder()
  const cryptoKey = await subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return bufToBase64(sig)
}

// ─────────────────────────── 各渠道 ───────────────────────────

/**
 * 钉钉自定义机器人：
 *   - 加签 url: ?timestamp=ts&sign=urlEncode(base64(hmac_sha256(ts + "\n" + secret, secret)))
 *   - body: { msgtype: 'markdown', markdown: { title, text } }
 *   - text 用 markdown，标题前面可加 emoji 表 level。
 */
async function sendDingtalk(c: NotifConfig, p: NotifPayload): Promise<void> {
  let url = c.webhookUrl
  if (c.secret) {
    const ts = String(Date.now())
    const sign = await hmacSha256Base64(c.secret, `${ts}\n${c.secret}`)
    const sep = url.includes('?') ? '&' : '?'
    url = `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`
  }
  const icon = levelIcon(p.level)
  const body = {
    msgtype: 'markdown',
    markdown: {
      title: p.title,
      text: `### ${icon} ${p.title}\n\n${p.body}`,
    },
  }
  const r = await postJson(url, body)
  if (!r.ok) throw new Error(`dingtalk http ${r.status}`)
}

/**
 * 飞书自定义机器人：
 *   - 加签 body 字段：timestamp + sign（注意飞书的 sign 是「以 ts+\n+secret 当 key，对空串算 HMAC」）
 *   - 用 interactive 卡片：标题色随 level（red / orange / blue），正文 lark_md。
 */
async function sendFeishu(c: NotifConfig, p: NotifPayload): Promise<void> {
  const url = c.webhookUrl
  const ts = Math.floor(Date.now() / 1000).toString()
  let sign: string | undefined
  if (c.secret) {
    // 飞书算法：sign = base64(hmac_sha256(key = ts + "\n" + secret, data = ""))
    sign = await hmacSha256Base64(`${ts}\n${c.secret}`, '')
  }
  const color = p.level === 'error' ? 'red' : p.level === 'warn' ? 'orange' : 'blue'
  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: color,
      title: { tag: 'plain_text', content: `${levelIcon(p.level)} ${p.title}` },
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: p.body } }],
  }
  const body: Record<string, unknown> = { msg_type: 'interactive', card }
  if (sign) {
    body.timestamp = ts
    body.sign = sign
  }
  const r = await postJson(url, body)
  if (!r.ok) throw new Error(`feishu http ${r.status}`)
}

/**
 * Slack incoming webhook：最简就 `{ text }`；这里用 Block Kit 把标题加粗、正文跟着，
 * Slack 没有签名机制（URL 本身就是凭据）。
 */
async function sendSlack(c: NotifConfig, p: NotifPayload): Promise<void> {
  const icon = levelIcon(p.level)
  const body = {
    text: `${icon} ${p.title}\n${p.body}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${icon} ${p.title}` } },
      { type: 'section', text: { type: 'mrkdwn', text: p.body } },
    ],
  }
  const r = await postJson(c.webhookUrl, body)
  if (!r.ok) throw new Error(`slack http ${r.status}`)
}

/**
 * 通用 webhook：把规范化后的 payload 直接 POST，给接收方自己解析。
 */
async function sendGeneric(c: NotifConfig, p: NotifPayload): Promise<void> {
  const body = {
    title: p.title,
    body: p.body,
    level: p.level ?? 'info',
    ts: Date.now(),
  }
  const r = await postJson(c.webhookUrl, body)
  if (!r.ok) throw new Error(`webhook http ${r.status}`)
}

function levelIcon(level?: 'info' | 'warn' | 'error'): string {
  if (level === 'error') return '🛑'
  if (level === 'warn') return '⚠️'
  return 'ℹ️'
}

/** 按 channel 路由到对应实现。 */
async function dispatchOne(c: NotifConfig, p: NotifPayload): Promise<void> {
  switch (c.channel) {
    case 'dingtalk':
      return sendDingtalk(c, p)
    case 'feishu':
      return sendFeishu(c, p)
    case 'slack':
      return sendSlack(c, p)
    default:
      return sendGeneric(c, p)
  }
}

/**
 * 派发一次通知事件。
 *
 * - 选出 `enabled && subscribe.includes(event)` 的所有配置；
 * - 并发派发；不抛、不阻塞——返回的 Promise 总是 resolve。
 *
 * 单次发送可能因 webhook 地址错、网络断、签名错失败，
 * 此处统统吞掉（console.warn 一下方便调试），保证调用方主流程不被波及。
 */
export async function notify(event: NotifEvent, payload: NotifPayload): Promise<void> {
  let targets: NotifConfig[]
  try {
    targets = listNotifs().filter((c) => c.enabled && c.subscribe.includes(event))
  } catch {
    return
  }
  if (targets.length === 0) return
  await Promise.all(
    targets.map(async (c) => {
      try {
        await dispatchOne(c, payload)
      } catch (e) {
        // 通知是辅助通道，失败不影响主流程；仅控制台留痕
        console.warn(`[notify] ${c.channel}/${c.name} failed:`, e)
      }
    }),
  )
}
